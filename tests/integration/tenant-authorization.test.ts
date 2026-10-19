import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { Request, Response } from 'express';
import request from 'supertest';
import { tenantContextMiddleware } from '../../src/common/middleware/tenant-context.js';
import { errorHandler } from '../../src/common/middleware/error-handler.js';
import { sendSuccess } from '../../src/common/http/response.js';
import { prisma } from '../../src/database/prisma.js';

describe('Tenant Authorization & Cross-Organization Boundary Enforcement', () => {
  const targetOrgId = '123e4567-e89b-42d3-a456-426614174000';
  const foreignOrgId = '987fcdeb-51a2-43f7-9876-543210987654';

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  function createProtectedTenantApp(
    options: {
      requireMembershipVerification?: boolean;
      allowedRoles?: ('OWNER' | 'ADMIN' | 'MEMBER' | 'BILLING')[];
    } = { requireMembershipVerification: true },
  ) {
    const app = express();
    app.use(express.json());

    // Mock authenticated user on request
    app.use((req, _res, next) => {
      req.user = {
        id: 'usr-alice-1',
        email: 'alice@company.test',
        name: 'Alice Member',
        memberships: [
          {
            organizationId: targetOrgId,
            organizationName: 'Alice Company',
            role: 'MEMBER',
          },
        ],
      };
      next();
    });

    app.get(
      '/api/v1/tenant-resource',
      tenantContextMiddleware(options),
      (req: Request, res: Response) => {
        sendSuccess(res, { tenant: req.tenant });
      },
    );

    app.use(errorHandler);
    return app;
  }

  it('allows access when user is a valid member of the target organization', async () => {
    const app = createProtectedTenantApp({
      requireMembershipVerification: true,
      allowedRoles: undefined,
    });

    const res = await request(app)
      .get('/api/v1/tenant-resource')
      .set('X-Organization-Id', targetOrgId);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.tenant.organizationId).toBe(targetOrgId);
    expect(res.body.data.tenant.role).toBe('MEMBER');
  });

  it('returns HTTP 403 Forbidden on cross-organization access attempt (IDOR prevention)', async () => {
    const app = createProtectedTenantApp({
      requireMembershipVerification: true,
      allowedRoles: undefined,
    });

    // Mock database check returning null (user is not member of foreign org)
    vi.spyOn(prisma.membership, 'findUnique').mockResolvedValueOnce(null);

    const res = await request(app)
      .get('/api/v1/tenant-resource')
      .set('X-Organization-Id', foreignOrgId);

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(res.body.error.message).toContain('do not have access to this organization');
  });

  it('enforces RBAC role checks and rejects users with insufficient roles', async () => {
    // Requires ADMIN or OWNER role, but Alice only has MEMBER role
    const app = createProtectedTenantApp({
      requireMembershipVerification: true,
      allowedRoles: ['OWNER', 'ADMIN'],
    });

    const res = await request(app)
      .get('/api/v1/tenant-resource')
      .set('X-Organization-Id', targetOrgId);

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(res.body.error.message).toContain('Insufficient organization permissions');
  });

  it('allows access when user has an approved role (e.g. OWNER)', async () => {
    const app = express();
    app.use(express.json());

    app.use((req, _res, next) => {
      req.user = {
        id: 'usr-bob-owner',
        email: 'bob@owner.test',
        name: 'Bob Owner',
        memberships: [
          {
            organizationId: targetOrgId,
            organizationName: 'Bob Corp',
            role: 'OWNER',
          },
        ],
      };
      next();
    });

    app.get(
      '/api/v1/owner-only-resource',
      tenantContextMiddleware({
        requireMembershipVerification: true,
        allowedRoles: ['OWNER'],
      }),
      (req: Request, res: Response) => {
        sendSuccess(res, { tenant: req.tenant });
      },
    );

    app.use(errorHandler);

    const res = await request(app)
      .get('/api/v1/owner-only-resource')
      .set('X-Organization-Id', targetOrgId);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.tenant.role).toBe('OWNER');
  });

  it('returns HTTP 403 Forbidden when target organization is suspended or archived', async () => {
    const app = express();
    app.use(express.json());

    app.use((req, _res, next) => {
      req.user = {
        id: 'usr-charlie',
        email: 'charlie@suspended.test',
        name: 'Charlie Member',
        memberships: [
          {
            organizationId: targetOrgId,
            organizationName: 'Suspended Org',
            role: 'OWNER',
            status: 'SUSPENDED',
          },
        ],
      };
      next();
    });

    app.get(
      '/api/v1/tenant-resource',
      tenantContextMiddleware({ requireMembershipVerification: true }),
      (req: Request, res: Response) => {
        sendSuccess(res, { tenant: req.tenant });
      },
    );

    app.use(errorHandler);

    const res = await request(app)
      .get('/api/v1/tenant-resource')
      .set('X-Organization-Id', targetOrgId);

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(res.body.error.message).toContain('This organization is suspended or archived');
  });
});
