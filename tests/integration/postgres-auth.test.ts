import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express, { Request, Response } from 'express';
import cookieParser from 'cookie-parser';
import { getTestApp } from '../helpers/test-app.js';
import { prisma } from '../../src/database/prisma.js';
import { hashSessionToken } from '../../src/modules/auth/crypto.js';
import { authenticate } from '../../src/common/middleware/auth.js';
import { tenantContextMiddleware } from '../../src/common/middleware/tenant-context.js';
import { errorHandler } from '../../src/common/middleware/error-handler.js';
import { sendSuccess } from '../../src/common/http/response.js';

describe('PostgreSQL Live Integration — Authentication & Tenant Isolation Engine', () => {
  const app = getTestApp();
  const testRunId = Date.now().toString(36);

  // Test credentials
  const aliceCredentials = {
    email: `alice-${testRunId}@flowpilot-test.internal`,
    name: 'Alice Pioneer',
    password: 'PioneerPassword123!',
    organizationName: `Alice Logistics ${testRunId}`,
  };

  const bobCredentials = {
    email: `bob-${testRunId}@flowpilot-test.internal`,
    name: 'Bob Operator',
    password: 'OperatorPassword123!',
    organizationName: `Bob Fleet ${testRunId}`,
  };

  let aliceUserId: string;
  let aliceOrgId: string;
  let aliceSessionCookie: string;
  let aliceRawToken: string;

  let bobUserId: string;
  let bobOrgId: string;
  let bobSessionCookie: string;

  beforeAll(async () => {
    // Verify database connectivity before running tests
    await prisma.$queryRaw`SELECT 1`;
  }, 30000);

  afterAll(async () => {
    // Clean up created test entities (cascading deletes sessions and memberships)
    try {
      const emails = [aliceCredentials.email, bobCredentials.email];
      const users = await prisma.user.findMany({
        where: { email: { in: emails } },
        select: { id: true },
      });
      const userIds = users.map((u) => u.id);

      if (userIds.length > 0) {
        await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
        await prisma.membership.deleteMany({ where: { userId: { in: userIds } } });
        await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      }

      const orgIds = [aliceOrgId, bobOrgId].filter(Boolean);
      if (orgIds.length > 0) {
        await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
      }
    } catch {
      // Ignore cleanup errors
    } finally {
      await prisma.$disconnect();
    }
  }, 30000);

  describe('Step 3.1: Atomic Registration Against Real PostgreSQL', () => {
    it('creates User, Organization, OWNER Membership, and Session in a single database transaction', async () => {
      const res = await request(app).post('/api/v1/auth/register').send(aliceCredentials);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.user.email).toBe(aliceCredentials.email);
      expect(res.body.data.user.name).toBe(aliceCredentials.name);
      expect(res.body.data.activeOrganizationId).toBeDefined();
      expect(res.body.data.memberships).toHaveLength(1);
      expect(res.body.data.memberships[0].role).toBe('OWNER');

      aliceUserId = res.body.data.user.id;
      aliceOrgId = res.body.data.activeOrganizationId;

      // Extract session cookie
      const cookies = res.headers['set-cookie'];
      expect(cookies).toBeDefined();
      const cookieArray = Array.isArray(cookies) ? cookies : [cookies];
      aliceSessionCookie = cookieArray.find((c) => c.startsWith('flowpilot_session='))!;
      expect(aliceSessionCookie).toBeDefined();

      // Extract raw token for direct PostgreSQL verification
      const rawMatch = aliceSessionCookie.match(/flowpilot_session=([^;]+)/);
      expect(rawMatch).toBeTruthy();
      aliceRawToken = decodeURIComponent(rawMatch![1]!);

      // Direct PostgreSQL verification: User row
      const dbUser = await prisma.user.findUnique({
        where: { id: aliceUserId },
      });
      expect(dbUser).not.toBeNull();
      expect(dbUser!.email).toBe(aliceCredentials.email);
      expect(dbUser!.status).toBe('ACTIVE');
      expect(dbUser!.passwordHash).not.toBeNull();
      expect(dbUser!.passwordHash).not.toBe(aliceCredentials.password); // Confirms Argon2id hashing

      // Direct PostgreSQL verification: Organization row
      const dbOrg = await prisma.organization.findUnique({
        where: { id: aliceOrgId },
      });
      expect(dbOrg).not.toBeNull();
      expect(dbOrg!.name).toBe(aliceCredentials.organizationName);
      expect(dbOrg!.status).toBe('ACTIVE');

      // Direct PostgreSQL verification: Membership row with OWNER role
      const dbMembership = await prisma.membership.findUnique({
        where: {
          userId_organizationId: {
            userId: aliceUserId,
            organizationId: aliceOrgId,
          },
        },
      });
      expect(dbMembership).not.toBeNull();
      expect(dbMembership!.role).toBe('OWNER');

      // Direct PostgreSQL verification: Session row with hashed token
      const tokenHash = hashSessionToken(aliceRawToken);
      const dbSession = await prisma.session.findUnique({
        where: { tokenHash },
      });
      expect(dbSession).not.toBeNull();
      expect(dbSession!.userId).toBe(aliceUserId);
      expect(new Date(dbSession!.expiresAt).getTime()).toBeGreaterThan(Date.now());
    }, 20000);

    it('rejects duplicate email registration with HTTP 409 Conflict', async () => {
      const res = await request(app).post('/api/v1/auth/register').send(aliceCredentials);

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('CONFLICT');
    }, 15000);
  });

  describe('Step 3.2: Login and Session Persistence Against PostgreSQL', () => {
    it('authenticates with valid password and creates a new persistent session in PostgreSQL', async () => {
      const res = await request(app).post('/api/v1/auth/login').send({
        email: aliceCredentials.email,
        password: aliceCredentials.password,
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.user.email).toBe(aliceCredentials.email);

      const cookies = res.headers['set-cookie'];
      expect(cookies).toBeDefined();
      const cookieArray = Array.isArray(cookies) ? cookies : [cookies];
      const newSessionCookie = cookieArray.find((c) => c.startsWith('flowpilot_session='))!;
      expect(newSessionCookie).toBeDefined();

      const tokenMatch = newSessionCookie.match(/flowpilot_session=([^;]+)/);
      expect(tokenMatch).toBeTruthy();
      const newRawToken = decodeURIComponent(tokenMatch![1]!);
      const newTokenHash = hashSessionToken(newRawToken);

      // Verify session exists in PostgreSQL
      const dbSession = await prisma.session.findUnique({
        where: { tokenHash: newTokenHash },
      });
      expect(dbSession).not.toBeNull();
      expect(dbSession!.userId).toBe(aliceUserId);
    }, 20000);

    it('rejects incorrect password with HTTP 401 Unauthorized', async () => {
      const res = await request(app).post('/api/v1/auth/login').send({
        email: aliceCredentials.email,
        password: 'WrongPassword999!',
      });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    }, 15000);
  });

  describe('Step 3.3: Authenticated User Retrieval (/me) Against PostgreSQL', () => {
    it('returns the authenticated user profile and memberships using the live session cookie', async () => {
      const res = await request(app).get('/api/v1/auth/me').set('Cookie', aliceSessionCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.user.id).toBe(aliceUserId);
      expect(res.body.data.user.email).toBe(aliceCredentials.email);
      expect(res.body.data.activeOrganizationId).toBe(aliceOrgId);
      expect(res.body.data.memberships[0].role).toBe('OWNER');
    }, 15000);

    it('rejects unauthenticated request with HTTP 401', async () => {
      const res = await request(app).get('/api/v1/auth/me');

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    }, 10000);
  });

  describe('Step 3.4: Logout and Server-Side Session Invalidation Against PostgreSQL', () => {
    it('invalidates and purges the session record from PostgreSQL upon logout', async () => {
      const tokenHash = hashSessionToken(aliceRawToken);

      // Verify session exists before logout
      const beforeSession = await prisma.session.findUnique({
        where: { tokenHash },
      });
      expect(beforeSession).not.toBeNull();

      // Execute logout
      const res = await request(app).post('/api/v1/auth/logout').set('Cookie', aliceSessionCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify session cookie was cleared
      const cookies = res.headers['set-cookie'];
      const clearedCookie = Array.isArray(cookies) ? cookies.join(';') : cookies;
      expect(clearedCookie).toMatch(/Expires=Thu, 01 Jan 1970/);

      // Direct PostgreSQL verification: Session row is deleted from database
      const afterSession = await prisma.session.findUnique({
        where: { tokenHash },
      });
      expect(afterSession).toBeNull();

      // Subsequent /me call with invalidated cookie must be rejected
      const meRes = await request(app).get('/api/v1/auth/me').set('Cookie', aliceSessionCookie);

      expect(meRes.status).toBe(401);
      expect(meRes.body.error.code).toBe('UNAUTHORIZED');
    }, 20000);
  });

  describe('Step 3.5: Multi-Tenant Membership Enforcement & Cross-Tenant Isolation Against PostgreSQL', () => {
    // Setup a tenant-scoped test app mounted with real authenticate and tenantContextMiddleware
    const tenantApp = express();
    tenantApp.use(cookieParser());
    tenantApp.use(express.json());

    // Protected endpoint requiring valid membership in target organization
    tenantApp.get(
      '/api/v1/tenant-data',
      authenticate,
      tenantContextMiddleware({ requireMembershipVerification: true }),
      (req: Request, res: Response) => {
        sendSuccess(res, {
          message: 'Access granted to organization data',
          tenant: req.tenant,
        });
      },
    );
    tenantApp.use(errorHandler);

    it('registers a second tenant (Bob) and verifies cross-tenant isolation in PostgreSQL', async () => {
      // 1. Register Bob
      const bobRes = await request(app).post('/api/v1/auth/register').send(bobCredentials);

      expect(bobRes.status).toBe(201);
      bobUserId = bobRes.body.data.user.id;
      expect(bobUserId).toBeDefined();
      bobOrgId = bobRes.body.data.activeOrganizationId;

      const bobCookies = bobRes.headers['set-cookie'];
      const cookieArray = Array.isArray(bobCookies) ? bobCookies : [bobCookies];
      bobSessionCookie = cookieArray.find((c) => c.startsWith('flowpilot_session='))!;

      // 2. Also log Alice back in to get a fresh session for Alice
      const aliceLoginRes = await request(app).post('/api/v1/auth/login').send({
        email: aliceCredentials.email,
        password: aliceCredentials.password,
      });
      const aliceCookies = aliceLoginRes.headers['set-cookie'];
      const aCookieArray = Array.isArray(aliceCookies) ? aliceCookies : [aliceCookies];
      aliceSessionCookie = aCookieArray.find((c) => c.startsWith('flowpilot_session='))!;

      // 3. Bob accesses Bob's organization -> HTTP 200 OK
      const bobOwnRes = await request(tenantApp)
        .get('/api/v1/tenant-data')
        .set('Cookie', bobSessionCookie)
        .set('X-Organization-Id', bobOrgId);

      expect(bobOwnRes.status).toBe(200);
      expect(bobOwnRes.body.success).toBe(true);
      expect(bobOwnRes.body.data.tenant.organizationId).toBe(bobOrgId);
      expect(bobOwnRes.body.data.tenant.role).toBe('OWNER');

      // 4. Bob attempts to access Alice's organization -> HTTP 403 Forbidden (Cross-tenant breach prevented)
      const breachAttemptRes = await request(tenantApp)
        .get('/api/v1/tenant-data')
        .set('Cookie', bobSessionCookie)
        .set('X-Organization-Id', aliceOrgId);

      expect(breachAttemptRes.status).toBe(403);
      expect(breachAttemptRes.body.success).toBe(false);
      expect(breachAttemptRes.body.error.code).toBe('FORBIDDEN');
      expect(breachAttemptRes.body.error.message).toContain(
        'do not have access to this organization',
      );

      // 5. Alice accesses Alice's organization -> HTTP 200 OK
      const aliceOwnRes = await request(tenantApp)
        .get('/api/v1/tenant-data')
        .set('Cookie', aliceSessionCookie)
        .set('X-Organization-Id', aliceOrgId);

      expect(aliceOwnRes.status).toBe(200);
      expect(aliceOwnRes.body.success).toBe(true);
      expect(aliceOwnRes.body.data.tenant.organizationId).toBe(aliceOrgId);
      expect(aliceOwnRes.body.data.tenant.role).toBe('OWNER');

      // 6. Request without X-Organization-Id -> HTTP 400 Bad Request
      const missingOrgRes = await request(tenantApp)
        .get('/api/v1/tenant-data')
        .set('Cookie', bobSessionCookie);

      expect(missingOrgRes.status).toBe(400);
      expect(missingOrgRes.body.error.code).toBe('BAD_REQUEST');
      expect(missingOrgRes.body.error.message).toContain(
        'Missing required X-Organization-Id header',
      );
    }, 35000);
  });
});
