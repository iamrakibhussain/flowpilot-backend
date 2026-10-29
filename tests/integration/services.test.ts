import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { serviceRoutes } from '../../src/modules/services/service.routes.js';
import { errorHandler } from '../../src/common/middleware/error-handler.js';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { prisma } from '../../src/database/prisma.js';
import { Decimal } from '@prisma/client/runtime/library';

describe('Service Catalog Module Integration Suite', () => {
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
    app.use('/api/v1/services', serviceRoutes);
    app.use(errorHandler);
    return app;
  }

  it('rejects service requests missing X-Organization-Id header with 400 Bad Request', async () => {
    const app = createTestApp();
    const res = await request(app)
      .get('/api/v1/services')
      .set('Cookie', ['flowpilot_session=valid-test-token']);

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('BAD_REQUEST');
  });

  it('lists services with categories, buffer times and assigned staff', async () => {
    const mockServices = [
      {
        id: 'srv-1',
        organizationId: targetOrgId,
        name: 'Executive Consultation',
        description: 'Strategic advisory session',
        category: 'Advisory',
        price: new Decimal('250.00'),
        durationMinutes: 60,
        bufferBefore: 15,
        bufferAfter: 15,
        isActive: true,
        requireDeposit: true,
        depositType: 'FIXED',
        depositAmount: new Decimal('50.00'),
        createdAt: new Date('2026-01-01T10:00:00Z'),
        updatedAt: new Date('2026-01-01T10:00:00Z'),
        staffMembers: [
          {
            staffMember: {
              id: 'stf-1',
              name: 'Dr. John Doe',
              roleTitle: 'Senior Specialist',
              avatarBg: 'bg-emerald-600',
              initials: 'JD',
            },
          },
        ],
        _count: {
          appointments: 12,
        },
      },
    ];

    vi.spyOn(prisma.service, 'findMany').mockResolvedValueOnce(mockServices as any);

    const app = createTestApp();
    const res = await request(app)
      .get('/api/v1/services?category=Advisory')
      .set('Cookie', ['flowpilot_session=valid-test-token'])
      .set('X-Organization-Id', targetOrgId);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data[0].name).toBe('Executive Consultation');
    expect(res.body.data[0].category).toBe('Advisory');
    expect(res.body.data[0].bufferBefore).toBe(15);
    expect(res.body.data[0].bufferAfter).toBe(15);
    expect(res.body.data[0].staffMembers).toHaveLength(1);
    expect(res.body.data[0].appointmentCount).toBe(12);
  });

  it('creates a new service with buffer protection and staff assignment', async () => {
    vi.spyOn(prisma.staffMember, 'findMany').mockResolvedValueOnce([{ id: 'stf-1' }] as any);

    const createdRecord = {
      id: 'srv-new',
      organizationId: targetOrgId,
      name: 'Deep Tissue Massage',
      description: '60-minute therapy',
      category: 'Therapy',
      price: new Decimal('120.00'),
      durationMinutes: 60,
      bufferBefore: 10,
      bufferAfter: 15,
      isActive: true,
      requireDeposit: true,
      depositType: 'PERCENTAGE',
      depositAmount: new Decimal('20.00'),
      createdAt: new Date('2026-02-01T10:00:00Z'),
      updatedAt: new Date('2026-02-01T10:00:00Z'),
      staffMembers: [
        {
          staffMember: {
            id: 'stf-1',
            name: 'Sarah Smith',
            roleTitle: 'Lead Therapist',
            avatarBg: 'bg-blue-600',
            initials: 'SS',
          },
        },
      ],
      _count: {
        appointments: 0,
      },
    };

    vi.spyOn(prisma.service, 'create').mockResolvedValueOnce(createdRecord as any);

    const app = createTestApp();
    const res = await request(app)
      .post('/api/v1/services')
      .set('Cookie', ['flowpilot_session=valid-test-token'])
      .set('X-Organization-Id', targetOrgId)
      .send({
        name: 'Deep Tissue Massage',
        description: '60-minute therapy',
        category: 'Therapy',
        price: 120,
        durationMinutes: 60,
        bufferBefore: 10,
        bufferAfter: 15,
        isActive: true,
        requireDeposit: true,
        depositType: 'PERCENTAGE',
        depositAmount: 20,
        staffMemberIds: ['stf-1'],
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe('srv-new');
    expect(res.body.data.name).toBe('Deep Tissue Massage');
    expect(res.body.data.depositType).toBe('PERCENTAGE');
  });

  it('safely archives a service if it has historical appointments', async () => {
    vi.spyOn(prisma.service, 'findFirst').mockResolvedValueOnce({
      id: 'srv-with-appts',
      organizationId: targetOrgId,
      _count: { appointments: 5 },
    } as any);

    const updateSpy = vi.spyOn(prisma.service, 'update').mockResolvedValueOnce({} as any);

    const app = createTestApp();
    const res = await request(app)
      .delete('/api/v1/services/srv-with-appts')
      .set('Cookie', ['flowpilot_session=valid-test-token'])
      .set('X-Organization-Id', targetOrgId);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.archived).toBe(true);
    expect(updateSpy).toHaveBeenCalledWith({
      where: { id: 'srv-with-appts' },
      data: { isActive: false },
    });
  });
});
