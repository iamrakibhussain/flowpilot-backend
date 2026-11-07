import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { Request, Response } from 'express';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { tenantContextMiddleware } from '../../src/common/middleware/tenant-context.js';
import { errorHandler } from '../../src/common/middleware/error-handler.js';
import { sendSuccess } from '../../src/common/http/response.js';
import { prisma } from '../../src/database/prisma.js';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { teamRoutes } from '../../src/modules/team/team.routes.js';
import { organizationRoutes } from '../../src/modules/organizations/organization.routes.js';
import { paymentRoutes } from '../../src/modules/payments/payment.routes.js';
import { recurringRoutes } from '../../src/modules/recurring/recurring.routes.js';
import { staffRoutes } from '../../src/modules/staff/staff.routes.js';
import { serviceRoutes } from '../../src/modules/services/service.routes.js';
import flowRulesRoutes from '../../src/modules/flow-rules/flow-rules.routes.js';
import { invoiceRoutes } from '../../src/modules/invoices/invoice.routes.js';
import { quoteRoutes } from '../../src/modules/quotes/quote.routes.js';
import { contractRoutes } from '../../src/modules/contracts/contract.routes.js';
import { RecurringService } from '../../src/modules/recurring/recurring.service.js';
import { EmailService } from '../../src/common/email/email.service.js';
import { TeamService } from '../../src/modules/team/team.service.js';
import { Role } from '@prisma/client';

describe('Tenant Authorization & Cross-Organization Boundary Enforcement', () => {
  const targetOrgId = '123e4567-e89b-42d3-a456-426614174000';
  const foreignOrgId = '987fcdeb-51a2-43f7-9876-543210987654';

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(prisma, '$transaction').mockImplementation(async (callback: any) => {
      if (typeof callback === 'function') {
        return callback(prisma);
      }
      return callback;
    });
    vi.spyOn(prisma, '$executeRaw').mockResolvedValue(1 as any);
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

  describe('RBAC & Privilege Escalation Hardening Verification', () => {
    function mockAuthSession(
      role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'BILLING',
      userId = 'usr-test-123',
    ) {
      vi.spyOn(AuthService, 'validateSession').mockResolvedValue({
        sessionId: 'test-session-id',
        user: {
          id: userId,
          email: `${role.toLowerCase()}@flowpilot.internal`,
          name: `${role} User`,
          memberships: [
            {
              organizationId: targetOrgId,
              organizationName: 'Target Org',
              role,
              status: 'ACTIVE',
            },
          ],
        },
        activeOrganizationId: targetOrgId,
      });
    }

    function createFullApp() {
      const app = express();
      app.use(express.json());
      app.use(cookieParser());
      app.use('/api/v1/team', teamRoutes);
      app.use('/api/v1/organizations', organizationRoutes);
      app.use('/api/v1/payments', paymentRoutes);
      app.use('/api/v1/recurring', recurringRoutes);
      app.use('/api/v1/staff', staffRoutes);
      app.use('/api/v1/services', serviceRoutes);
      app.use('/api/v1/flow-rules', flowRulesRoutes);
      app.use('/api/v1/invoices', invoiceRoutes);
      app.use('/api/v1/quotes', quoteRoutes);
      app.use('/api/v1/contracts', contractRoutes);
      app.use(errorHandler);
      return app;
    }

    describe('Team Vertical Privilege Escalation Protection', () => {
      it('prevents an ADMIN from inviting a new user with role OWNER', async () => {
        mockAuthSession('ADMIN');
        const app = createFullApp();

        const res = await request(app)
          .post('/api/v1/team/invitations')
          .set('Cookie', ['flowpilot_session=valid-admin-token'])
          .set('X-Organization-Id', targetOrgId)
          .send({
            email: 'newowner@test.internal',
            role: 'OWNER',
          });

        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
        expect(res.body.error.code).toBe('FORBIDDEN');
        expect(res.body.error.message).toContain('Only workspace Owners can invite new Owners');
      });

      it('prevents an ADMIN from promoting another member to OWNER', async () => {
        mockAuthSession('ADMIN');
        const app = createFullApp();

        vi.spyOn(prisma.membership, 'findFirst').mockResolvedValueOnce({
          id: 'mem-target-1',
          userId: 'usr-target',
          organizationId: targetOrgId,
          role: 'MEMBER',
          createdAt: new Date(),
          updatedAt: new Date(),
          user: { id: 'usr-target', name: 'Target User', email: 'target@test.internal' },
        } as any);

        const res = await request(app)
          .patch('/api/v1/team/members/mem-target-1/role')
          .set('Cookie', ['flowpilot_session=valid-admin-token'])
          .set('X-Organization-Id', targetOrgId)
          .send({ role: 'OWNER' });

        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
        expect(res.body.error.message).toContain(
          'Only workspace Owners can modify an Owner account or promote a member to Owner',
        );
      });

      it('prevents an ADMIN from demoting an existing OWNER', async () => {
        mockAuthSession('ADMIN');
        const app = createFullApp();

        (vi.spyOn(prisma.membership, 'findFirst') as any).mockImplementation(
          async ({ where }: any) => {
            if (where?.userId === 'usr-test-123') {
              return {
                id: 'mem-admin-1',
                userId: 'usr-test-123',
                organizationId: targetOrgId,
                role: 'ADMIN',
              };
            }
            return {
              id: 'mem-owner-2',
              userId: 'usr-owner-2',
              organizationId: targetOrgId,
              role: 'OWNER',
              createdAt: new Date(),
              updatedAt: new Date(),
              user: { id: 'usr-owner-2', name: 'Second Owner', email: 'owner2@test.internal' },
            };
          },
        );

        const res = await request(app)
          .patch('/api/v1/team/members/mem-owner-2/role')
          .set('Cookie', ['flowpilot_session=valid-admin-token'])
          .set('X-Organization-Id', targetOrgId)
          .send({ role: 'MEMBER' });

        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
        expect(res.body.error.message).toContain(
          'Only workspace Owners can modify an Owner account or promote a member to Owner',
        );
      });

      it('prevents an ADMIN from removing an OWNER from the workspace', async () => {
        mockAuthSession('ADMIN');
        const app = createFullApp();

        (vi.spyOn(prisma.membership, 'findFirst') as any).mockImplementation(
          async ({ where }: any) => {
            if (where?.userId === 'usr-test-123') {
              return {
                id: 'mem-admin-1',
                userId: 'usr-test-123',
                organizationId: targetOrgId,
                role: 'ADMIN',
              };
            }
            return {
              id: 'mem-owner-2',
              userId: 'usr-owner-2',
              organizationId: targetOrgId,
              role: 'OWNER',
              createdAt: new Date(),
              updatedAt: new Date(),
            };
          },
        );

        const res = await request(app)
          .delete('/api/v1/team/members/mem-owner-2')
          .set('Cookie', ['flowpilot_session=valid-admin-token'])
          .set('X-Organization-Id', targetOrgId);

        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
        expect(res.body.error.message).toContain(
          'Only workspace Owners can remove an Owner from the workspace',
        );
      });

      it('allows an OWNER to invite another OWNER', async () => {
        mockAuthSession('OWNER');
        const app = createFullApp();

        (vi.spyOn(prisma.user, 'findUnique') as any).mockImplementation(async ({ where }: any) => {
          if (where.email) return null; // No existing active member
          return { id: 'usr-owner-1', name: 'Alice Owner' } as any;
        });
        vi.spyOn(prisma.organization, 'findUnique').mockResolvedValueOnce({
          id: targetOrgId,
          name: 'Apex Studio Design',
        } as any);
        vi.spyOn(prisma.organizationInvitation, 'updateMany').mockResolvedValueOnce({ count: 0 });
        vi.spyOn(prisma.organizationInvitation, 'create').mockResolvedValueOnce({
          id: 'inv-new-1',
          organizationId: targetOrgId,
          email: 'co-owner@test.internal',
          role: 'OWNER',
          status: 'PENDING',
          expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 48),
          createdAt: new Date(),
          inviter: { name: 'Alice Owner' },
          staffMember: null,
          staffMemberId: null,
        } as any);
        vi.spyOn(EmailService, 'sendWorkspaceInvitation').mockResolvedValueOnce(true);

        const res = await request(app)
          .post('/api/v1/team/invitations')
          .set('Cookie', ['flowpilot_session=valid-owner-token'])
          .set('X-Organization-Id', targetOrgId)
          .send({
            email: 'co-owner@test.internal',
            role: 'OWNER',
          });

        expect(res.status).toBe(201);
        expect(res.body.success).toBe(true);
        expect(res.body.data.role).toBe('OWNER');
      });

      it('fails closed when TeamService methods are invoked without caller role context', async () => {
        // 1. sendInvitation without valid role
        await expect(
          TeamService.sendInvitation(
            targetOrgId,
            'usr-test-1',
            { email: 'test@test.internal', role: Role.MEMBER },
            undefined as any,
          ),
        ).rejects.toThrow('Caller organization role is missing or invalid');

        // 2. updateMemberRole without valid role
        await expect(
          TeamService.updateMemberRole(
            targetOrgId,
            'usr-test-1',
            'mem-target-1',
            Role.ADMIN,
            undefined as any,
          ),
        ).rejects.toThrow('Caller organization role is missing or invalid');

        // 3. removeMember without valid role
        await expect(
          TeamService.removeMember(targetOrgId, 'usr-test-1', 'mem-target-1', undefined as any),
        ).rejects.toThrow('Caller organization role is missing or invalid');
      });
    });

    describe('Organization Audit Logs & Sensitive Settings Protection', () => {
      it('rejects MEMBER role from accessing organization audit logs with HTTP 403', async () => {
        mockAuthSession('MEMBER');
        const app = createFullApp();

        const res = await request(app)
          .get('/api/v1/organizations/audit-logs')
          .set('Cookie', ['flowpilot_session=valid-member-token'])
          .set('X-Organization-Id', targetOrgId);

        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
      });

      it('allows ADMIN and OWNER roles to access audit logs with HTTP 200', async () => {
        mockAuthSession('ADMIN');
        const app = createFullApp();

        vi.spyOn(prisma.workspaceAuditLog, 'findMany').mockResolvedValueOnce([]);

        const res = await request(app)
          .get('/api/v1/organizations/audit-logs')
          .set('Cookie', ['flowpilot_session=valid-admin-token'])
          .set('X-Organization-Id', targetOrgId);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
      });
    });

    describe('Payment Settings Protection', () => {
      it('rejects regular MEMBER from updating payment gateway settings with HTTP 403', async () => {
        mockAuthSession('MEMBER');
        const app = createFullApp();

        const res = await request(app)
          .patch('/api/v1/payments/settings')
          .set('Cookie', ['flowpilot_session=valid-member-token'])
          .set('X-Organization-Id', targetOrgId)
          .send({ currency: 'EUR' });

        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
      });
    });

    describe('Recurring Billing Isolation & RBAC Protection', () => {
      it('rejects regular MEMBER from triggering immediate recurring billing runs with HTTP 403', async () => {
        mockAuthSession('MEMBER');
        const app = createFullApp();

        const res = await request(app)
          .post('/api/v1/recurring/process-now')
          .set('Cookie', ['flowpilot_session=valid-member-token'])
          .set('X-Organization-Id', targetOrgId);

        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
      });

      it('scopes RecurringService.processDueSchedules strictly to target organization when provided', async () => {
        let capturedWhere: any = null;
        vi.spyOn(prisma, '$queryRaw').mockResolvedValueOnce([{ locked: true }]);
        (vi.spyOn(prisma.recurringSchedule, 'findMany') as any).mockImplementation(
          async ({ where }: any) => {
            capturedWhere = where;
            return [];
          },
        );

        await RecurringService.processDueSchedules(targetOrgId);

        expect(capturedWhere).toBeDefined();
        expect(capturedWhere.organizationId).toBe(targetOrgId);
      });
    });

    describe('Staff, Services & FlowRules Mutations RBAC', () => {
      it('rejects regular MEMBER from creating new staff members with HTTP 403', async () => {
        mockAuthSession('MEMBER');
        const app = createFullApp();

        const res = await request(app)
          .post('/api/v1/staff')
          .set('Cookie', ['flowpilot_session=valid-member-token'])
          .set('X-Organization-Id', targetOrgId)
          .send({ name: 'Hacker Staff', roleTitle: 'Specialist', email: 'hacker@test.internal' });

        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
      });

      it('rejects regular MEMBER from deleting services with HTTP 403', async () => {
        mockAuthSession('MEMBER');
        const app = createFullApp();

        const res = await request(app)
          .delete('/api/v1/services/svc-123')
          .set('Cookie', ['flowpilot_session=valid-member-token'])
          .set('X-Organization-Id', targetOrgId);

        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
      });

      it('rejects regular MEMBER from creating automation rules with HTTP 403', async () => {
        mockAuthSession('MEMBER');
        const app = createFullApp();

        const res = await request(app)
          .post('/api/v1/flow-rules')
          .set('Cookie', ['flowpilot_session=valid-member-token'])
          .set('X-Organization-Id', targetOrgId)
          .send({ name: 'Evil Rule' });

        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
      });
    });

    describe('Destructive Invoice, Quote & Contract Operations RBAC', () => {
      it('rejects regular MEMBER from deleting invoices with HTTP 403', async () => {
        mockAuthSession('MEMBER');
        const app = createFullApp();

        const res = await request(app)
          .delete('/api/v1/invoices/inv-123')
          .set('Cookie', ['flowpilot_session=valid-member-token'])
          .set('X-Organization-Id', targetOrgId);

        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
      });

      it('rejects regular MEMBER from countersigning legal contracts with HTTP 403', async () => {
        mockAuthSession('MEMBER');
        const app = createFullApp();

        const res = await request(app)
          .post('/api/v1/contracts/ctr-123/countersign')
          .set('Cookie', ['flowpilot_session=valid-member-token'])
          .set('X-Organization-Id', targetOrgId);

        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
      });
    });
  });
});
