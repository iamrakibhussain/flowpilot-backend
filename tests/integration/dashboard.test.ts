import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { dashboardRoutes } from '../../src/modules/dashboard/dashboard.routes.js';
import { errorHandler } from '../../src/common/middleware/error-handler.js';
import { DashboardService } from '../../src/modules/dashboard/dashboard.service.js';
import { AuthService } from '../../src/modules/auth/auth.service.js';

describe('Dashboard Module Integration Suite', () => {
  const targetOrgId = '123e4567-e89b-42d3-a456-426614174000';

  beforeEach(() => {
    vi.restoreAllMocks();

    vi.spyOn(AuthService, 'validateSession').mockResolvedValue({
      sessionId: 'test-session-id',
      user: {
        id: 'usr-test-1',
        email: 'test@flowpilot.internal',
        name: 'Test Operator',
        memberships: [
          {
            organizationId: targetOrgId,
            organizationName: 'Test Org',
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

    app.use('/api/v1/dashboard', dashboardRoutes);
    app.use(errorHandler);
    return app;
  }

  it('rejects dashboard requests missing X-Organization-Id header with 400 Bad Request', async () => {
    const app = createTestApp();
    const res = await request(app)
      .get('/api/v1/dashboard/metrics')
      .set('Cookie', ['flowpilot_session=valid-test-token']);

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.message).toContain('Missing required X-Organization-Id');
  });

  it('returns 200 OK with comprehensive dashboard metrics when authenticated', async () => {
    const app = createTestApp();
    vi.spyOn(DashboardService, 'getMetrics').mockResolvedValue({
      timeframe: '30d',
      revenue: '$48,250.00',
      revenueGrowth: '+18.4%',
      sparklineD: 'M0,20 Q15,18 25,12 T50,15 T75,8 T100,2',
      sparklineFill: 'M0,20 Q15,18 25,12 T50,15 T75,8 T100,2 L100,25 L0,25 Z',
      clients: '1,280',
      clientsGrowth: '+24 this month',
      appointments: '142',
      appointmentsToday: '8 today',
      appointmentsUpcoming: '134 upcoming',
      responseTime: '18 min',
      periodTotalRevenue: '$48,250.00',
      periodTotalAppointments: '142 Bookings',
      dailyAvgRevenue: '$1,608.33',
      dailyAvgAppointments: '4.7 / day',
      chartPathD: 'M10,130 Q60,110 120,70 T240,85 T360,40 T440,25 T488,10',
      chartAreaD: 'M10,130 Q60,110 120,70 T240,85 T360,40 T440,25 T488,10 L488,160 L10,160 Z',
      xAxisLabels: [
        { full: 'Week 1', short: 'W1' },
        { full: 'Week 2', short: 'W2' },
      ],
      dataPoints: [
        { label: 'Week 1', revenue: '$6,800.00', appointments: '22 Bookings', cx: 80, cy: 120 },
      ],
      receivables: {
        total: '$48,250.00',
        collectionEfficiency: '93.4%',
        avgDso: '24.2 Days',
        settled: { amount: '$38,400.00', percentage: 79.6, count: 18 },
        pending: { amount: '$6,650.00', percentage: 13.8, count: 4 },
        overdue: { amount: '$3,200.00', percentage: 6.6, count: 2 },
      },
    });

    const res = await request(app)
      .get('/api/v1/dashboard/metrics?timeframe=30d')
      .set('Cookie', ['flowpilot_session=valid-test-token'])
      .set('X-Organization-Id', targetOrgId);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.revenue).toBe('$48,250.00');
    expect(res.body.data.receivables.settled.amount).toBe('$38,400.00');
  });

  it('returns 200 OK with recent activities list', async () => {
    const app = createTestApp();
    vi.spyOn(DashboardService, 'getActivities').mockResolvedValue([
      {
        id: 'act-1',
        refCode: 'INV-2026-881',
        client: 'Apex Global Holdings',
        avatarBg: 'bg-blue-600',
        service: 'Enterprise Operations Retainer',
        type: 'invoices',
        date: 'Oct 20, 09:30 AM',
        amount: '$1,450.00',
        status: 'Paid',
        statusVariant: 'success',
      },
    ]);

    const res = await request(app)
      .get('/api/v1/dashboard/activities')
      .set('Cookie', ['flowpilot_session=valid-test-token'])
      .set('X-Organization-Id', targetOrgId);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].refCode).toBe('INV-2026-881');
  });
});
