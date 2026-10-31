import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { notificationRoutes } from '../../src/modules/notifications/notification.routes.js';
import { errorHandler } from '../../src/common/middleware/error-handler.js';
import { NotificationService } from '../../src/modules/notifications/notification.service.js';
import { AuthService } from '../../src/modules/auth/auth.service.js';

describe('Notifications Module Integration Suite', () => {
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

    app.use('/api/v1/notifications', notificationRoutes);
    app.use(errorHandler);
    return app;
  }

  it('rejects notification requests missing X-Organization-Id header with 400 Bad Request', async () => {
    const app = createTestApp();
    const res = await request(app)
      .get('/api/v1/notifications')
      .set('Cookie', ['flowpilot_session=valid-test-token']);

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('lists notifications and returns unread counter for authenticated user', async () => {
    vi.spyOn(NotificationService, 'listNotifications').mockResolvedValue({
      items: [
        {
          id: 'notif-1',
          organizationId: targetOrgId,
          userId: 'usr-test-1',
          type: 'BOOKING_CREATED',
          title: 'New Online Booking',
          message: 'John Doe booked Consulting Session.',
          actionUrl: '/dashboard/calendar',
          isRead: false,
          readAt: null,
          metadata: null,
          createdAt: new Date(),
        },
      ],
      total: 1,
      unreadCount: 1,
      page: 1,
      limit: 20,
      totalPages: 1,
    });

    const app = createTestApp();
    const res = await request(app)
      .get('/api/v1/notifications')
      .set('Cookie', ['flowpilot_session=valid-test-token'])
      .set('X-Organization-Id', targetOrgId);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.unreadCount).toBe(1);
    expect(res.body.data.items).toHaveLength(1);
  });

  it('marks a single notification as read', async () => {
    vi.spyOn(NotificationService, 'markAsRead').mockResolvedValue({
      id: 'notif-1',
      organizationId: targetOrgId,
      userId: 'usr-test-1',
      type: 'BOOKING_CREATED',
      title: 'New Online Booking',
      message: 'John Doe booked Consulting Session.',
      actionUrl: '/dashboard/calendar',
      isRead: true,
      readAt: new Date(),
      metadata: null,
      createdAt: new Date(),
    });

    const app = createTestApp();
    const res = await request(app)
      .patch('/api/v1/notifications/notif-1/read')
      .set('Cookie', ['flowpilot_session=valid-test-token'])
      .set('X-Organization-Id', targetOrgId);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.isRead).toBe(true);
  });

  it('marks all unread notifications as read', async () => {
    vi.spyOn(NotificationService, 'markAllAsRead').mockResolvedValue({
      updatedCount: 3,
    });

    const app = createTestApp();
    const res = await request(app)
      .patch('/api/v1/notifications/read-all')
      .set('Cookie', ['flowpilot_session=valid-test-token'])
      .set('X-Organization-Id', targetOrgId);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.updatedCount).toBe(3);
  });

  it('clears all read notifications for housekeeping', async () => {
    vi.spyOn(NotificationService, 'clearReadNotifications').mockResolvedValue({
      deletedCount: 2,
    });

    const app = createTestApp();
    const res = await request(app)
      .delete('/api/v1/notifications/clear-read')
      .set('Cookie', ['flowpilot_session=valid-test-token'])
      .set('X-Organization-Id', targetOrgId);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.deletedCount).toBe(2);
  });
});

