import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { getTestApp } from '../helpers/test-app.js';
import { prisma } from '../../src/database/prisma.js';
import { hashPassword } from '../../src/modules/auth/crypto.js';

describe('Authentication & Session Engine (Integration)', () => {
  const app = getTestApp();

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('POST /api/v1/auth/register', () => {
    const validRegisterPayload = {
      email: 'owner@acme.test',
      name: 'Acme Owner',
      password: 'SecurePassword123!',
      organizationName: 'Acme Operations Ltd',
    };

    it('creates user, organization, OWNER membership, and sets secure session cookie', async () => {
      // Mock unique email check
      vi.spyOn(prisma.user, 'findUnique').mockResolvedValueOnce(null);
      // Mock slug uniqueness check
      vi.spyOn(prisma.organization, 'findUnique').mockResolvedValueOnce(null);

      const mockUser = {
        id: 'usr-1111-2222',
        email: validRegisterPayload.email.toLowerCase(),
        name: validRegisterPayload.name,
        passwordHash: 'mock-hash',
        status: 'ACTIVE' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockOrg = {
        id: 'org-1111-2222',
        name: validRegisterPayload.organizationName,
        slug: 'acme-operations-ltd',
        status: 'ACTIVE' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.spyOn(prisma, '$transaction').mockImplementation(async (callback) => {
        return callback({
          user: { create: vi.fn().mockResolvedValue(mockUser) },
          organization: { create: vi.fn().mockResolvedValue(mockOrg) },
          membership: { create: vi.fn().mockResolvedValue({}) },
          session: { create: vi.fn().mockResolvedValue({}) },
        } as unknown as typeof prisma);
      });

      const res = await request(app).post('/api/v1/auth/register').send(validRegisterPayload);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.user.email).toBe('owner@acme.test');
      expect(res.body.data.activeOrganizationId).toBe('org-1111-2222');
      expect(res.body.data.memberships).toHaveLength(1);
      expect(res.body.data.memberships[0].role).toBe('OWNER');

      // Verify Set-Cookie header is issued
      const cookies = res.headers['set-cookie'] as unknown as string[] | undefined;
      expect(cookies).toBeDefined();
      expect(cookies?.some((c) => c.includes('flowpilot_session='))).toBe(true);
      expect(cookies?.some((c) => c.includes('HttpOnly'))).toBe(true);
    });

    it('returns HTTP 409 when email address is already registered', async () => {
      vi.spyOn(prisma.user, 'findUnique').mockResolvedValueOnce({
        id: 'existing-id',
        email: 'owner@acme.test',
        name: 'Existing',
        passwordHash: 'hash',
        status: 'ACTIVE',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await request(app).post('/api/v1/auth/register').send(validRegisterPayload);

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('CONFLICT');
      expect(res.body.error.message).toContain('already exists');
    });

    it('returns HTTP 422 on invalid payload (password too short)', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({ ...validRegisterPayload, password: 'short' });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details.password).toBeDefined();
    });
  });

  describe('POST /api/v1/auth/login', () => {
    it('authenticates valid credentials, creates session, and issues cookie', async () => {
      const password = 'CorrectPassword123!';
      const passwordHash = await hashPassword(password);

      const mockUser = {
        id: 'usr-valid-123',
        email: 'user@test.com',
        name: 'Valid User',
        passwordHash,
        status: 'ACTIVE' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
        memberships: [
          {
            id: 'mem-1',
            userId: 'usr-valid-123',
            organizationId: 'org-test-999',
            role: 'ADMIN' as const,
            createdAt: new Date(),
            updatedAt: new Date(),
            organization: {
              id: 'org-test-999',
              name: 'Test Org',
              slug: 'test-org',
              status: 'ACTIVE' as const,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          },
        ],
      };

      vi.spyOn(prisma.user, 'findUnique').mockResolvedValueOnce(mockUser as never);
      vi.spyOn(prisma.session, 'create').mockResolvedValueOnce({} as never);

      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'user@test.com', password });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.user.id).toBe('usr-valid-123');
      expect(res.body.data.activeOrganizationId).toBe('org-test-999');
      expect(res.body.data.memberships[0].role).toBe('ADMIN');

      const cookies = res.headers['set-cookie'] as unknown as string[] | undefined;
      expect(cookies?.some((c) => c.includes('flowpilot_session='))).toBe(true);
    });

    it('returns HTTP 401 on incorrect password without leaking user existence', async () => {
      const passwordHash = await hashPassword('ValidPassword123!');

      const mockUser = {
        id: 'usr-1',
        email: 'user@test.com',
        name: 'User',
        passwordHash,
        status: 'ACTIVE' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
        memberships: [],
      };

      vi.spyOn(prisma.user, 'findUnique').mockResolvedValueOnce(mockUser as never);

      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'user@test.com', password: 'WrongPassword999!' });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
      expect(res.body.error.message).toBe('Invalid email or password');
    });

    it('returns HTTP 401 when email does not exist', async () => {
      vi.spyOn(prisma.user, 'findUnique').mockResolvedValueOnce(null);

      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'nonexistent@test.com', password: 'AnyPassword123!' });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('returns HTTP 403 when user status is SUSPENDED or DEACTIVATED', async () => {
      const passwordHash = await hashPassword('ValidPassword123!');
      const mockUser = {
        id: 'usr-suspended',
        email: 'suspended@test.com',
        name: 'Suspended User',
        passwordHash,
        status: 'SUSPENDED' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
        memberships: [],
      };

      vi.spyOn(prisma.user, 'findUnique').mockResolvedValueOnce(mockUser as never);

      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'suspended@test.com', password: 'ValidPassword123!' });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN');
      expect(res.body.error.message).toContain('suspended');
    });
  });

  describe('GET /api/v1/auth/me', () => {
    it('returns HTTP 401 Unauthorized when session cookie is missing', async () => {
      const res = await request(app).get('/api/v1/auth/me');

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('returns HTTP 401 when session token is invalid or expired', async () => {
      vi.spyOn(prisma.session, 'findUnique').mockResolvedValueOnce(null);

      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Cookie', ['flowpilot_session=invalid-or-expired-token-value']);

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('returns HTTP 200 with user profile and memberships for valid session', async () => {
      const futureExpiry = new Date(Date.now() + 1000 * 60 * 60 * 24);
      const mockSession = {
        id: 'sess-123',
        userId: 'usr-123',
        tokenHash: 'hash',
        ipAddress: '127.0.0.1',
        userAgent: 'test-agent',
        expiresAt: futureExpiry,
        createdAt: new Date(),
        lastActiveAt: new Date(),
        user: {
          id: 'usr-123',
          email: 'me@company.test',
          name: 'Jane Doe',
          status: 'ACTIVE' as const,
          createdAt: new Date(),
          updatedAt: new Date(),
          memberships: [
            {
              id: 'mem-1',
              organizationId: 'org-abc-123',
              role: 'OWNER' as const,
              organization: {
                id: 'org-abc-123',
                name: 'Jane Enterprise',
                slug: 'jane-enterprise',
              },
            },
          ],
        },
      };

      vi.spyOn(prisma.session, 'findUnique').mockResolvedValueOnce(mockSession as never);

      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Cookie', ['flowpilot_session=validtoken1234567890abcdef1234567890abcdef']);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.user.email).toBe('me@company.test');
      expect(res.body.data.user.name).toBe('Jane Doe');
      expect(res.body.data.activeOrganizationId).toBe('org-abc-123');
      expect(res.body.data.memberships[0].role).toBe('OWNER');
    });
  });

  describe('POST /api/v1/auth/logout', () => {
    it('invalidates server-side session and clears cookie', async () => {
      const deleteManySpy = vi
        .spyOn(prisma.session, 'deleteMany')
        .mockResolvedValueOnce({ count: 1 });

      const res = await request(app)
        .post('/api/v1/auth/logout')
        .set('Cookie', ['flowpilot_session=active-token-to-invalidate']);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.message).toBe('Logged out successfully');
      expect(deleteManySpy).toHaveBeenCalled();

      // Cookie should be expired / cleared
      const cookies = res.headers['set-cookie'] as unknown as string[] | undefined;
      expect(
        cookies?.some((c) => c.includes('flowpilot_session=;') || c.includes('Max-Age=0')),
      ).toBe(true);
    });
  });
});
