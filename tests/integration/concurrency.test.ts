import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { prisma } from '../../src/database/prisma.js';
import { AppointmentService } from '../../src/modules/appointments/appointment.service.js';
import { InvoiceService } from '../../src/modules/invoices/invoice.service.js';
import { PortalService } from '../../src/modules/portal/portal.service.js';
import { DashboardService } from '../../src/modules/dashboard/dashboard.service.js';
import { appointmentRoutes } from '../../src/modules/appointments/appointment.routes.js';
import { errorHandler } from '../../src/common/middleware/error-handler.js';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { AppointmentType } from '@prisma/client';

describe('Database Concurrency & Data Integrity Hardening Suite', () => {
  const testRunId = `conc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

  // Test entities
  let org1Id: string;
  let org2Id: string;
  let staffAId: string;
  let staffBId: string;
  let staffCId: string;
  let customer1Id: string;
  let customer2Id: string;
  let service1Id: string;

  beforeAll(async () => {
    // 1. Verify connection
    await prisma.$queryRaw`SELECT 1`;

    // 2. Create Org 1
    const org1 = await prisma.organization.create({
      data: {
        name: `Concurrency Org 1 ${testRunId}`,
        slug: `conc-org-1-${testRunId}`,
        status: 'ACTIVE',
      },
    });
    org1Id = org1.id;

    // 3. Create Org 2 (multi-tenant boundary test)
    const org2 = await prisma.organization.create({
      data: {
        name: `Concurrency Org 2 ${testRunId}`,
        slug: `conc-org-2-${testRunId}`,
        status: 'ACTIVE',
      },
    });
    org2Id = org2.id;

    // 4. Create Staff in Org 1
    const staffA = await prisma.staffMember.create({
      data: {
        organizationId: org1Id,
        name: `Specialist A ${testRunId}`,
        email: `specialist-a-${testRunId}@flowpilot-test.internal`,
        roleTitle: 'Senior Specialist',
        initials: 'SA',
        status: 'AVAILABLE',
      },
    });
    staffAId = staffA.id;

    const staffB = await prisma.staffMember.create({
      data: {
        organizationId: org1Id,
        name: `Specialist B ${testRunId}`,
        email: `specialist-b-${testRunId}@flowpilot-test.internal`,
        roleTitle: 'Senior Specialist',
        initials: 'SB',
        status: 'AVAILABLE',
      },
    });
    staffBId = staffB.id;

    // 5. Create Staff in Org 2
    const staffC = await prisma.staffMember.create({
      data: {
        organizationId: org2Id,
        name: `Specialist C ${testRunId}`,
        email: `specialist-c-${testRunId}@flowpilot-test.internal`,
        roleTitle: 'Regional Specialist',
        initials: 'SC',
        status: 'AVAILABLE',
      },
    });
    staffCId = staffC.id;

    // 6. Create Customers
    const cust1 = await prisma.customer.create({
      data: {
        organizationId: org1Id,
        name: `Client One ${testRunId}`,
        email: `client-1-${testRunId}@flowpilot-test.internal`,
        status: 'ACTIVE',
      },
    });
    customer1Id = cust1.id;

    const cust2 = await prisma.customer.create({
      data: {
        organizationId: org2Id,
        name: `Client Two ${testRunId}`,
        email: `client-2-${testRunId}@flowpilot-test.internal`,
        status: 'ACTIVE',
      },
    });
    customer2Id = cust2.id;

    // 7. Create Service in Org 1
    const service1 = await prisma.service.create({
      data: {
        organizationId: org1Id,
        name: 'Standard Strategy Consultation',
        durationMinutes: 60,
        price: 150.0,
      },
    });
    service1Id = service1.id;
  }, 30000);

  afterAll(async () => {
    try {
      const orgIds = [org1Id, org2Id].filter(Boolean);
      if (orgIds.length > 0) {
        // Cascade delete will clean up related records, but clean explicitly for safety
        await prisma.invoiceItem.deleteMany({
          where: { invoice: { organizationId: { in: orgIds } } },
        });
        await prisma.invoice.deleteMany({ where: { organizationId: { in: orgIds } } });
        await prisma.appointment.deleteMany({ where: { organizationId: { in: orgIds } } });
        await prisma.$executeRaw`DELETE FROM organization_sequences WHERE organization_id = ANY(${orgIds}::text[])`;
        await prisma.service.deleteMany({ where: { organizationId: { in: orgIds } } });
        await prisma.staffMember.deleteMany({ where: { organizationId: { in: orgIds } } });
        await prisma.customer.deleteMany({ where: { organizationId: { in: orgIds } } });
        await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
      }
    } catch (cleanupErr) {
      console.warn('Test cleanup notice:', cleanupErr);
    }
  }, 30000);

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Task 1 — Appointment Concurrency & Double-Booking Prevention', () => {
    it('prevents double-booking when two requests attempt to book the exact same slot concurrently', async () => {
      const targetSlot = new Date('2027-06-15T10:00:00.000Z');

      const bookingAttempt1 = AppointmentService.createAppointment(org1Id, {
        customerId: customer1Id,
        staffMemberId: staffAId,
        serviceId: service1Id,
        title: 'Concurrent Booking Alpha',
        scheduledAt: targetSlot.toISOString(),
        durationMinutes: 60,
        type: AppointmentType.IN_PERSON,
      });

      const bookingAttempt2 = AppointmentService.createAppointment(org1Id, {
        customerId: customer1Id,
        staffMemberId: staffAId,
        serviceId: service1Id,
        title: 'Concurrent Booking Beta',
        scheduledAt: targetSlot.toISOString(),
        durationMinutes: 60,
        type: AppointmentType.IN_PERSON,
      });

      const [res1, res2] = await Promise.allSettled([bookingAttempt1, bookingAttempt2]);

      const successes = [res1, res2].filter((r) => r.status === 'fulfilled');
      const failures = [res1, res2].filter((r) => r.status === 'rejected');

      // Exactly 1 must succeed and exactly 1 must fail due to conflict detection
      expect(successes.length).toBe(1);
      expect(failures.length).toBe(1);

      const firstFailure = failures[0];
      if (firstFailure && firstFailure.status === 'rejected') {
        expect(firstFailure.reason.message).toContain('Schedule Conflict');
      }

      // Verify PostgreSQL database state: exactly 1 appointment recorded for this slot
      const appointments = await prisma.appointment.findMany({
        where: {
          organizationId: org1Id,
          staffMemberId: staffAId,
          scheduledAt: targetSlot,
        },
      });
      expect(appointments.length).toBe(1);
    });

    it('allows simultaneous bookings for different staff members without false contention', async () => {
      const slotTime = new Date('2027-06-15T14:00:00.000Z');

      const bookStaffA = AppointmentService.createAppointment(org1Id, {
        customerId: customer1Id,
        staffMemberId: staffAId,
        title: 'Parallel Staff A Appointment',
        scheduledAt: slotTime.toISOString(),
        durationMinutes: 60,
        type: AppointmentType.IN_PERSON,
      });

      const bookStaffB = AppointmentService.createAppointment(org1Id, {
        customerId: customer1Id,
        staffMemberId: staffBId,
        title: 'Parallel Staff B Appointment',
        scheduledAt: slotTime.toISOString(),
        durationMinutes: 60,
        type: AppointmentType.IN_PERSON,
      });

      const bookStaffC = AppointmentService.createAppointment(org2Id, {
        customerId: customer2Id,
        staffMemberId: staffCId,
        title: 'Parallel Org2 Staff C Appointment',
        scheduledAt: slotTime.toISOString(),
        durationMinutes: 60,
        type: AppointmentType.IN_PERSON,
      });

      const results = await Promise.all([bookStaffA, bookStaffB, bookStaffC]);

      expect(results.length).toBe(3);
      expect(results[0]?.staffMemberId).toBe(staffAId);
      expect(results[1]?.staffMemberId).toBe(staffBId);
      expect(results[2]?.staffMemberId).toBe(staffCId);
    });

    it('rejects overlapping appointment with differing duration starting mid-interval', async () => {
      const baseStart = new Date('2027-07-01T10:00:00.000Z');

      // 60-minute appointment: 10:00 to 11:00
      const initialApt = await AppointmentService.createAppointment(org1Id, {
        customerId: customer1Id,
        staffMemberId: staffAId,
        title: 'Initial 60min Consultation',
        scheduledAt: baseStart.toISOString(),
        durationMinutes: 60,
        type: AppointmentType.IN_PERSON,
      });
      expect(initialApt.id).toBeDefined();

      // Attempt 30-minute appointment starting mid-interval: 10:30 to 11:00
      const midIntervalStart = new Date('2027-07-01T10:30:00.000Z');
      await expect(
        AppointmentService.createAppointment(org1Id, {
          customerId: customer1Id,
          staffMemberId: staffAId,
          title: 'Conflicting 30min Followup',
          scheduledAt: midIntervalStart.toISOString(),
          durationMinutes: 30,
          type: AppointmentType.IN_PERSON,
        }),
      ).rejects.toThrow(/Schedule Conflict/);
    });

    it('allows contiguous back-to-back appointments for the same staff member', async () => {
      const slot1 = new Date('2027-07-02T10:00:00.000Z');
      const slot2 = new Date('2027-07-02T11:00:00.000Z');

      const apt1 = await AppointmentService.createAppointment(org1Id, {
        customerId: customer1Id,
        staffMemberId: staffAId,
        title: 'Morning Block 1',
        scheduledAt: slot1.toISOString(),
        durationMinutes: 60,
        type: AppointmentType.IN_PERSON,
      });

      const apt2 = await AppointmentService.createAppointment(org1Id, {
        customerId: customer1Id,
        staffMemberId: staffAId,
        title: 'Morning Block 2 (Immediate next)',
        scheduledAt: slot2.toISOString(),
        durationMinutes: 60,
        type: AppointmentType.IN_PERSON,
      });

      expect(apt1.id).toBeDefined();
      expect(apt2.id).toBeDefined();
    });

    it('allows re-booking a slot if previous appointment in that slot was cancelled', async () => {
      const slotTime = new Date('2027-07-03T10:00:00.000Z');

      const firstApt = await AppointmentService.createAppointment(org1Id, {
        customerId: customer1Id,
        staffMemberId: staffBId,
        title: 'Appointment to be cancelled',
        scheduledAt: slotTime.toISOString(),
        durationMinutes: 60,
        type: AppointmentType.IN_PERSON,
      });

      // Cancel appointment
      await AppointmentService.cancelAppointment(org1Id, firstApt.id, 'Client had an emergency');

      // Re-book the same slot for the same specialist
      const rebookedApt = await AppointmentService.createAppointment(org1Id, {
        customerId: customer1Id,
        staffMemberId: staffBId,
        title: 'Rebooked Consultation',
        scheduledAt: slotTime.toISOString(),
        durationMinutes: 60,
        type: AppointmentType.IN_PERSON,
      });

      expect(rebookedApt.id).toBeDefined();
      expect(rebookedApt.status).toBe('CONFIRMED');
    });

    it('prevents portal rescheduling to an already booked specialist slot', async () => {
      const slot1 = new Date('2027-07-04T10:00:00.000Z');
      const slot2 = new Date('2027-07-04T14:00:00.000Z');

      // Booking 1 for Staff A at 10:00
      await AppointmentService.createAppointment(org1Id, {
        customerId: customer1Id,
        staffMemberId: staffAId,
        title: 'Morning Session',
        scheduledAt: slot1.toISOString(),
        durationMinutes: 60,
        type: AppointmentType.IN_PERSON,
      });

      // Booking 2 for Staff A at 14:00
      const afternoonApt = await AppointmentService.createAppointment(org1Id, {
        customerId: customer1Id,
        staffMemberId: staffAId,
        title: 'Afternoon Session',
        scheduledAt: slot2.toISOString(),
        durationMinutes: 60,
        type: AppointmentType.IN_PERSON,
      });

      // Attempt to reschedule Booking 2 to 10:00 via PortalService
      await expect(
        PortalService.rescheduleAppointment(org1Id, customer1Id, afternoonApt.id, {
          newScheduledAt: slot1.toISOString(),
        }),
      ).rejects.toThrow(/not available at the selected time/);
    });
  });

  describe('Task 2 — Invoice Number Generation Concurrency & Sequential Integrity Concurrency & Sequential Integrity', () => {
    it('generates collision-free, strictly sequential invoice numbers under concurrent creation in same org', async () => {
      const CONCURRENT_COUNT = 4;

      const creationPromises = Array.from({ length: CONCURRENT_COUNT }).map((_, idx) =>
        InvoiceService.createInvoice(org1Id, {
          customerId: customer1Id,
          items: [
            {
              description: `Concurrent Batch Item ${idx + 1}`,
              quantity: 1,
              unitPrice: 100 + idx,
            },
          ],
          issueDate: new Date().toISOString(),
          dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
        }),
      );

      const createdInvoices = await Promise.all(creationPromises);

      expect(createdInvoices.length).toBe(CONCURRENT_COUNT);

      // Verify uniqueness: all generated invoice numbers must be distinct
      const invoiceNumbers = createdInvoices.map((inv) => inv.invoiceNumber);
      const uniqueNumbers = new Set(invoiceNumbers);
      expect(uniqueNumbers.size).toBe(CONCURRENT_COUNT);

      // Verify format: INV-YYYY-XXXX
      const currentYear = new Date().getFullYear();
      for (const num of invoiceNumbers) {
        expect(num).toMatch(new RegExp(`^INV-${currentYear}-\\d{4}$`));
      }

      // Verify sequence records in PostgreSQL
      const seqRecord = await prisma.$queryRaw<{ last_sequence: number }[]>`
        SELECT last_sequence FROM organization_sequences
        WHERE organization_id = ${org1Id} AND entity_type = 'INVOICE' AND year = ${currentYear}
      `;
      expect(seqRecord.length).toBe(1);
      expect(Number(seqRecord[0]?.last_sequence)).toBeGreaterThanOrEqual(CONCURRENT_COUNT);
    });

    it('isolates sequence generation across multiple organizations concurrently', async () => {
      const currentYear = new Date().getFullYear();

      // Run concurrent requests for Org 1 and Org 2 simultaneously
      const org1Requests = Array.from({ length: 2 }).map(() =>
        InvoiceService.createInvoice(org1Id, {
          customerId: customer1Id,
          items: [{ description: 'Org 1 Concurrent Item', quantity: 1, unitPrice: 50 }],
          dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        }),
      );

      const org2Requests = Array.from({ length: 2 }).map(() =>
        InvoiceService.createInvoice(org2Id, {
          customerId: customer2Id,
          items: [{ description: 'Org 2 Concurrent Item', quantity: 1, unitPrice: 75 }],
          dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        }),
      );

      const [org1Results, org2Results] = await Promise.all([
        Promise.all(org1Requests),
        Promise.all(org2Requests),
      ]);

      expect(org1Results.length).toBe(2);
      expect(org2Results.length).toBe(2);

      // Check Org 1 sequence
      const org1Seq = await prisma.$queryRaw<{ last_sequence: number }[]>`
        SELECT last_sequence FROM organization_sequences
        WHERE organization_id = ${org1Id} AND entity_type = 'INVOICE' AND year = ${currentYear}
      `;
      // Check Org 2 sequence
      const org2Seq = await prisma.$queryRaw<{ last_sequence: number }[]>`
        SELECT last_sequence FROM organization_sequences
        WHERE organization_id = ${org2Id} AND entity_type = 'INVOICE' AND year = ${currentYear}
      `;

      expect(Number(org2Seq[0]?.last_sequence)).toBe(2);
      expect(Number(org1Seq[0]?.last_sequence)).toBeGreaterThanOrEqual(6); // 4 from prev test + 2 from this
    });

    it('respects existing historical invoice numbers when initializing sequence counters', async () => {
      const currentYear = new Date().getFullYear();

      // Create a separate isolated test organization for historical sequence check
      const historicalOrg = await prisma.organization.create({
        data: {
          name: `Historical Sequence Test Org ${testRunId}`,
          slug: `hist-org-${testRunId}`,
          status: 'ACTIVE',
        },
      });

      const histCust = await prisma.customer.create({
        data: {
          organizationId: historicalOrg.id,
          name: 'Historical Customer',
          email: `hist-cust-${testRunId}@flowpilot-test.internal`,
          status: 'ACTIVE',
        },
      });

      // Insert pre-existing historical invoice with high sequence number: INV-YYYY-0500
      await prisma.invoice.create({
        data: {
          organizationId: historicalOrg.id,
          customerId: histCust.id,
          invoiceNumber: `INV-${currentYear}-0500`,
          issueDate: new Date(),
          dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
          status: 'PAID',
          subtotal: 100,
          tax: 0,
          total: 100,
        },
      });

      // Generate next invoice number via service
      const nextInvNum = await InvoiceService.generateInvoiceNumber(historicalOrg.id);
      expect(nextInvNum).toBe(`INV-${currentYear}-0501`);

      // Clean up historical test org
      await prisma.invoice.deleteMany({ where: { organizationId: historicalOrg.id } });
      await prisma.$executeRaw`DELETE FROM organization_sequences WHERE organization_id = ${historicalOrg.id}`;
      await prisma.customer.deleteMany({ where: { organizationId: historicalOrg.id } });
      await prisma.organization.deleteMany({ where: { id: historicalOrg.id } });
    });
  });

  describe('Authenticated Appointment Booking Route — POST /api/v1/appointments', () => {
    function createAppointmentApp() {
      const app = express();
      app.use(express.json());
      app.use(cookieParser());
      app.use('/api/v1/appointments', appointmentRoutes);
      app.use(errorHandler);
      return app;
    }

    it('successfully books an appointment with valid cookie + tenant header and rejects conflicting concurrent request', async () => {
      const app = createAppointmentApp();
      const sessionToken = 'valid-concurrency-session-token';

      vi.spyOn(AuthService, 'validateSession').mockResolvedValue({
        sessionId: `sess-${testRunId}`,
        user: {
          id: `usr-${testRunId}`,
          email: `admin-${testRunId}@flowpilot-test.internal`,
          name: 'Concurrency Admin',
          memberships: [
            {
              organizationId: org1Id,
              organizationName: `Concurrency Org 1 ${testRunId}`,
              role: 'OWNER',
              status: 'ACTIVE',
            },
          ],
        },
        activeOrganizationId: org1Id,
      });

      const routeSlot = new Date('2027-08-10T14:00:00.000Z');

      // 1. Initial valid booking through authenticated HTTP route
      const res1 = await request(app)
        .post('/api/v1/appointments')
        .set('Cookie', [`flowpilot_session=${sessionToken}`])
        .set('X-Organization-Id', org1Id)
        .send({
          customerId: customer1Id,
          staffMemberId: staffAId,
          serviceId: service1Id,
          title: 'Route Scheduled Consultation',
          scheduledAt: routeSlot.toISOString(),
          durationMinutes: 60,
          type: 'IN_PERSON',
        });

      expect(res1.status).toBe(201);
      expect(res1.body.success).toBe(true);
      expect(res1.body.data.id).toBeDefined();
      expect(res1.body.data.scheduledAt).toBe(routeSlot.toISOString());

      // 2. Conflicting booking attempt on same staff member & overlapping time window
      const res2 = await request(app)
        .post('/api/v1/appointments')
        .set('Cookie', [`flowpilot_session=${sessionToken}`])
        .set('X-Organization-Id', org1Id)
        .send({
          customerId: customer1Id,
          staffMemberId: staffAId,
          serviceId: service1Id,
          title: 'Conflicting Route Consultation',
          scheduledAt: routeSlot.toISOString(),
          durationMinutes: 60,
          type: 'IN_PERSON',
        });

      expect(res2.status).toBe(400);
      expect(res2.body.success).toBe(false);
      expect(res2.body.error.message).toMatch(/Schedule Conflict/);

      // Verify database state: exactly 1 appointment recorded
      const dbAppointments = await prisma.appointment.findMany({
        where: {
          organizationId: org1Id,
          staffMemberId: staffAId,
          scheduledAt: routeSlot,
        },
      });
      expect(dbAppointments.length).toBe(1);
    });
  });

  describe('Invoice Transaction Rollback & Atomicity', () => {
    it('ensures forced database error during invoice transaction leaves zero orphaned invoices or line items', async () => {
      const invNum = await InvoiceService.generateInvoiceNumber(org1Id);

      // Execute transaction that fails midway after creating invoice
      await expect(
        prisma.$transaction(async (tx) => {
          await tx.invoice.create({
            data: {
              organizationId: org1Id,
              customerId: customer1Id,
              invoiceNumber: invNum,
              subtotal: 250,
              tax: 0,
              total: 250,
              status: 'PENDING',
              dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
              items: {
                create: [
                  {
                    description: 'Atomic Test Item 1',
                    quantity: 1,
                    unitPrice: 150,
                    amount: 150,
                  },
                  {
                    description: 'Atomic Test Item 2',
                    quantity: 1,
                    unitPrice: 100,
                    amount: 100,
                  },
                ],
              },
            },
          });

          // Simulate downstream or network failure inside transaction boundary
          throw new Error('SIMULATED_TRANSACTION_FAILURE_ROLLBACK');
        }),
      ).rejects.toThrow('SIMULATED_TRANSACTION_FAILURE_ROLLBACK');

      // Verify full rollback: no invoice and no invoice items exist in PostgreSQL
      const orphanInvoice = await prisma.invoice.findFirst({
        where: { organizationId: org1Id, invoiceNumber: invNum },
      });
      expect(orphanInvoice).toBeNull();

      const orphanItems = await prisma.invoiceItem.findMany({
        where: {
          invoice: { organizationId: org1Id, invoiceNumber: invNum },
        },
      });
      expect(orphanItems.length).toBe(0);
    });
  });

  describe('Invoice P2002 Retry Mechanics & Fresh Sequence Allocation', () => {
    it('retries with fresh sequence number and new transaction client on P2002 collision, then succeeds', async () => {
      const currentYear = new Date().getFullYear();

      // Pre-seed an existing invoice number in the database that will cause initial collision
      const collisionNumber = `INV-${currentYear}-7777`;
      await prisma.invoice.create({
        data: {
          organizationId: org1Id,
          customerId: customer1Id,
          invoiceNumber: collisionNumber,
          subtotal: 100,
          tax: 0,
          total: 100,
          status: 'PENDING',
          dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      });

      const originalGenerate = InvoiceService.generateInvoiceNumber.bind(InvoiceService);
      let callCount = 0;

      // Mock generateInvoiceNumber: call 1 returns existing collisionNumber, call 2 calls original real generator
      const generateSpy = vi
        .spyOn(InvoiceService, 'generateInvoiceNumber')
        .mockImplementation(async (targetOrgId, tx) => {
          callCount++;
          if (callCount === 1) {
            return collisionNumber; // Will trigger P2002 unique constraint in Postgres
          }
          return originalGenerate(targetOrgId, tx);
        });

      const invoice = await InvoiceService.createInvoice(org1Id, {
        customerId: customer1Id,
        items: [{ description: 'P2002 Retry Test Item', quantity: 1, unitPrice: 200 }],
        dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      });

      expect(callCount).toBe(2);
      expect(invoice.id).toBeDefined();
      expect(invoice.invoiceNumber).not.toBe(collisionNumber);
      expect(invoice.invoiceNumber).toMatch(new RegExp(`^INV-${currentYear}-\\d{4}$`));

      generateSpy.mockRestore();

      // Clean up collision invoice
      await prisma.invoice.deleteMany({
        where: { organizationId: org1Id, invoiceNumber: collisionNumber },
      });
    });

    it('terminates and throws after exceeding MAX_RETRIES (3 attempts) on persistent P2002 collisions', async () => {
      const currentYear = new Date().getFullYear();
      const persistentCollision = `INV-${currentYear}-8888`;

      await prisma.invoice.create({
        data: {
          organizationId: org1Id,
          customerId: customer1Id,
          invoiceNumber: persistentCollision,
          subtotal: 50,
          tax: 0,
          total: 50,
          status: 'PENDING',
          dueDate: new Date(),
        },
      });

      let attemptsCount = 0;
      const generateSpy = vi
        .spyOn(InvoiceService, 'generateInvoiceNumber')
        .mockImplementation(async () => {
          attemptsCount++;
          return persistentCollision; // Persistently collides
        });

      await expect(
        InvoiceService.createInvoice(org1Id, {
          customerId: customer1Id,
          items: [{ description: 'Persistent Collision Item', quantity: 1, unitPrice: 50 }],
          dueDate: new Date().toISOString(),
        }),
      ).rejects.toThrow();

      // Exactly 3 attempts must be executed before exhausting MAX_RETRIES
      expect(attemptsCount).toBe(3);

      generateSpy.mockRestore();

      // Clean up
      await prisma.invoice.deleteMany({
        where: { organizationId: org1Id, invoiceNumber: persistentCollision },
      });
    });
  });

  describe('Dashboard Service Concurrency & Sequence Standardization', () => {
    it('prevents concurrent double-booking through DashboardService.createAppointment', async () => {
      const dashSlot = new Date('2027-09-01T11:00:00.000Z');

      const dashBooking1 = DashboardService.createAppointment(org1Id, {
        customerId: customer1Id,
        staffMemberId: staffAId,
        serviceId: service1Id,
        title: 'Dashboard Quick Booking 1',
        scheduledAt: dashSlot.toISOString(),
        durationMinutes: 60,
      });

      const dashBooking2 = DashboardService.createAppointment(org1Id, {
        customerId: customer1Id,
        staffMemberId: staffAId,
        serviceId: service1Id,
        title: 'Dashboard Quick Booking 2',
        scheduledAt: dashSlot.toISOString(),
        durationMinutes: 60,
      });

      const [res1, res2] = await Promise.allSettled([dashBooking1, dashBooking2]);
      const fulfilled = [res1, res2].filter((r) => r.status === 'fulfilled');
      const rejected = [res1, res2].filter((r) => r.status === 'rejected');

      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(1);

      if (rejected[0]?.status === 'rejected') {
        expect(rejected[0].reason.message).toContain('Schedule Conflict');
      }
    });

    it('generates atomic sequential invoice numbers through DashboardService.createInvoice', async () => {
      const currentYear = new Date().getFullYear();

      const dashInvoice = await DashboardService.createInvoice(org1Id, {
        customerId: customer1Id,
        amount: 350,
        description: 'Dashboard Retainer Invoice',
        status: 'PENDING',
      });

      expect(dashInvoice.id).toBeDefined();
      expect(dashInvoice.invoiceNumber).toMatch(new RegExp(`^INV-${currentYear}-\\d{4}$`));
      // Ensure legacy 890 offset is NOT present
      expect(dashInvoice.invoiceNumber).not.toContain('-890');
      expect(dashInvoice.items.length).toBe(1);
    });
  });
});
