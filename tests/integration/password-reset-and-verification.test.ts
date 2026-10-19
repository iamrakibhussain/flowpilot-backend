import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import crypto from 'node:crypto';
import { getTestApp } from '../helpers/test-app.js';
import { prisma } from '../../src/database/prisma.js';
import { EmailService } from '../../src/common/email/email.service.js';
import { AuthService } from '../../src/modules/auth/auth.service.js';

describe('Password Reset & Email Verification Security Engine', () => {
  const app = getTestApp();
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('POST /api/v1/auth/forgot-password', () => {
    it('returns generic success message when email exists and sends reset email', async () => {
      const emailSpy = vi.spyOn(EmailService, 'sendPasswordResetEmail').mockResolvedValueOnce(true);

      vi.spyOn(prisma.user, 'findUnique').mockResolvedValueOnce({
        id: 'usr-reset-123',
        email: 'founder@flowpilot.test',
        name: 'Sarah Connor',
        passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$dummy',
        status: 'ACTIVE',
        emailVerifiedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      vi.spyOn(prisma, '$transaction').mockImplementation(async (callback) => {
        return callback({
          passwordResetToken: {
            deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
            create: vi.fn().mockResolvedValue({}),
          },
        } as any);
      });

      const res = await request(app)
        .post('/api/v1/auth/forgot-password')
        .send({ email: 'founder@flowpilot.test' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.message).toContain('password reset instructions have been sent');
      expect(emailSpy).toHaveBeenCalledWith(
        'founder@flowpilot.test',
        'Sarah Connor',
        expect.any(String),
      );
    });

    it('returns identical generic success message when email does not exist (anti-enumeration)', async () => {
      const emailSpy = vi.spyOn(EmailService, 'sendPasswordResetEmail');
      vi.spyOn(prisma.user, 'findUnique').mockResolvedValueOnce(null);

      const res = await request(app)
        .post('/api/v1/auth/forgot-password')
        .send({ email: 'nonexistent@nowhere.test' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.message).toContain('password reset instructions have been sent');
      expect(emailSpy).not.toHaveBeenCalled();
    });

    it('rejects invalid email formats with HTTP 422', async () => {
      const res = await request(app)
        .post('/api/v1/auth/forgot-password')
        .send({ email: 'not-an-email' });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /api/v1/auth/reset-password', () => {
    it('successfully resets password and revokes all active sessions', async () => {
      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenRecord = {
        id: 'tok-123',
        userId: 'usr-reset-123',
        tokenHash: 'some-hash',
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        usedAt: null,
        createdAt: new Date(),
      };

      vi.spyOn(prisma.passwordResetToken, 'findUnique').mockResolvedValueOnce(tokenRecord as any);

      const updateUserSpy = vi.fn().mockResolvedValue({});
      const updateTokenSpy = vi.fn().mockResolvedValue({});
      const deleteSessionsSpy = vi.fn().mockResolvedValue({ count: 2 });

      vi.spyOn(prisma, '$transaction').mockImplementation(async (callback) => {
        return callback({
          user: { update: updateUserSpy },
          passwordResetToken: { update: updateTokenSpy },
          session: { deleteMany: deleteSessionsSpy },
        } as any);
      });

      const res = await request(app).post('/api/v1/auth/reset-password').send({
        token: rawToken,
        password: 'NewStrongPassword123!',
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.message).toContain('Password has been reset successfully');
      expect(updateUserSpy).toHaveBeenCalled();
      expect(updateTokenSpy).toHaveBeenCalled();
      expect(deleteSessionsSpy).toHaveBeenCalledWith({
        where: { userId: 'usr-reset-123' },
      });
    });

    it('rejects expired or used reset tokens with HTTP 401 Unauthorized', async () => {
      const rawToken = crypto.randomBytes(32).toString('hex');
      const expiredRecord = {
        id: 'tok-expired',
        userId: 'usr-reset-123',
        tokenHash: 'some-hash',
        expiresAt: new Date(Date.now() - 1000), // in the past
        usedAt: null,
        createdAt: new Date(),
      };

      vi.spyOn(prisma.passwordResetToken, 'findUnique').mockResolvedValueOnce(expiredRecord as any);

      const res = await request(app).post('/api/v1/auth/reset-password').send({
        token: rawToken,
        password: 'NewStrongPassword123!',
      });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.message).toContain('Invalid or expired password reset link');
    });

    it('rejects weak password with HTTP 422', async () => {
      const res = await request(app)
        .post('/api/v1/auth/reset-password')
        .send({
          token: crypto.randomBytes(32).toString('hex'),
          password: 'weak',
        });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /api/v1/auth/verify-email', () => {
    it('requires authentication to verify email', async () => {
      const res = await request(app).post('/api/v1/auth/verify-email').send({ code: '123456' });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('rejects verification code that is not 6 numeric digits with HTTP 422', async () => {
      vi.spyOn(AuthService, 'validateSession').mockResolvedValueOnce({
        sessionId: 'sess-123',
        user: {
          id: 'usr-123',
          email: 'test@flowpilot.io',
          name: 'Test',
          memberships: [],
        },
        activeOrganizationId: null,
      });

      const res = await request(app)
        .post('/api/v1/auth/verify-email')
        .set('Cookie', ['flowpilot_session=valid-session-token-1234567890'])
        .send({ code: 'abc' });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
    });
  });

  describe('POST /api/v1/auth/change-password', () => {
    it('requires authentication to change password', async () => {
      const res = await request(app).post('/api/v1/auth/change-password').send({
        currentPassword: 'CurrentPass123!',
        newPassword: 'NewStrongPassword456!',
      });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('rejects weak new password with HTTP 422', async () => {
      vi.spyOn(AuthService, 'validateSession').mockResolvedValueOnce({
        sessionId: 'sess-123',
        user: {
          id: 'usr-123',
          email: 'test@flowpilot.io',
          name: 'Test',
          memberships: [],
        },
        activeOrganizationId: null,
      });

      const res = await request(app)
        .post('/api/v1/auth/change-password')
        .set('Cookie', ['flowpilot_session=valid-session-token-1234567890'])
        .send({
          currentPassword: 'CurrentPass123!',
          newPassword: 'weak',
        });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
    });

    it('rejects identical new password with HTTP 422', async () => {
      vi.spyOn(AuthService, 'validateSession').mockResolvedValueOnce({
        sessionId: 'sess-123',
        user: {
          id: 'usr-123',
          email: 'test@flowpilot.io',
          name: 'Test',
          memberships: [],
        },
        activeOrganizationId: null,
      });

      const res = await request(app)
        .post('/api/v1/auth/change-password')
        .set('Cookie', ['flowpilot_session=valid-session-token-1234567890'])
        .send({
          currentPassword: 'SamePassword123!',
          newPassword: 'SamePassword123!',
        });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
    });
  });

  describe('DELETE /api/v1/auth/account', () => {
    it('requires authentication to delete account', async () => {
      const res = await request(app).post('/api/v1/auth/account').send({
        password: 'Password123!',
        confirmationText: 'DELETE',
      });

      // Route does not accept POST, and is protected
      expect(res.status).toBe(404);
    });

    it('rejects deletion with invalid confirmation phrase with HTTP 422', async () => {
      vi.spyOn(AuthService, 'validateSession').mockResolvedValueOnce({
        sessionId: 'sess-123',
        user: {
          id: 'usr-123',
          email: 'test@flowpilot.io',
          name: 'Test',
          memberships: [],
        },
        activeOrganizationId: null,
      });

      const res = await request(app)
        .delete('/api/v1/auth/account')
        .set('Cookie', ['flowpilot_session=valid-session-token-1234567890'])
        .send({
          password: 'Password123!',
          confirmationText: 'WRONG_PHRASE',
        });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
    });
  });
});
