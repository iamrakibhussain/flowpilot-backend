import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { publicBookingRoutes } from '../../src/modules/public-booking/public-booking.routes.js';
import { errorHandler } from '../../src/common/middleware/error-handler.js';
import { prisma } from '../../src/database/prisma.js';
import { Decimal } from '@prisma/client/runtime/library';

describe('Public Booking Portal Integration Suite', () => {
  const orgSlug = 'apex-wellness';
  const orgId = '123e4567-e89b-42d3-a456-426614174000';

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  function createPublicTestApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/v1/public/booking', publicBookingRoutes);
    app.use(errorHandler);
    return app;
  }

  it('retrieves public organization booking profile by slug without auth', async () => {
    const mockOrg = {
      id: orgId,
      name: 'Apex Wellness Studio',
      slug: orgSlug,
      status: 'ACTIVE',
      bookingEnabled: true,
      bookingTitle: 'Book Your Wellness Appointment',
      bookingNotice: 'Please arrive 10 minutes prior.',
      services: [
        {
          id: 'srv-1',
          name: 'Signature Facial',
          description: 'Rejuvenating skin treatment',
          category: 'Skincare',
          price: new Decimal('150.00'),
          durationMinutes: 60,
          bufferBefore: 10,
          bufferAfter: 15,
          requireDeposit: false,
          depositType: 'FIXED',
          depositAmount: null,
          staffMembers: [{ staffMemberId: 'stf-1' }],
        },
      ],
      staffMembers: [
        {
          id: 'stf-1',
          name: 'Elena Rostova',
          roleTitle: 'Master Esthetician',
          avatarBg: 'bg-emerald-600',
          initials: 'ER',
          bio: 'Certified skincare specialist with 10 years experience.',
        },
      ],
    };

    vi.spyOn(prisma.organization, 'findUnique').mockResolvedValueOnce(mockOrg as any);

    const app = createPublicTestApp();
    const res = await request(app).get(`/api/v1/public/booking/${orgSlug}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe('Apex Wellness Studio');
    expect(res.body.data.services).toHaveLength(1);
    expect(res.body.data.services[0].name).toBe('Signature Facial');
    expect(res.body.data.staffMembers[0].name).toBe('Elena Rostova');
  });

  it('returns 400 when business has disabled online booking', async () => {
    vi.spyOn(prisma.organization, 'findUnique').mockResolvedValueOnce({
      id: orgId,
      name: 'Apex Wellness Studio',
      slug: orgSlug,
      status: 'ACTIVE',
      bookingEnabled: false,
      services: [],
      staffMembers: [],
    } as any);

    const app = createPublicTestApp();
    const res = await request(app).get(`/api/v1/public/booking/${orgSlug}`);

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.message).toContain('disabled');
  });

  it('generates available time slots factoring in staff shift and buffers', async () => {
    // 2026-11-02 is Monday (UTC)
    vi.spyOn(prisma.organization, 'findUnique').mockResolvedValueOnce({
      id: orgId,
      status: 'ACTIVE',
      bookingEnabled: true,
    } as any);

    vi.spyOn(prisma.service, 'findFirst').mockResolvedValueOnce({
      id: 'srv-1',
      organizationId: orgId,
      durationMinutes: 60,
      bufferBefore: 0,
      bufferAfter: 0,
      isActive: true,
      staffMembers: [{ staffMemberId: 'stf-1' }],
    } as any);

    vi.spyOn(prisma.staffMember, 'findMany').mockResolvedValueOnce([
      {
        id: 'stf-1',
        organizationId: orgId,
        status: 'AVAILABLE',
        workingDays: ['MON', 'TUE', 'WED', 'THU', 'FRI'],
        shiftStart: '09:00',
        shiftEnd: '11:00', // Fits 09:00-10:00, 09:30-10:30, 10:00-11:00
      },
    ] as any);

    vi.spyOn(prisma.appointment, 'findMany').mockResolvedValueOnce([]);

    const app = createPublicTestApp();
    const res = await request(app).get(
      `/api/v1/public/booking/${orgSlug}/slots?serviceId=srv-1&date=2026-11-02`,
    );

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data[0].startTime).toBe('09:00');
    expect(res.body.data[0].endTime).toBe('10:00');
  });

  it('atomically creates appointment and registers customer for valid slot', async () => {
    vi.spyOn(prisma.organization, 'findUnique').mockResolvedValue({
      id: orgId,
      name: 'Apex Wellness Studio',
      status: 'ACTIVE',
      bookingEnabled: true,
    } as any);

    vi.spyOn(prisma.service, 'findFirst').mockResolvedValue({
      id: 'srv-1',
      organizationId: orgId,
      name: 'Signature Facial',
      durationMinutes: 60,
      bufferBefore: 0,
      bufferAfter: 0,
      price: new Decimal('150.00'),
      requireDeposit: false,
      depositAmount: null,
      isActive: true,
      staffMembers: [{ staffMemberId: 'stf-1' }],
    } as any);

    vi.spyOn(prisma.staffMember, 'findMany').mockResolvedValue([
      {
        id: 'stf-1',
        organizationId: orgId,
        status: 'AVAILABLE',
        workingDays: ['MON'],
        shiftStart: '09:00',
        shiftEnd: '12:00',
      },
    ] as any);

    vi.spyOn(prisma.appointment, 'findMany').mockResolvedValue([]);
    vi.spyOn(prisma.staffMember, 'findUnique').mockResolvedValue({
      id: 'stf-1',
      name: 'Elena Rostova',
    } as any);

    vi.spyOn(prisma, '$transaction').mockImplementation(async (callback: any) => {
      const mockTx = {
        customer: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue({
            id: 'cust-new',
            name: 'Client Jane',
            email: 'jane@example.com',
          }),
        },
        appointment: {
          create: vi.fn().mockResolvedValue({
            id: 'appt-new',
            scheduledAt: new Date('2026-11-02T09:00:00Z'),
            durationMinutes: 60,
            status: 'CONFIRMED',
          }),
        },
      };
      return callback(mockTx);
    });

    const app = createPublicTestApp();
    const res = await request(app).post(`/api/v1/public/booking/${orgSlug}/book`).send({
      serviceId: 'srv-1',
      staffMemberId: 'stf-1',
      date: '2026-11-02',
      time: '09:00',
      customerName: 'Client Jane',
      customerEmail: 'jane@example.com',
      customerPhone: '+1-555-0199',
      notes: 'First time visiting',
    });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.appointmentId).toBe('appt-new');
    expect(res.body.data.serviceName).toBe('Signature Facial');
    expect(res.body.data.staffName).toBe('Elena Rostova');
    expect(res.body.data.customerEmail).toBe('jane@example.com');
  });
});
