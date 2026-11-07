import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { prisma } from '../../src/database/prisma.js';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { recurringRoutes } from '../../src/modules/recurring/recurring.routes.js';
import { errorHandler } from '../../src/common/middleware/error-handler.js';
import { TeamService } from '../../src/modules/team/team.service.js';
import { Role, RecurringFrequency, RecurringStatus } from '@prisma/client';

describe('Real Database Multi-Tenant Isolation & Last-OWNER Concurrency Hardening', () => {
  const testRunId = `sec-iso-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

  // Multi-tenant isolation entities
  let tenantAOrgId: string;
  let tenantBOrgId: string;
  let tenantAUserId: string;
  let tenantBUserId: string;
  let customerAId: string;
  let customerBId: string;
  let scheduleAId: string;
  let scheduleBId: string;

  // Concurrency entities
  let concOrgId: string;
  let user1Id: string;
  let user2Id: string;
  let user3Id: string;

  // Stale-authorization entities
  let staleOrgId: string;
  let staleOwnerAId: string;
  let staleOwnerBId: string;
  let staleOwnerCId: string;

  beforeAll(async () => {
    // 1. Verify DB connection
    await prisma.$queryRaw`SELECT 1`;

    // 2. Create Tenant A Organization
    const orgA = await prisma.organization.create({
      data: {
        name: `Tenant A Studio ${testRunId}`,
        slug: `tenant-a-${testRunId}`,
        status: 'ACTIVE',
      },
    });
    tenantAOrgId = orgA.id;

    // 3. Create Tenant B Organization
    const orgB = await prisma.organization.create({
      data: {
        name: `Tenant B Studio ${testRunId}`,
        slug: `tenant-b-${testRunId}`,
        status: 'ACTIVE',
      },
    });
    tenantBOrgId = orgB.id;

    // 4. Create User A and Membership for Tenant A
    const userA = await prisma.user.create({
      data: {
        email: `alice-${testRunId}@tenant-a.internal`,
        name: 'Alice Owner',
        passwordHash: 'dummy_hash_for_test',
        emailVerifiedAt: new Date(),
      },
    });
    tenantAUserId = userA.id;

    await prisma.membership.create({
      data: {
        organizationId: tenantAOrgId,
        userId: tenantAUserId,
        role: Role.OWNER,
      },
    });

    // 5. Create User B and Membership for Tenant B
    const userB = await prisma.user.create({
      data: {
        email: `bob-${testRunId}@tenant-b.internal`,
        name: 'Bob Owner',
        passwordHash: 'dummy_hash_for_test',
        emailVerifiedAt: new Date(),
      },
    });
    tenantBUserId = userB.id;

    await prisma.membership.create({
      data: {
        organizationId: tenantBOrgId,
        userId: tenantBUserId,
        role: Role.OWNER,
      },
    });

    // 6. Create Customer in Tenant A
    const customerA = await prisma.customer.create({
      data: {
        organizationId: tenantAOrgId,
        name: `Client Alpha ${testRunId}`,
        email: `client-a-${testRunId}@test.internal`,
        status: 'ACTIVE',
      },
    });
    customerAId = customerA.id;

    // 7. Create Customer in Tenant B
    const customerB = await prisma.customer.create({
      data: {
        organizationId: tenantBOrgId,
        name: `Client Beta ${testRunId}`,
        email: `client-b-${testRunId}@test.internal`,
        status: 'ACTIVE',
      },
    });
    customerBId = customerB.id;

    // 8. Create Due Recurring Schedule for Tenant A (Due 1 hour ago)
    const initialRunDateA = new Date(Date.now() - 3600 * 1000);
    const scheduleA = await prisma.recurringSchedule.create({
      data: {
        organizationId: tenantAOrgId,
        customerId: customerAId,
        title: `Retainer Ret-A ${testRunId}`,
        frequency: RecurringFrequency.MONTHLY,
        status: RecurringStatus.ACTIVE,
        currency: 'USD',
        subtotal: 1000.0,
        taxRate: 0,
        taxAmount: 0,
        total: 1000.0,
        itemsJson: [
          { description: 'Advisory Retainer', quantity: 1, unitPrice: 1000, total: 1000 },
        ],
        startDate: initialRunDateA,
        nextRunDate: initialRunDateA,
        autoSendEmail: false, // Do not send external emails during test
      },
    });
    scheduleAId = scheduleA.id;

    // 9. Create Due Recurring Schedule for Tenant B (Due 1 hour ago)
    const initialRunDateB = new Date(Date.now() - 3600 * 1000);
    const scheduleB = await prisma.recurringSchedule.create({
      data: {
        organizationId: tenantBOrgId,
        customerId: customerBId,
        title: `Retainer Ret-B ${testRunId}`,
        frequency: RecurringFrequency.MONTHLY,
        status: RecurringStatus.ACTIVE,
        currency: 'USD',
        subtotal: 2500.0,
        taxRate: 0,
        taxAmount: 0,
        total: 2500.0,
        itemsJson: [
          { description: 'Strategy Retainer', quantity: 1, unitPrice: 2500, total: 2500 },
        ],
        startDate: initialRunDateB,
        nextRunDate: initialRunDateB,
        autoSendEmail: false,
      },
    });
    scheduleBId = scheduleB.id;

    // 10. Setup Organization for Concurrency Testing
    const concOrg = await prisma.organization.create({
      data: {
        name: `Last Owner Concurrency Studio ${testRunId}`,
        slug: `conc-owner-${testRunId}`,
        status: 'ACTIVE',
      },
    });
    concOrgId = concOrg.id;

    const u1 = await prisma.user.create({
      data: {
        email: `conc-u1-${testRunId}@flowpilot-test.internal`,
        name: 'Co-Owner One',
        passwordHash: 'dummy_hash_for_test',
        emailVerifiedAt: new Date(),
      },
    });
    user1Id = u1.id;

    const u2 = await prisma.user.create({
      data: {
        email: `conc-u2-${testRunId}@flowpilot-test.internal`,
        name: 'Co-Owner Two',
        passwordHash: 'dummy_hash_for_test',
        emailVerifiedAt: new Date(),
      },
    });
    user2Id = u2.id;

    const u3 = await prisma.user.create({
      data: {
        email: `conc-u3-${testRunId}@flowpilot-test.internal`,
        name: 'Co-Owner Three',
        passwordHash: 'dummy_hash_for_test',
        emailVerifiedAt: new Date(),
      },
    });
    user3Id = u3.id;

    // 11. Setup Organization for Stale-Authorization Tests (3 co-owners)
    const staleOrg = await prisma.organization.create({
      data: {
        name: `Stale Auth Studio ${testRunId}`,
        slug: `stale-auth-${testRunId}`,
        status: 'ACTIVE',
      },
    });
    staleOrgId = staleOrg.id;

    const sA = await prisma.user.create({
      data: {
        email: `stale-a-${testRunId}@flowpilot-test.internal`,
        name: 'Stale Owner A',
        passwordHash: 'dummy_hash_for_test',
        emailVerifiedAt: new Date(),
      },
    });
    staleOwnerAId = sA.id;

    const sB = await prisma.user.create({
      data: {
        email: `stale-b-${testRunId}@flowpilot-test.internal`,
        name: 'Stale Owner B',
        passwordHash: 'dummy_hash_for_test',
        emailVerifiedAt: new Date(),
      },
    });
    staleOwnerBId = sB.id;

    const sC = await prisma.user.create({
      data: {
        email: `stale-c-${testRunId}@flowpilot-test.internal`,
        name: 'Stale Owner C',
        passwordHash: 'dummy_hash_for_test',
        emailVerifiedAt: new Date(),
      },
    });
    staleOwnerCId = sC.id;
  }, 45000);

  afterAll(async () => {
    try {
      const allOrgIds = [tenantAOrgId, tenantBOrgId, concOrgId, staleOrgId].filter(Boolean);
      const allUserIds = [
        tenantAUserId,
        tenantBUserId,
        user1Id,
        user2Id,
        user3Id,
        staleOwnerAId,
        staleOwnerBId,
        staleOwnerCId,
      ].filter(Boolean);

      if (allOrgIds.length > 0) {
        await prisma.invoiceItem.deleteMany({
          where: { invoice: { organizationId: { in: allOrgIds } } },
        });
        await prisma.invoice.deleteMany({
          where: { organizationId: { in: allOrgIds } },
        });
        await prisma.retainerHourLog.deleteMany({
          where: { organizationId: { in: allOrgIds } },
        });
        await prisma.recurringSchedule.deleteMany({
          where: { organizationId: { in: allOrgIds } },
        });
        await prisma.customer.deleteMany({
          where: { organizationId: { in: allOrgIds } },
        });
        await prisma.membership.deleteMany({
          where: { organizationId: { in: allOrgIds } },
        });
        await prisma.organization.deleteMany({
          where: { id: { in: allOrgIds } },
        });
      }

      if (allUserIds.length > 0) {
        await prisma.user.deleteMany({
          where: { id: { in: allUserIds } },
        });
      }
    } catch (cleanupErr) {
      console.warn('Tenant isolation test cleanup warning:', cleanupErr);
    }
  }, 45000);

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  function createTestApp() {
    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use('/api/v1/recurring', recurringRoutes);
    app.use(errorHandler);
    return app;
  }

  describe('Multi-Tenant Boundary Enforcement: POST /api/v1/recurring/process-now', () => {
    it('processes due schedules for Tenant A without touching Tenant B records', async () => {
      // Authenticate as Tenant A Owner
      vi.spyOn(AuthService, 'validateSession').mockResolvedValue({
        sessionId: 'test-session-a',
        user: {
          id: tenantAUserId,
          email: `alice-${testRunId}@tenant-a.internal`,
          name: 'Alice Owner',
          memberships: [
            {
              organizationId: tenantAOrgId,
              organizationName: `Tenant A Studio ${testRunId}`,
              role: Role.OWNER,
            },
          ],
        },
        activeOrganizationId: tenantAOrgId,
      });

      const app = createTestApp();

      // Retrieve Tenant B's initial schedule state from DB
      const initialSchedB = await prisma.recurringSchedule.findUniqueOrThrow({
        where: { id: scheduleBId },
      });

      // Trigger immediate processing as Tenant A
      const res = await request(app)
        .post('/api/v1/recurring/process-now')
        .set('Cookie', 'flowpilot_session=valid-session-tenant-a')
        .set('X-Organization-Id', tenantAOrgId);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.processedCount).toBe(1);
      expect(res.body.data.invoicesCreated).toBe(1);

      // Verify Tenant A in database:
      const updatedSchedA = await prisma.recurringSchedule.findUniqueOrThrow({
        where: { id: scheduleAId },
      });
      // Next run date must have been advanced into the future
      expect(new Date(updatedSchedA.nextRunDate).getTime()).toBeGreaterThan(
        new Date(updatedSchedA.startDate).getTime(),
      );
      expect(updatedSchedA.totalOccurrences).toBe(1);

      // Exactly 1 invoice generated for Tenant A
      const tenantAInvoices = await prisma.invoice.findMany({
        where: { organizationId: tenantAOrgId },
      });
      expect(tenantAInvoices.length).toBe(1);
      expect(tenantAInvoices[0]!.recurringScheduleId).toBe(scheduleAId);
      expect(tenantAInvoices[0]!.total.toNumber()).toBe(1000);

      // CRITICAL MULTI-TENANT ISOLATION ASSERTIONS FOR TENANT B:
      // Tenant B's schedule in DB must be COMPLETELY UNTOUCHED
      const untouchedSchedB = await prisma.recurringSchedule.findUniqueOrThrow({
        where: { id: scheduleBId },
      });
      expect(untouchedSchedB.nextRunDate.toISOString()).toBe(
        initialSchedB.nextRunDate.toISOString(),
      );
      expect(untouchedSchedB.totalOccurrences).toBe(0);
      expect(untouchedSchedB.status).toBe(RecurringStatus.ACTIVE);

      // Zero invoices generated for Tenant B
      const tenantBInvoices = await prisma.invoice.findMany({
        where: { organizationId: tenantBOrgId },
      });
      expect(tenantBInvoices.length).toBe(0);
    });
  });

  describe('Last-OWNER Invariant Concurrency Protection (pg_advisory_xact_lock)', () => {
    it('serializes concurrent demotions so exactly one succeeds and the last OWNER is preserved', async () => {
      // 1. Create two initial OWNER memberships in concOrgId
      const mem1 = await prisma.membership.create({
        data: {
          organizationId: concOrgId,
          userId: user1Id,
          role: Role.OWNER,
        },
      });

      const mem2 = await prisma.membership.create({
        data: {
          organizationId: concOrgId,
          userId: user2Id,
          role: Role.OWNER,
        },
      });

      // Verify initial state: exactly 2 owners
      const initialOwners = await prisma.membership.count({
        where: { organizationId: concOrgId, role: Role.OWNER },
      });
      expect(initialOwners).toBe(2);

      // 2. Concurrently attempt to demote both owners to MEMBER
      // Under race conditions without advisory locking, both would see count=2 and succeed, leaving 0 owners.
      const [res1, res2] = await Promise.allSettled([
        TeamService.updateMemberRole(concOrgId, user1Id, mem1.id, Role.MEMBER, Role.OWNER),
        TeamService.updateMemberRole(concOrgId, user2Id, mem2.id, Role.MEMBER, Role.OWNER),
      ]);

      const fulfilled = [res1, res2].filter((r) => r.status === 'fulfilled');
      const rejected = [res1, res2].filter(
        (r) => r.status === 'rejected',
      ) as PromiseRejectedResult[];

      // Exactly one must succeed and one must be rejected
      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(1);

      // The rejected one must report the sole-owner safety guard
      expect(rejected[0]!.reason.message).toContain('Cannot demote the only organization Owner');

      // 3. Database verification: Exactly 1 OWNER remains in PostgreSQL
      const finalOwners = await prisma.membership.findMany({
        where: { organizationId: concOrgId, role: Role.OWNER },
      });
      expect(finalOwners.length).toBe(1);
      expect([user1Id, user2Id]).toContain(finalOwners[0]!.userId);
    });

    it('serializes concurrent removals so exactly one succeeds and the last OWNER is preserved', async () => {
      // Current state: exactly 1 owner left in concOrgId from previous test.
      const currentOwner = await prisma.membership.findFirstOrThrow({
        where: { organizationId: concOrgId, role: Role.OWNER },
      });

      // Add user3 as a second OWNER
      const mem3 = await prisma.membership.create({
        data: {
          organizationId: concOrgId,
          userId: user3Id,
          role: Role.OWNER,
        },
      });

      // Now exactly 2 owners exist
      const ownersBefore = await prisma.membership.count({
        where: { organizationId: concOrgId, role: Role.OWNER },
      });
      expect(ownersBefore).toBe(2);

      // Concurrently attempt to remove each other:
      // currentOwner tries to remove user3, and user3 tries to remove currentOwner
      const [resRemove1, resRemove2] = await Promise.allSettled([
        TeamService.removeMember(concOrgId, currentOwner.userId, mem3.id, Role.OWNER),
        TeamService.removeMember(concOrgId, user3Id, currentOwner.id, Role.OWNER),
      ]);

      const fulfilled = [resRemove1, resRemove2].filter((r) => r.status === 'fulfilled');
      const rejected = [resRemove1, resRemove2].filter(
        (r) => r.status === 'rejected',
      ) as PromiseRejectedResult[];

      // Exactly one removal must succeed and one must fail
      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(1);
      // The rejected removal must fail due to either sole-owner guard or caller membership invalidation
      expect(rejected[0]!.reason.message).toMatch(
        /Cannot remove the primary Owner from the workspace|Caller is not an active member of this workspace/,
      );

      // Database verification: Exactly 1 OWNER remains
      const ownersAfter = await prisma.membership.findMany({
        where: { organizationId: concOrgId, role: Role.OWNER },
      });
      expect(ownersAfter.length).toBe(1);
    });
  });

  describe('Stale-Authorization TOCTOU Prevention Under Advisory Lock', () => {
    let memBId: string;
    let memCId: string;

    beforeAll(async () => {
      // Create initial 3 OWNER memberships in staleOrgId
      await prisma.membership.create({
        data: {
          organizationId: staleOrgId,
          userId: staleOwnerAId,
          role: Role.OWNER,
        },
      });

      const memB = await prisma.membership.create({
        data: {
          organizationId: staleOrgId,
          userId: staleOwnerBId,
          role: Role.OWNER,
        },
      });
      memBId = memB.id;

      const memC = await prisma.membership.create({
        data: {
          organizationId: staleOrgId,
          userId: staleOwnerCId,
          role: Role.OWNER,
        },
      });
      memCId = memC.id;
    });

    it('rejects an OWNER mutation when caller was demoted to MEMBER while waiting for advisory lock', async () => {
      // Verify initial state: exactly 3 owners
      const initialOwners = await prisma.membership.count({
        where: { organizationId: staleOrgId, role: Role.OWNER },
      });
      expect(initialOwners).toBe(3);

      let lockAcquiredResolve!: () => void;
      const lockAcquiredPromise = new Promise<void>((resolve) => {
        lockAcquiredResolve = resolve;
      });

      let releaseLockResolve!: () => void;
      const releaseLockPromise = new Promise<void>((resolve) => {
        releaseLockResolve = resolve;
      });

      // Tx 1: Owner A holds the advisory lock and demotes Owner B to MEMBER
      const tx1Promise = prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('flowpilot_owner_lock_' || ${staleOrgId}::text, 0::bigint))`;
        await tx.membership.update({
          where: { id: memBId },
          data: { role: Role.MEMBER },
        });
        lockAcquiredResolve();
        await releaseLockPromise;
      });

      // Wait until Tx 1 has acquired the advisory lock and demoted Owner B
      await lockAcquiredPromise;

      // Tx 2: Owner B attempts to demote Owner C while Tx 1 holds the lock.
      // Owner B passes `currentUserRole = Role.OWNER` (captured pre-lock by middleware).
      // Tx 2 must block waiting for the advisory lock held by Tx 1.
      const tx2Promise = TeamService.updateMemberRole(
        staleOrgId,
        staleOwnerBId,
        memCId,
        Role.MEMBER,
        Role.OWNER,
      );

      // Brief wait to ensure Tx 2 has entered $transaction and blocked on pg_advisory_xact_lock
      await new Promise((r) => setTimeout(r, 100));

      // Release Tx 1 lock so Tx 1 commits
      releaseLockResolve();
      await tx1Promise;

      // Tx 2 acquires the lock, re-reads caller B's membership from the database inside the transaction,
      // detects that caller B is no longer an OWNER, and throws ForbiddenError!
      await expect(tx2Promise).rejects.toThrow(
        'Only workspace Owners can modify an Owner account or promote a member to Owner',
      );

      // Verify Target C was NOT mutated in the database:
      const targetC = await prisma.membership.findUniqueOrThrow({ where: { id: memCId } });
      expect(targetC.role).toBe(Role.OWNER);

      // Verify organization still retains exactly 2 OWNERs (Owner A and Owner C):
      const remainingOwners = await prisma.membership.findMany({
        where: { organizationId: staleOrgId, role: Role.OWNER },
      });
      expect(remainingOwners.length).toBe(2);
      expect(remainingOwners.map((o) => o.userId)).toEqual(
        expect.arrayContaining([staleOwnerAId, staleOwnerCId]),
      );
    });

    it('rejects an OWNER mutation when caller was completely removed while waiting for advisory lock', async () => {
      // Re-promote B to OWNER so we can test removal during lock wait
      await prisma.membership.update({
        where: { id: memBId },
        data: { role: Role.OWNER },
      });

      const initialOwners = await prisma.membership.count({
        where: { organizationId: staleOrgId, role: Role.OWNER },
      });
      expect(initialOwners).toBe(3);

      let lockAcquiredResolve!: () => void;
      const lockAcquiredPromise = new Promise<void>((resolve) => {
        lockAcquiredResolve = resolve;
      });

      let releaseLockResolve!: () => void;
      const releaseLockPromise = new Promise<void>((resolve) => {
        releaseLockResolve = resolve;
      });

      // Tx 1: Owner A holds the lock and removes Owner B from the organization
      const tx1Promise = prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('flowpilot_owner_lock_' || ${staleOrgId}::text, 0::bigint))`;
        await tx.membership.delete({
          where: { id: memBId },
        });
        lockAcquiredResolve();
        await releaseLockPromise;
      });

      await lockAcquiredPromise;

      // Tx 2: Owner B attempts to remove Owner C.
      // Owner B passes `currentUserRole = Role.OWNER` (captured pre-lock).
      const tx2Promise = TeamService.removeMember(staleOrgId, staleOwnerBId, memCId, Role.OWNER);

      await new Promise((r) => setTimeout(r, 100));

      // Release Tx 1 lock so Tx 1 commits
      releaseLockResolve();
      await tx1Promise;

      // Tx 2 acquires the lock, re-reads caller B's membership inside transaction,
      // sees that caller B no longer exists in this organization, and throws ForbiddenError!
      await expect(tx2Promise).rejects.toThrow('Caller is not an active member of this workspace');

      // Verify Target C was NOT removed:
      const targetC = await prisma.membership.findUniqueOrThrow({ where: { id: memCId } });
      expect(targetC.role).toBe(Role.OWNER);

      // Verify organization still retains exactly 2 OWNERs:
      const remainingOwners = await prisma.membership.findMany({
        where: { organizationId: staleOrgId, role: Role.OWNER },
      });
      expect(remainingOwners.length).toBe(2);
    });

    it('allows legitimate active OWNER to perform member mutations', async () => {
      // Legitimate active Owner A demotes Target C to ADMIN
      const updated = await TeamService.updateMemberRole(
        staleOrgId,
        staleOwnerAId,
        memCId,
        Role.ADMIN,
        Role.OWNER,
      );

      expect(updated.role).toBe(Role.ADMIN);

      // Verify Target C in database
      const targetC = await prisma.membership.findUniqueOrThrow({ where: { id: memCId } });
      expect(targetC.role).toBe(Role.ADMIN);

      // Organization retains at least 1 OWNER (Owner A)
      const finalOwners = await prisma.membership.findMany({
        where: { organizationId: staleOrgId, role: Role.OWNER },
      });
      expect(finalOwners.length).toBe(1);
      expect(finalOwners[0]!.userId).toBe(staleOwnerAId);
    });
  });
});
