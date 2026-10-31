import { prisma } from '../../database/prisma.js';
import { logger } from '../../common/logging/logger.js';
import { EmailService } from '../../common/email/email.service.js';
import { Prisma } from '@prisma/client';
import type { CreateNotificationInput, ListNotificationsQuery } from './notification.types.js';

export class NotificationService {
  /**
   * Internal helper to create and persist an in-app notification.
   */
  public static async createNotification(input: CreateNotificationInput) {
    try {
      const notification = await prisma.notification.create({
        data: {
          organizationId: input.organizationId,
          userId: input.userId ?? null,
          type: input.type,
          title: input.title,
          message: input.message,
          actionUrl: input.actionUrl ?? null,
          metadata: input.metadata ? (input.metadata as Prisma.InputJsonValue) : Prisma.JsonNull,
        },
      });

      logger.info(
        {
          event: 'notification.created',
          notificationId: notification.id,
          organizationId: input.organizationId,
          type: input.type,
        },
        'In-app notification created successfully',
      );

      return notification;
    } catch (error) {
      logger.error(
        {
          event: 'notification.create_failed',
          organizationId: input.organizationId,
          type: input.type,
          err: error instanceof Error ? error.message : 'Unknown error',
        },
        'Failed to persist in-app notification',
      );
      return null;
    }
  }

  /**
   * Lists notifications for the authenticated user and organization.
   * Includes notifications targeted specifically to the user as well as org-wide broadcasts (userId: null).
   */
  public static async listNotifications(
    organizationId: string,
    userId: string,
    query: ListNotificationsQuery,
  ) {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const where: Prisma.NotificationWhereInput = {
      organizationId,
      OR: [{ userId }, { userId: null }],
    };

    if (query.isRead !== undefined) {
      where.isRead = query.isRead;
    }

    if (query.type) {
      where.type = query.type;
    }

    const [items, total, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.notification.count({ where }),
      prisma.notification.count({
        where: {
          organizationId,
          OR: [{ userId }, { userId: null }],
          isRead: false,
        },
      }),
    ]);

    return {
      items,
      total,
      unreadCount,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  /**
   * Marks a specific notification as read.
   */
  public static async markAsRead(organizationId: string, userId: string, notificationId: string) {
    const notification = await prisma.notification.findFirst({
      where: {
        id: notificationId,
        organizationId,
        OR: [{ userId }, { userId: null }],
      },
    });

    if (!notification) {
      return null;
    }

    return prisma.notification.update({
      where: { id: notificationId },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });
  }

  /**
   * Marks all unread notifications as read for the user and organization.
   */
  public static async markAllAsRead(organizationId: string, userId: string) {
    const result = await prisma.notification.updateMany({
      where: {
        organizationId,
        OR: [{ userId }, { userId: null }],
        isRead: false,
      },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });

    return { updatedCount: result.count };
  }

  /**
   * Deletes all read notifications for clean housekeeping.
   */
  public static async clearReadNotifications(organizationId: string, userId: string) {
    const result = await prisma.notification.deleteMany({
      where: {
        organizationId,
        OR: [{ userId }, { userId: null }],
        isRead: true,
      },
    });

    return { deletedCount: result.count };
  }

  /**
   * Sends a diagnostic test email to verify SMTP / Nodemailer configuration.
   */
  public static async sendTestEmail(targetEmail: string, userName: string, orgName: string) {
    const result = await EmailService.sendTestDiagnosticEmail(targetEmail, userName, orgName);
    return result;
  }
}
