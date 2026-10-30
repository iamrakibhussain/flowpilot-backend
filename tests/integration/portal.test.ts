import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { portalRoutes } from '../../src/modules/portal/portal.routes.js';
import { errorHandler } from '../../src/common/middleware/error-handler.js';
import { prisma } from '../../src/database/prisma.js';
import { PORTAL_COOKIE_NAME } from '../../src/modules/portal/portal.middleware.js';
import { Decimal } from '@prisma/client/runtime/library';

describe('Client Self-Service Portal Integration Suite', () => {
  const orgSlug = 'apex-studio';
  const orgId = '123e4567-e89b-42d3-a456-426614174000';
  const customerId = 'cst-4567-e89b-42d3-a456-426614174001';

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  function createPortalTestApp() {
    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use('/api/v1/portal', portalRoutes);
    app.use(errorHandler);
    return app;
  }

  describe('POST /api/v1/portal/auth/request-link', () => {
    it('dispatches a magic link and 6-digit OTP code to an existing customer', async () => {
      vi.spyOn(prisma.organization, 'findUnique').mockResolvedValue({
        id: orgId,
        name: 'Apex Studio',
        slug: orgSlug,
        brandColor: '#2563eb',
        logoUrl: null,
      } as any);

      vi.spyOn(prisma.customer, 'findFirst').mockResolvedValue({
        id: customerId,
        name: 'Jane Doe',
        email: 'jane@example.com',
      } as any);

      vi.spyOn(prisma.customerPortalToken, 'create').mockResolvedValue({
        id: 'tok-1',
      } as any);

      const app = createPortalTestApp();
      const res = await request(app).post('/api/v1/portal/auth/request-link').send({
        email: 'jane@example.com',
        organizationSlug: orgSlug,
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain('sign-in link and passcode have been sent');
      expect(prisma.customerPortalToken.create).toHaveBeenCalledOnce();
    });

    it('returns generic success even if customer does not exist (anti-enumeration)', async () => {
      vi.spyOn(prisma.organization, 'findUnique').mockResolvedValue({
        id: orgId,
        name: 'Apex Studio',
        slug: orgSlug,
        brandColor: '#2563eb',
        logoUrl: null,
      } as any);

      vi.spyOn(prisma.customer, 'findFirst').mockResolvedValue(null);
      const createSpy = vi.spyOn(prisma.customerPortalToken, 'create');

      const app = createPortalTestApp();
      const res = await request(app).post('/api/v1/portal/auth/request-link').send({
        email: 'unknown@example.com',
        organizationSlug: orgSlug,
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(createSpy).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/v1/portal/auth/verify', () => {
    it('authenticates valid 6-digit passcode and sets portal session cookie', async () => {
      vi.spyOn(prisma.organization, 'findUnique').mockResolvedValue({
        id: orgId,
        name: 'Apex Studio',
        slug: orgSlug,
      } as any);

      vi.spyOn(prisma.customerPortalToken, 'findFirst').mockResolvedValue({
        id: 'tok-1',
        organizationId: orgId,
        customerId,
        customer: {
          id: customerId,
          name: 'Jane Doe',
          email: 'jane@example.com',
        },
      } as any);

      vi.spyOn(prisma.customerPortalToken, 'update').mockResolvedValue({} as any);
      vi.spyOn(prisma.customerPortalSession, 'create').mockResolvedValue({} as any);

      const app = createPortalTestApp();
      const res = await request(app).post('/api/v1/portal/auth/verify').send({
        organizationSlug: orgSlug,
        code: '123456',
      });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.customer.email).toBe('jane@example.com');
      expect(res.headers['set-cookie']).toBeDefined();
      expect(res.headers['set-cookie'][0]).toContain(PORTAL_COOKIE_NAME);
    });

    it('rejects invalid or expired verification code with 401', async () => {
      vi.spyOn(prisma.organization, 'findUnique').mockResolvedValue({
        id: orgId,
        name: 'Apex Studio',
        slug: orgSlug,
      } as any);

      vi.spyOn(prisma.customerPortalToken, 'findFirst').mockResolvedValue(null);

      const app = createPortalTestApp();
      const res = await request(app).post('/api/v1/portal/auth/verify').send({
        organizationSlug: orgSlug,
        code: '999999',
      });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });
  });

  describe('GET /api/v1/portal/dashboard', () => {
    it('returns 401 if unauthenticated', async () => {
      const app = createPortalTestApp();
      const res = await request(app).get('/api/v1/portal/dashboard');
      expect(res.status).toBe(401);
    });

    it('returns customer appointments, invoices, and brand when authenticated with cookie', async () => {
      vi.spyOn(prisma.customerPortalSession, 'findFirst').mockResolvedValue({
        id: 'sess-1',
        organizationId: orgId,
        customerId,
        customer: {
          id: customerId,
          name: 'Jane Doe',
          email: 'jane@example.com',
          phone: '+1555123456',
          company: 'Acme Corp',
        },
        organization: {
          id: orgId,
          name: 'Apex Studio',
          slug: orgSlug,
        },
      } as any);

      vi.spyOn(prisma.customerPortalSession, 'update').mockResolvedValue({} as any);

      vi.spyOn(prisma.organization, 'findUnique').mockResolvedValue({
        id: orgId,
        name: 'Apex Studio',
        slug: orgSlug,
        brandColor: '#2563eb',
        logoUrl: null,
        tagline: 'Modern Wellness',
        customDomain: 'booking.apex.com',
        contactEmail: 'hello@apex.com',
        contactPhone: null,
        address: null,
        currency: 'USD',
        timezone: 'UTC',
        minNoticeHours: 2,
        cancellationHours: 24,
        bookingEnabled: true,
      } as any);

      vi.spyOn(prisma.customer, 'findUnique').mockResolvedValue({
        id: customerId,
        name: 'Jane Doe',
        email: 'jane@example.com',
        phone: '+1555123456',
        company: 'Acme Corp',
        createdAt: new Date(),
      } as any);

      const futureDate = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
      vi.spyOn(prisma.appointment, 'findMany').mockResolvedValue([
        {
          id: 'appt-1',
          title: 'Consultation',
          scheduledAt: futureDate,
          durationMinutes: 60,
          status: 'CONFIRMED',
          type: 'VIDEO',
          service: {
            id: 'srv-1',
            name: 'Consultation',
            price: new Decimal('100.00'),
            durationMinutes: 60,
          },
          staffMember: {
            id: 'stf-1',
            name: 'Dr. Smith',
            roleTitle: 'Senior Specialist',
            initials: 'DS',
            avatarBg: 'bg-blue-600',
          },
        },
      ] as any);

      vi.spyOn(prisma.invoice, 'findMany').mockResolvedValue([
        {
          id: 'inv-1',
          invoiceNumber: 'INV-2026-001',
          total: new Decimal('100.00'),
          status: 'PAID',
          createdAt: new Date(),
          items: [],
          transactions: [],
        },
      ] as any);

      const app = createPortalTestApp();
      const res = await request(app)
        .get('/api/v1/portal/dashboard')
        .set('Cookie', `${PORTAL_COOKIE_NAME}=test-raw-token`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.customer.name).toBe('Jane Doe');
      expect(res.body.data.appointments.upcoming).toHaveLength(1);
      expect(res.body.data.invoices.metrics.totalPaid).toBe('100.00');
    });
  });

  describe('PATCH /api/v1/portal/appointments/:id/reschedule', () => {
    it('enforces minNoticeHours and rejects reschedule within notice window', async () => {
      vi.spyOn(prisma.customerPortalSession, 'findFirst').mockResolvedValue({
        id: 'sess-1',
        organizationId: orgId,
        customerId,
        customer: { id: customerId, name: 'Jane Doe' },
        organization: { id: orgId, name: 'Apex Studio', slug: orgSlug },
      } as any);
      vi.spyOn(prisma.customerPortalSession, 'update').mockResolvedValue({} as any);

      // Appointment starting in 30 minutes (violating 2-hour notice)
      const nearFuture = new Date(Date.now() + 30 * 60 * 1000);
      vi.spyOn(prisma.appointment, 'findFirst').mockResolvedValue({
        id: 'appt-1',
        organizationId: orgId,
        customerId,
        scheduledAt: nearFuture,
        status: 'CONFIRMED',
        organization: { minNoticeHours: 2 },
      } as any);

      const app = createPortalTestApp();
      const res = await request(app)
        .patch('/api/v1/portal/appointments/appt-1/reschedule')
        .set('Cookie', `${PORTAL_COOKIE_NAME}=test-raw-token`)
        .send({
          newScheduledAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
        });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain('minimum notice window');
    });
  });

  describe('PATCH /api/v1/portal/appointments/:id/cancel', () => {
    it('cancels appointment and records audit reason note', async () => {
      vi.spyOn(prisma.customerPortalSession, 'findFirst').mockResolvedValue({
        id: 'sess-1',
        organizationId: orgId,
        customerId,
        customer: { id: customerId, name: 'Jane Doe' },
        organization: { id: orgId, name: 'Apex Studio', slug: orgSlug },
      } as any);
      vi.spyOn(prisma.customerPortalSession, 'update').mockResolvedValue({} as any);

      const farFuture = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
      vi.spyOn(prisma.appointment, 'findFirst').mockResolvedValue({
        id: 'appt-1',
        organizationId: orgId,
        customerId,
        scheduledAt: farFuture,
        status: 'CONFIRMED',
        notes: 'Existing client notes',
        organization: { cancellationHours: 24 },
      } as any);

      vi.spyOn(prisma.appointment, 'update').mockResolvedValue({
        id: 'appt-1',
        status: 'CANCELLED',
      } as any);

      const app = createPortalTestApp();
      const res = await request(app)
        .patch('/api/v1/portal/appointments/appt-1/cancel')
        .set('Cookie', `${PORTAL_COOKIE_NAME}=test-raw-token`)
        .send({
          reason: 'Family emergency, need to cancel',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(prisma.appointment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'CANCELLED',
            notes: expect.stringContaining('Family emergency'),
          }),
        }),
      );
    });
  });
});
