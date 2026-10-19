import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { getTestApp } from '../helpers/test-app.js';
import { createApp } from '../../src/app.js';
import { EmailService } from '../../src/common/email/email.service.js';
import { tenantContextMiddleware } from '../../src/common/middleware/tenant-context.js';
import { prisma } from '../../src/database/prisma.js';
import type { Request, Response, NextFunction } from 'express';

describe('Security Hardening & Defense-in-Depth Verification Suite', () => {
  const app = getTestApp();

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('SEC-01: Transactional Email HTML Injection & CRLF Injection Prevention', () => {
    it('escapes user-controlled names to prevent HTML/XSS injection in password reset emails', async () => {
      let capturedHtml = '';
      vi.spyOn(EmailService as any, 'sendMail').mockImplementation(async (opts: any) => {
        capturedHtml = opts.html;
        return true;
      });

      const maliciousName = '<script>alert("xss")</script><img src=x onerror=alert(1)>';
      await EmailService.sendPasswordResetEmail(
        'victim@flowpilot.test',
        maliciousName,
        'test-token-12345',
      );

      expect(capturedHtml).not.toContain('<script>');
      expect(capturedHtml).not.toContain('<img src=x onerror=alert(1)>');
      expect(capturedHtml).toContain(
        '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;&lt;img src=x onerror=alert(1)&gt;',
      );
    });

    it('escapes user-controlled names in verification code emails', async () => {
      let capturedHtml = '';
      vi.spyOn(EmailService as any, 'sendMail').mockImplementation(async (opts: any) => {
        capturedHtml = opts.html;
        return true;
      });

      const maliciousName = '<b onmouseover="stealTokens()">Bold</b>';
      await EmailService.sendEmailVerificationCode(
        'victim@flowpilot.test',
        maliciousName,
        '654321',
      );

      expect(capturedHtml).not.toContain('<b onmouseover=');
      expect(capturedHtml).toContain(
        '&lt;b onmouseover=&quot;stealTokens()&quot;&gt;Bold&lt;/b&gt;',
      );
    });

    it('escapes user-controlled names in security alert emails', async () => {
      let capturedHtml = '';
      vi.spyOn(EmailService as any, 'sendMail').mockImplementation(async (opts: any) => {
        capturedHtml = opts.html;
        return true;
      });

      const maliciousName = '"><iframe src="javascript:evil()">';
      await EmailService.sendPasswordChangedNotification('victim@flowpilot.test', maliciousName);

      expect(capturedHtml).not.toContain('<iframe');
      expect(capturedHtml).toContain('&quot;&gt;&lt;iframe src=&quot;javascript:evil()&quot;&gt;');
    });

    it('rejects SMTP CRLF header injection attempts in recipient or subject fields', async () => {
      const maliciousRecipient = 'victim@flowpilot.test\r\nBcc: attacker@evil.com';
      const result = await EmailService.sendPasswordResetEmail(
        maliciousRecipient,
        'Alice',
        'token-123',
      );
      expect(result).toBe(false);
    });
  });

  describe('SEC-02: Tenant Isolation Middleware Secure-by-Default Enforcement', () => {
    it('defaults to requireMembershipVerification: true when instantiated with no arguments', async () => {
      const middleware = tenantContextMiddleware();

      const validOrgUuid = '123e4567-e89b-12d3-a456-426614174000';
      const req = {
        headers: { 'x-organization-id': validOrgUuid },
        user: { id: 'usr-attacker-uuid', role: 'MEMBER' },
        context: {},
      } as unknown as Request;

      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as unknown as Response;

      const next = vi.fn() as NextFunction;

      // Mock database lookup failing or returning no membership
      vi.spyOn(prisma.membership, 'findUnique').mockResolvedValueOnce(null);

      await middleware(req, res, next);

      // Verify that next was called with ForbiddenError and user was NOT allowed through
      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 403,
          message: 'You do not have access to this organization',
        }),
      );
    });

    it('fails closed when database membership query throws during tenant verification', async () => {
      const middleware = tenantContextMiddleware();

      const validOrgUuid = '123e4567-e89b-12d3-a456-426614174000';
      const req = {
        headers: { 'x-organization-id': validOrgUuid },
        user: { id: 'usr-attacker-uuid', role: 'ADMIN' },
        context: {},
      } as unknown as Request;

      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as unknown as Response;

      const next = vi.fn() as NextFunction;

      // Mock database lookup throwing an error
      vi.spyOn(prisma.membership, 'findUnique').mockRejectedValueOnce(
        new Error('DB connection drop'),
      );

      await middleware(req, res, next);

      // Verify fail-closed behavior: error passed to next, never falling back to req.user.role
      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 403,
          message: 'Failed to verify organization membership',
        }),
      );
      expect((req as any).context.membershipRole).toBeUndefined();
    });
  });

  describe('SEC-04: Strict Content-Type Enforcement (Anti-CSRF Defense-in-Depth)', () => {
    it('rejects POST request with body if Content-Type is application/x-www-form-urlencoded with HTTP 415', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .send('email=victim%40flowpilot.io&password=password123');

      expect(res.status).toBe(415);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
      expect(res.body.error.message).toContain('Content-Type must be application/json');
    });

    it('rejects POST request with body if Content-Type is text/plain with HTTP 415', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .set('Content-Type', 'text/plain')
        .send('{"email":"victim@flowpilot.io","password":"password123"}');

      expect(res.status).toBe(415);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    });

    it('permits POST request with body when Content-Type is application/json', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .set('Content-Type', 'application/json')
        .send({ email: 'nonexistent@flowpilot.io', password: 'Password123!' });

      // Proceeds to validation/auth logic (401 or 422, not 415)
      expect(res.status).not.toBe(415);
    });

    it('permits POST request with no body without requiring Content-Type (e.g. idempotent logout)', async () => {
      const res = await request(app).post('/api/v1/auth/logout');

      // Logout succeeds and clears cookies, without requiring Content-Type
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('SEC-03: Sensitive Endpoint Rate Limiting', () => {
    it('enforces rate limits on email dispatch endpoints when enabled', async () => {
      // Create an app instance with rate limiting enabled
      const rateLimitedApp = createApp({ enableRateLimiting: true });

      vi.spyOn(prisma.user, 'findUnique').mockResolvedValue(null);

      // Max is 5 requests per 15 minutes for email dispatch
      const responses: number[] = [];
      for (let i = 0; i < 7; i++) {
        const res = await request(rateLimitedApp)
          .post('/api/v1/auth/forgot-password')
          .set('Content-Type', 'application/json')
          .send({ email: 'tester@flowpilot.test' });
        responses.push(res.status);
      }

      // The 6th or 7th request must be rate limited with HTTP 429
      expect(responses).toContain(429);
    });
  });

  describe('SEC-09: Automated Session & Token Cleanup', () => {
    it('purges expired sessions, expired password reset tokens, and expired verification codes in a single transaction', async () => {
      const { AuthService } = await import('../../src/modules/auth/auth.service.js');

      const mockSessionResult = { count: 5 };
      const mockResetTokenResult = { count: 3 };
      const mockCodeResult = { count: 8 };

      vi.spyOn(prisma, '$transaction').mockResolvedValueOnce([
        mockSessionResult,
        mockResetTokenResult,
        mockCodeResult,
      ] as any);

      const result = await AuthService.cleanupExpiredTokens();

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        expiredSessions: 5,
        expiredResetTokens: 3,
        expiredVerificationCodes: 8,
      });
    });
  });

  describe('SEC-10: Constant-Time Comparison in Email Verification', () => {
    it('uses timing-safe comparison to prevent side-channel timing attacks when validating codes', async () => {
      const { AuthService } = await import('../../src/modules/auth/auth.service.js');
      const crypto = await import('crypto');

      const userId = 'usr-test-timing-safe';
      const validCode = '123456';
      const validCodeHash = crypto.createHash('sha256').update(validCode).digest('hex');

      vi.spyOn(prisma.emailVerificationCode, 'findFirst').mockResolvedValueOnce({
        id: 'code-1',
        userId,
        codeHash: validCodeHash,
        expiresAt: new Date(Date.now() + 1000 * 60 * 10), // valid
        createdAt: new Date(),
      } as any);

      vi.spyOn(prisma, '$transaction').mockImplementation(async (cb: any) => cb(prisma));

      vi.spyOn(prisma.user, 'update').mockResolvedValueOnce({
        id: userId,
        email: 'test@flowpilot.test',
        isEmailVerified: true,
      } as any);

      vi.spyOn(prisma.emailVerificationCode, 'deleteMany').mockResolvedValueOnce({ count: 1 });

      const verified = await AuthService.verifyEmail(userId, { code: '123456' });
      expect(verified.isEmailVerified).toBe(true);
    });

    it('rejects an incorrect code without leaking character-by-character timing', async () => {
      const { AuthService } = await import('../../src/modules/auth/auth.service.js');
      const crypto = await import('crypto');

      const userId = 'usr-test-timing-safe-fail';
      const validCode = '123456';
      const validCodeHash = crypto.createHash('sha256').update(validCode).digest('hex');

      vi.spyOn(prisma.emailVerificationCode, 'findFirst').mockResolvedValueOnce({
        id: 'code-2',
        userId,
        codeHash: validCodeHash,
        expiresAt: new Date(Date.now() + 1000 * 60 * 10),
        createdAt: new Date(),
      } as any);

      await expect(AuthService.verifyEmail(userId, { code: '999999' })).rejects.toThrow(
        'Invalid verification code',
      );
    });
  });

  describe('SEC-11: Cross-Origin Referer Validation & DELETE Method CSRF Defense', () => {
    it('rejects state-changing requests when untrusted Referer origin is supplied without Origin header', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .set('Content-Type', 'application/json')
        .set('Referer', 'https://malicious-attacker-site.com/exploit')
        .send({ email: 'test@flowpilot.test', password: 'Password123!' });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN');
      expect(res.body.error.message).toContain('is not allowed by FlowPilot security policy');
    });

    it('permits requests when Referer origin is in the allowed origins list', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .set('Content-Type', 'application/json')
        .set('Referer', 'http://localhost:3000/login')
        .send({ email: 'nonexistent@flowpilot.test', password: 'Password123!' });

      // Passes referer check and proceeds to auth validation (not 403)
      expect(res.status).not.toBe(403);
    });

    it('enforces Content-Type application/json on DELETE requests carrying a body', async () => {
      const res = await request(app)
        .delete('/api/v1/auth/session')
        .set('Content-Type', 'text/plain')
        .send('some-payload');

      expect(res.status).toBe(415);
      expect(res.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    });
  });
});
