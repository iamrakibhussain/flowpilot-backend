import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { staffRoutes } from '../../src/modules/staff/staff.routes.js';
import { errorHandler } from '../../src/common/middleware/error-handler.js';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { prisma } from '../../src/database/prisma.js';

describe('Staff Blocked Time & Availability Module Integration Suite', () => {
  const targetOrgId = '123e4567-e89b-42d3-a456-426614174000';
  const ownerUserId = 'usr-owner-1';
  const memberUserId = 'usr-member-1';
  const otherStaffId = '123e4567-e89b-42d3-a456-426614174002';

  function mockSession(userId: string, role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'BILLING') {
    vi.spyOn(AuthService, 'validateSession').mockResolvedValue({
      sessionId: 'test-session-id',
      user: {
        id: userId,
        email: `${role.toLowerCase()}@flowpilot.internal`,
        name: `${role} User`,
        memberships: [
          {
            organizationId: targetOrgId,
            organizationName: 'Test Org',
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(prisma.workspaceAuditLog, 'create').mockResolvedValue({} as any);
  });

  function createTestApp() {
    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use('/api/v1/staff', staffRoutes);
    app.use(errorHandler);
    return app;
  }

  it('rejects requests missing X-Organization-Id with 400 Bad Request', async () => {
    const app = createTestApp();
    const res = await request(app)
      .get('/api/v1/staff/blocked-time')
      .set('Cookie', ['flowpilot_session=valid-test-token']);

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('BAD_REQUEST');
  });

  it('allows OWNER to create a company-wide holiday and writes an audit log', async () => {
    const app = createTestApp();

    const auditSpy = vi.spyOn(prisma.workspaceAuditLog, 'create').mockResolvedValue({} as any);
    const mockCreated = {
      id: 'bt-1',
      organizationId: targetOrgId,
      staffMemberId: null,
      title: 'National Holiday',
      type: 'COMPANY_HOLIDAY',
      startTime: new Date('2026-12-25T00:00:00.000Z'),
      endTime: new Date('2026-12-25T23:59:59.999Z'),
      allDay: true,
      notes: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      staffMember: null,
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma as any).blockedTime = {
      create: vi.fn().mockResolvedValue(mockCreated),
    };
    vi.spyOn(prisma.appointment, 'count').mockResolvedValue(0);

    const res = await request(app)
      .post('/api/v1/staff/blocked-time')
      .set('Cookie', ['flowpilot_session=valid-test-token'])
      .set('X-Organization-Id', targetOrgId)
      .send({
        title: 'National Holiday',
        type: 'COMPANY_HOLIDAY',
        startTime: '2026-12-25T00:00:00.000Z',
        endTime: '2026-12-25T23:59:59.999Z',
        allDay: true,
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.type).toBe('COMPANY_HOLIDAY');
    expect(res.body.data.staffMemberId).toBeNull();
    expect(auditSpy).toHaveBeenCalled();
  });

  it('forbids MEMBER from creating a company-wide holiday', async () => {
    mockSession(memberUserId, 'MEMBER');
    const app = createTestApp();

    const res = await request(app)
      .post('/api/v1/staff/blocked-time')
      .set('Cookie', ['flowpilot_session=valid-test-token'])
      .set('X-Organization-Id', targetOrgId)
      .send({
        title: 'Unauthorized Holiday',
        type: 'COMPANY_HOLIDAY',
        startTime: '2026-12-25T00:00:00.000Z',
        endTime: '2026-12-25T23:59:59.999Z',
        allDay: true,
      });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('prevents IDOR: forbids MEMBER from blocking time for another staff member', async () => {
    mockSession(memberUserId, 'MEMBER');
    const app = createTestApp();

    // Staff member in DB belongs to a DIFFERENT user
    vi.spyOn(prisma.staffMember, 'findFirst').mockResolvedValue({
      id: otherStaffId,
      organizationId: targetOrgId,
      name: 'Other Doctor',
      userId: 'some-other-user-uuid',
    } as any);

    const res = await request(app)
      .post('/api/v1/staff/blocked-time')
      .set('Cookie', ['flowpilot_session=valid-test-token'])
      .set('X-Organization-Id', targetOrgId)
      .send({
        staffMemberId: otherStaffId,
        title: 'Malicious Leave',
        type: 'VACATION',
        startTime: '2026-11-10T09:00:00.000Z',
        endTime: '2026-11-10T17:00:00.000Z',
      });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(res.body.error.message).toContain('only authorized to block time for their own schedule');
  });

  it('forbids BILLING role from modifying schedule', async () => {
    mockSession('usr-billing', 'BILLING');
    const app = createTestApp();

    const res = await request(app)
      .post('/api/v1/staff/blocked-time')
      .set('Cookie', ['flowpilot_session=valid-test-token'])
      .set('X-Organization-Id', targetOrgId)
      .send({
        title: 'Billing Block',
        type: 'BREAK',
        startTime: '2026-11-10T09:00:00.000Z',
        endTime: '2026-11-10T10:00:00.000Z',
      });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it('sanitizes dangerous HTML tags from title and notes to prevent XSS', async () => {
    const app = createTestApp();

    let capturedCreateData: any = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma as any).blockedTime = {
      create: vi.fn().mockImplementation(({ data }) => {
        capturedCreateData = data;
        return {
          id: 'bt-2',
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      }),
    };
    vi.spyOn(prisma.appointment, 'count').mockResolvedValue(0);

    const res = await request(app)
      .post('/api/v1/staff/blocked-time')
      .set('Cookie', ['flowpilot_session=valid-test-token'])
      .set('X-Organization-Id', targetOrgId)
      .send({
        title: '<script>alert("xss")</script>Team Lunch',
        type: 'BREAK',
        startTime: '2026-11-10T12:00:00.000Z',
        endTime: '2026-11-10T13:00:00.000Z',
        notes: '<b>Important</b> break notes',
      });

    expect(res.status).toBe(201);
    expect(capturedCreateData.title).not.toContain('<');
    expect(capturedCreateData.title).not.toContain('>');
    expect(capturedCreateData.notes).not.toContain('<b>');
  });

  it('rejects invalid time ranges where endTime is before startTime', async () => {
    const app = createTestApp();

    const res = await request(app)
      .post('/api/v1/staff/blocked-time')
      .set('Cookie', ['flowpilot_session=valid-test-token'])
      .set('X-Organization-Id', targetOrgId)
      .send({
        title: 'Invalid Interval',
        type: 'BREAK',
        startTime: '2026-11-10T15:00:00.000Z',
        endTime: '2026-11-10T12:00:00.000Z', // Before start
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects single continuous blocked time exceeding 365 days', async () => {
    const app = createTestApp();

    const res = await request(app)
      .post('/api/v1/staff/blocked-time')
      .set('Cookie', ['flowpilot_session=valid-test-token'])
      .set('X-Organization-Id', targetOrgId)
      .send({
        title: 'DoS Block 2 Years',
        type: 'BREAK',
        startTime: '2026-11-10T12:00:00.000Z',
        endTime: '2028-11-15T12:00:00.000Z', // 2 years
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.details.endTime[0]).toContain('cannot exceed 365 days');
  });
});
