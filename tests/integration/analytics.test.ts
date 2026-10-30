import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { analyticsRoutes } from '../../src/modules/analytics/analytics.routes.js';
import { errorHandler } from '../../src/common/middleware/error-handler.js';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { prisma } from '../../src/database/prisma.js';
import { Decimal } from '@prisma/client/runtime/library';

describe('Executive Business Intelligence & Analytics Suite', () => {
  const targetOrgId = '123e4567-e89b-42d3-a456-426614174000';

  beforeEach(() => {
    vi.restoreAllMocks();

    vi.spyOn(AuthService, 'validateSession').mockResolvedValue({
      sessionId: 'test-session-id',
      user: {
        id: 'usr-test-1',
        email: 'test@flowpilot.internal',
        name: 'Test Executive',
        memberships: [
          {
            organizationId: targetOrgId,
            organizationName: 'Prime Enterprise',
            role: 'OWNER',
            status: 'ACTIVE',
          },
        ],
      },
      activeOrganizationId: targetOrgId,
    });
  });

  function createTestApp() {
    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use('/api/v1/analytics', analyticsRoutes);
    app.use(errorHandler);
    return app;
  }

  it('rejects analytics requests missing X-Organization-Id header with 400 Bad Request', async () => {
    const app = createTestApp();
    const res = await request(app)
      .get('/api/v1/analytics/overview')
      .set('Cookie', ['flowpilot_session=valid-test-token']);

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('BAD_REQUEST');
  });

  it('rejects cross-tenant analytics access with 403 Forbidden', async () => {
    const foreignOrgId = '987fcdeb-51a2-43f7-9876-543210987654';
    vi.spyOn(prisma.membership, 'findUnique').mockResolvedValue(null);

    const app = createTestApp();
    const res = await request(app)
      .get('/api/v1/analytics/overview')
      .set('Cookie', ['flowpilot_session=valid-test-token'])
      .set('X-Organization-Id', foreignOrgId);

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(res.body.error.message).toContain('You do not have access to this organization');
  });

  it('returns executive financial overview metrics with trends', async () => {
    vi.spyOn(prisma.invoice as any, 'findMany').mockImplementation(async (args: any) => {
      if (args?.where?.status === 'PAID') {
        return [
          { total: new Decimal(250), netAmount: new Decimal(242.5) },
          { total: new Decimal(150), netAmount: new Decimal(145.5) },
        ] as any;
      }
      if (args?.where?.status === 'PENDING') {
        return [{ total: new Decimal(500) }] as any;
      }
      return [] as any;
    });

    vi.spyOn(prisma.appointment, 'findMany').mockResolvedValue([
      { status: 'COMPLETED', durationMinutes: 60, depositAmount: new Decimal(50) },
      { status: 'COMPLETED', durationMinutes: 45, depositAmount: null },
      { status: 'CANCELLED', durationMinutes: 30, depositAmount: null },
    ] as any);

    vi.spyOn(prisma.staffMember, 'count').mockResolvedValue(3);

    const app = createTestApp();
    const res = await request(app)
      .get('/api/v1/analytics/overview?timeframe=30d')
      .set('Cookie', ['flowpilot_session=valid-test-token'])
      .set('X-Organization-Id', targetOrgId);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.grossRevenue).toBe(400); // 250 + 150
    expect(res.body.data.atv).toBe(200); // 400 / 2 paid invoices
    expect(res.body.data.outstandingAr).toBe(500);
    expect(res.body.data.totalAppointments).toBe(3);
    expect(res.body.data.completedAppointments).toBe(2);
    expect(res.body.data.appointmentFulfillmentRate).toBe(67); // 2/3 ~ 67%
    expect(res.body.data.trends).toBeDefined();
  });

  it('returns cashflow trajectory time-series points', async () => {
    const today = new Date();
    vi.spyOn(prisma.invoice, 'findMany').mockResolvedValue([
      {
        total: new Decimal(300),
        status: 'PAID',
        issueDate: today,
        paidAt: today,
      },
    ] as any);

    vi.spyOn(prisma.appointment, 'findMany').mockResolvedValue([{ scheduledAt: today }] as any);

    const app = createTestApp();
    const res = await request(app)
      .get('/api/v1/analytics/cashflow?timeframe=7d')
      .set('Cookie', ['flowpilot_session=valid-test-token'])
      .set('X-Organization-Id', targetOrgId);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
    const todayKey = today.toISOString().slice(0, 10);
    const point = res.body.data.find((p: any) => p.date === todayKey);
    expect(point).toBeDefined();
    expect(point.billed).toBe(300);
    expect(point.collected).toBe(300);
    expect(point.appointmentsCount).toBe(1);
  });

  it('returns services profitability matrix with revenue ranking', async () => {
    vi.spyOn(prisma.service, 'findMany').mockResolvedValue([
      {
        id: 'srv-1',
        name: 'Executive Strategy',
        category: 'Advisory',
        price: new Decimal(200),
        appointments: [
          { id: 'appt-1', status: 'COMPLETED' },
          { id: 'appt-2', status: 'COMPLETED' },
        ],
      },
      {
        id: 'srv-2',
        name: 'Express Check',
        category: 'Consultation',
        price: new Decimal(50),
        appointments: [{ id: 'appt-3', status: 'COMPLETED' }],
      },
    ] as any);

    const app = createTestApp();
    const res = await request(app)
      .get('/api/v1/analytics/services?timeframe=30d')
      .set('Cookie', ['flowpilot_session=valid-test-token'])
      .set('X-Organization-Id', targetOrgId);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0].name).toBe('Executive Strategy');
    expect(res.body.data[0].revenueGenerated).toBe(400); // 200 * 2
    expect(res.body.data[1].revenueGenerated).toBe(50); // 50 * 1
    expect(res.body.data[0].sharePercentage).toBe(89); // 400 / 450 ~ 89%
  });

  it('returns workforce productivity and specialist leaderboard', async () => {
    vi.spyOn(prisma.staffMember, 'findMany').mockResolvedValue([
      {
        id: 'stf-1',
        name: 'Dr. John Doe',
        roleTitle: 'Senior Partner',
        avatarBg: 'bg-indigo-600',
        initials: 'JD',
        status: 'AVAILABLE',
        appointments: [
          {
            status: 'COMPLETED',
            durationMinutes: 90,
            service: { price: new Decimal(350) },
          },
        ],
      },
    ] as any);

    const app = createTestApp();
    const res = await request(app)
      .get('/api/v1/analytics/staff?timeframe=30d')
      .set('Cookie', ['flowpilot_session=valid-test-token'])
      .set('X-Organization-Id', targetOrgId);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data[0].name).toBe('Dr. John Doe');
    expect(res.body.data[0].completedSessions).toBe(1);
    expect(res.body.data[0].billableMinutes).toBe(90);
    expect(res.body.data[0].revenueAttributed).toBe(350);
  });

  it('returns customer retention and cohort intelligence', async () => {
    const today = new Date();
    vi.spyOn(prisma.customer, 'findMany').mockResolvedValue([
      {
        id: 'cust-1',
        createdAt: today,
        appointments: [
          { id: 'a1', scheduledAt: today },
          { id: 'a2', scheduledAt: today },
        ],
        invoices: [{ total: new Decimal(500) }],
      },
      {
        id: 'cust-2',
        createdAt: new Date(Date.now() - 90 * 86400000),
        appointments: [{ id: 'a3', scheduledAt: new Date(Date.now() - 70 * 86400000) }],
        invoices: [{ total: new Decimal(200) }],
      },
    ] as any);

    const app = createTestApp();
    const res = await request(app)
      .get('/api/v1/analytics/customers?timeframe=30d')
      .set('Cookie', ['flowpilot_session=valid-test-token'])
      .set('X-Organization-Id', targetOrgId);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.totalCustomers).toBe(2);
    expect(res.body.data.repeatCustomers).toBe(1); // cust-1 has 2 appointments
    expect(res.body.data.atRiskCount).toBe(1); // cust-2 had appointment >60d ago
    expect(res.body.data.averageLtv).toBe(350); // (500 + 200) / 2
  });

  it('exports RFC 4180 audit CSV report with proper content disposition', async () => {
    vi.spyOn(prisma.invoice, 'findMany').mockResolvedValue([]);
    vi.spyOn(prisma.appointment, 'findMany').mockResolvedValue([]);
    vi.spyOn(prisma.staffMember, 'count').mockResolvedValue(1);
    vi.spyOn(prisma.service, 'findMany').mockResolvedValue([]);
    vi.spyOn(prisma.staffMember, 'findMany').mockResolvedValue([]);

    const app = createTestApp();
    const res = await request(app)
      .get('/api/v1/analytics/export?timeframe=30d')
      .set('Cookie', ['flowpilot_session=valid-test-token'])
      .set('X-Organization-Id', targetOrgId);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain(
      'attachment; filename="flowpilot-analytics-30d.csv"',
    );
    expect(res.text).toContain('--- EXECUTIVE FINANCIAL & OPERATIONS SUMMARY ---');
  });
});
