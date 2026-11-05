import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { recurringRoutes } from '../../src/modules/recurring/recurring.routes.js';
import { errorHandler } from '../../src/common/middleware/error-handler.js';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { NotificationService } from '../../src/modules/notifications/notification.service.js';
import { prisma } from '../../src/database/prisma.js';
import { RecurringFrequency, RecurringStatus } from '@prisma/client';
import { RecurringService } from '../../src/modules/recurring/recurring.service.js';

describe('Recurring Invoicing & Subscriptions Engine Integration Suite', () => {
  const targetOrgId = '123e4567-e89b-42d3-a456-426614174000';
  const ownerUserId = 'usr-owner-1';
  const customerId = '123e4567-e89b-42d3-a456-426614174001';
  const scheduleId = '123e4567-e89b-42d3-a456-426614174099';

  function mockSession(userId: string, role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'BILLING' = 'OWNER') {
    vi.spyOn(AuthService, 'validateSession').mockResolvedValue({
      sessionId: 'test-session-id',
      user: {
        id: userId,
        email: `${role.toLowerCase()}@flowpilot.internal`,
        name: `${role} User`,
        memberships: [
          {
            organizationId: targetOrgId,
            organizationName: 'Acme Advisory Studio',
            role,
            status: 'ACTIVE',
          },
        ],
      },
      activeOrganizationId: targetOrgId,
    });
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    mockSession(ownerUserId, 'OWNER');
    vi.spyOn(NotificationService, 'createNotification').mockResolvedValue({} as any);
  });

  function createTestApp() {
    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use('/api/v1/recurring', recurringRoutes);
    app.use(errorHandler);
    return app;
  }

  const mockCustomer = {
    id: customerId,
    name: 'Sarah Connor',
    email: 'sarah@cyberdyne.test',
    company: 'Cyberdyne Systems',
  };

  const mockScheduleRecord = {
    id: scheduleId,
    organizationId: targetOrgId,
    customerId,
    title: 'Monthly Growth Marketing Retainer',
    frequency: RecurringFrequency.MONTHLY,
    status: RecurringStatus.ACTIVE,
    currency: 'USD',
    subtotal: 2500,
    taxRate: 10,
    taxAmount: 250,
    total: 2750,
    itemsJson: [
      {
        description: 'Monthly Marketing Strategy & Execution',
        quantity: 1,
        unitPrice: 2500,
        amount: 2500,
      },
    ],
    isRetainer: true,
    retainerHours: 20,
    overageHourlyRate: 150,
    startDate: new Date('2026-11-01T00:00:00.000Z'),
    endDate: null,
    nextRunDate: new Date('2026-12-01T00:00:00.000Z'),
    lastRunDate: new Date('2026-11-01T00:00:00.000Z'),
    totalOccurrences: 1,
    maxOccurrences: null,
    autoSendEmail: true,
    paymentDueDays: 14,
    createdAt: new Date('2026-11-01T00:00:00.000Z'),
    updatedAt: new Date('2026-11-01T00:00:00.000Z'),
    customer: mockCustomer,
    retainerLogs: [
      {
        id: 'log-1',
        cycleStartDate: new Date('2026-11-01T00:00:00.000Z'),
        cycleEndDate: new Date('2026-12-01T00:00:00.000Z'),
        hoursAllocated: 20,
        hoursLogged: 12,
        overageHours: 0,
        notes: null,
        createdAt: new Date('2026-11-01T00:00:00.000Z'),
      },
    ],
    generatedInvoices: [],
    _count: { generatedInvoices: 1 },
  };

  describe('POST /api/v1/recurring', () => {
    it('creates a recurring schedule with calculated totals and initial retainer ledger', async () => {
      vi.spyOn(prisma.customer, 'findFirst').mockResolvedValue(mockCustomer as any);
      vi.spyOn(prisma, '$transaction').mockImplementation(async (callback: any) => {
        return callback({
          recurringSchedule: {
            create: vi.fn().mockResolvedValue(mockScheduleRecord),
          },
          retainerHourLog: {
            create: vi.fn().mockResolvedValue({ id: 'log-1' }),
          },
        });
      });
      vi.spyOn(prisma.recurringSchedule, 'findFirst').mockResolvedValue(mockScheduleRecord as any);

      const app = createTestApp();
      const res = await request(app)
        .post('/api/v1/recurring')
        .set('Cookie', 'flowpilot_session=valid-session')
        .set('X-Organization-Id', targetOrgId)
        .send({
          customerId,
          title: 'Monthly Growth Marketing Retainer',
          frequency: 'MONTHLY',
          currency: 'USD',
          taxRate: 10,
          items: [
            {
              description: 'Monthly Marketing Strategy & Execution',
              quantity: 1,
              unitPrice: 2500,
            },
          ],
          isRetainer: true,
          retainerHours: 20,
          overageHourlyRate: 150,
          startDate: '2026-11-01T00:00:00.000Z',
          autoSendEmail: true,
          paymentDueDays: 14,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.title).toBe('Monthly Growth Marketing Retainer');
      expect(res.body.data.subtotal).toBe(2500);
      expect(res.body.data.taxAmount).toBe(250);
      expect(res.body.data.total).toBe(2750);
      expect(res.body.data.isRetainer).toBe(true);
      expect(res.body.data.currentRetainerLog).toBeDefined();
      expect(res.body.data.currentRetainerLog.hoursRemaining).toBe(8);
    });

    it('rejects creation if customer is not found in organization', async () => {
      vi.spyOn(prisma.customer, 'findFirst').mockResolvedValue(null);

      const app = createTestApp();
      const res = await request(app)
        .post('/api/v1/recurring')
        .set('Cookie', 'flowpilot_session=valid-session')
        .set('X-Organization-Id', targetOrgId)
        .send({
          customerId,
          title: 'Consulting Retainer',
          startDate: '2026-11-01T00:00:00.000Z',
          items: [{ description: 'Strategy', quantity: 1, unitPrice: 1000 }],
        });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it('validates required fields and line items', async () => {
      const app = createTestApp();
      const res = await request(app)
        .post('/api/v1/recurring')
        .set('Cookie', 'flowpilot_session=valid-session')
        .set('X-Organization-Id', targetOrgId)
        .send({
          customerId,
          title: 'A', // too short
          items: [], // empty
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe('GET /api/v1/recurring', () => {
    it('returns paginated recurring schedules scoped to tenant', async () => {
      vi.spyOn(prisma.recurringSchedule, 'count').mockResolvedValue(1);
      vi.spyOn(prisma.recurringSchedule, 'findMany').mockResolvedValue([mockScheduleRecord as any]);

      const app = createTestApp();
      const res = await request(app)
        .get('/api/v1/recurring')
        .set('Cookie', 'flowpilot_session=valid-session')
        .set('X-Organization-Id', targetOrgId);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBe(1);
      expect(res.body.meta.total).toBe(1);
    });
  });

  describe('GET /api/v1/recurring/stats', () => {
    it('calculates aggregate statistics and estimated MRR', async () => {
      vi.spyOn(prisma.recurringSchedule, 'findMany').mockResolvedValue([
        mockScheduleRecord as any,
        {
          ...mockScheduleRecord,
          id: 'schedule-2',
          frequency: RecurringFrequency.WEEKLY,
          total: 500,
          status: RecurringStatus.ACTIVE,
          isRetainer: false,
          _count: { generatedInvoices: 4 },
        } as any,
      ]);

      const app = createTestApp();
      const res = await request(app)
        .get('/api/v1/recurring/stats')
        .set('Cookie', 'flowpilot_session=valid-session')
        .set('X-Organization-Id', targetOrgId);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.totalSchedules).toBe(2);
      expect(res.body.data.activeSchedules).toBe(2);
      expect(res.body.data.activeRetainers).toBe(1);
      expect(res.body.data.estimatedMRR).toBeGreaterThan(0);
    });
  });

  describe('POST /api/v1/recurring/:id/pause, resume, and cancel', () => {
    it('pauses and resumes schedule state atomically', async () => {
      vi.spyOn(prisma.recurringSchedule, 'findFirst').mockResolvedValue(mockScheduleRecord as any);
      vi.spyOn(prisma.recurringSchedule, 'update').mockResolvedValue({
        ...mockScheduleRecord,
        status: RecurringStatus.PAUSED,
      } as any);

      const app = createTestApp();
      const pauseRes = await request(app)
        .post(`/api/v1/recurring/${scheduleId}/pause`)
        .set('Cookie', 'flowpilot_session=valid-session')
        .set('X-Organization-Id', targetOrgId);

      expect(pauseRes.status).toBe(200);
      expect(pauseRes.body.success).toBe(true);

      const resumeRes = await request(app)
        .post(`/api/v1/recurring/${scheduleId}/resume`)
        .set('Cookie', 'flowpilot_session=valid-session')
        .set('X-Organization-Id', targetOrgId);

      expect(resumeRes.status).toBe(200);
      expect(resumeRes.body.success).toBe(true);
    });

    it('cancels a recurring schedule', async () => {
      vi.spyOn(prisma.recurringSchedule, 'findFirst').mockResolvedValue(mockScheduleRecord as any);
      vi.spyOn(prisma.recurringSchedule, 'update').mockResolvedValue({
        ...mockScheduleRecord,
        status: RecurringStatus.CANCELLED,
      } as any);

      const app = createTestApp();
      const cancelRes = await request(app)
        .post(`/api/v1/recurring/${scheduleId}/cancel`)
        .set('Cookie', 'flowpilot_session=valid-session')
        .set('X-Organization-Id', targetOrgId);

      expect(cancelRes.status).toBe(200);
      expect(cancelRes.body.success).toBe(true);
    });
  });

  describe('POST /api/v1/recurring/:id/retainer-hours', () => {
    it('logs hours and computes overage when exceeding allocated retainer quota', async () => {
      vi.spyOn(prisma.recurringSchedule, 'findFirst').mockResolvedValue(mockScheduleRecord as any);
      vi.spyOn(prisma.retainerHourLog, 'findFirst').mockResolvedValue({
        id: 'log-1',
        organizationId: targetOrgId,
        scheduleId,
        hoursAllocated: 20,
        hoursLogged: 18,
        overageHours: 0,
        notes: null,
      } as any);
      vi.spyOn(prisma.retainerHourLog, 'update').mockResolvedValue({
        id: 'log-1',
        hoursAllocated: 20,
        hoursLogged: 24,
        overageHours: 4,
        notes: '[2026-11-04] +6h: Sprint deployment',
      } as any);

      const app = createTestApp();
      const res = await request(app)
        .post(`/api/v1/recurring/${scheduleId}/retainer-hours`)
        .set('Cookie', 'flowpilot_session=valid-session')
        .set('X-Organization-Id', targetOrgId)
        .send({
          hours: 6,
          notes: 'Sprint deployment',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.hoursLogged).toBe(24);
      expect(res.body.data.overageHours).toBe(4);
      expect(res.body.data.hoursRemaining).toBe(0);
    });
  });

  describe('POST /api/v1/recurring/process-now', () => {
    it('triggers immediate processing of due schedules via advisory lock', async () => {
      vi.spyOn(RecurringService, 'processDueSchedules').mockResolvedValue({
        processedCount: 1,
        invoicesCreated: 1,
        completedSchedules: 0,
      });

      const app = createTestApp();
      const res = await request(app)
        .post('/api/v1/recurring/process-now')
        .set('Cookie', 'flowpilot_session=valid-session')
        .set('X-Organization-Id', targetOrgId);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.processedCount).toBe(1);
      expect(res.body.data.invoicesCreated).toBe(1);
    });
  });

  describe('RecurringService.calculateNextRunDate', () => {
    it('computes exact cadences across all supported frequencies', () => {
      const base = new Date('2026-01-15T12:00:00.000Z');

      const weekly = RecurringService.calculateNextRunDate(base, RecurringFrequency.WEEKLY);
      expect(weekly.getDate()).toBe(22);

      const biWeekly = RecurringService.calculateNextRunDate(base, RecurringFrequency.BI_WEEKLY);
      expect(biWeekly.getDate()).toBe(29);

      const monthly = RecurringService.calculateNextRunDate(base, RecurringFrequency.MONTHLY);
      expect(monthly.getMonth()).toBe(1); // February

      const quarterly = RecurringService.calculateNextRunDate(base, RecurringFrequency.QUARTERLY);
      expect(quarterly.getMonth()).toBe(3); // April

      const annually = RecurringService.calculateNextRunDate(base, RecurringFrequency.ANNUALLY);
      expect(annually.getFullYear()).toBe(2027);
    });
  });
});
