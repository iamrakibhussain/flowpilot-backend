import type { Request, Response, NextFunction } from 'express';
import { NotificationService } from './notification.service.js';
import { listNotificationsQuerySchema } from './notification.types.js';
import { sendSuccess } from '../../common/http/response.js';
import { BadRequestError, NotFoundError } from '../../common/errors/app-error.js';
import { prisma } from '../../database/prisma.js';
import { z } from 'zod';

export class NotificationController {
  public static async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant?.organizationId;
      const userId = req.user?.id;

      if (!organizationId || !userId) {
        throw new BadRequestError('Missing organization or user context');
      }

      const query = listNotificationsQuerySchema.parse(req.query);
      const result = await NotificationService.listNotifications(organizationId, userId, query);

      sendSuccess(res, result);
    } catch (error) {
      next(error);
    }
  }

  public static async markAsRead(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant?.organizationId;
      const userId = req.user?.id;
      const notificationId = req.params.id;

      if (!organizationId || !userId || !notificationId) {
        throw new BadRequestError('Missing parameters');
      }

      const updated = await NotificationService.markAsRead(organizationId, userId, notificationId);

      if (!updated) {
        throw new NotFoundError('Notification not found');
      }

      sendSuccess(res, updated, 200, 'Notification marked as read');
    } catch (error) {
      next(error);
    }
  }

  public static async markAllAsRead(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const organizationId = req.tenant?.organizationId;
      const userId = req.user?.id;

      if (!organizationId || !userId) {
        throw new BadRequestError('Missing parameters');
      }

      const result = await NotificationService.markAllAsRead(organizationId, userId);
      sendSuccess(res, result, 200, 'All notifications marked as read');
    } catch (error) {
      next(error);
    }
  }

  public static async clearRead(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant?.organizationId;
      const userId = req.user?.id;

      if (!organizationId || !userId) {
        throw new BadRequestError('Missing parameters');
      }

      const result = await NotificationService.clearReadNotifications(organizationId, userId);
      sendSuccess(res, result, 200, 'Read notifications cleared');
    } catch (error) {
      next(error);
    }
  }

  public static async testEmail(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant?.organizationId;
      if (!organizationId) {
        throw new BadRequestError('Missing organization context');
      }

      const testSchema = z.object({
        recipientEmail: z.string().email('Invalid email address'),
      });

      const { recipientEmail } = testSchema.parse(req.body);
      const userName = req.user?.name || 'Administrator';

      const org = await prisma.organization.findUnique({
        where: { id: organizationId },
        select: { name: true },
      });

      const orgName = org?.name || 'FlowPilot Workspace';

      const result = await NotificationService.sendTestEmail(recipientEmail, userName, orgName);

      if (!result.success) {
        throw new BadRequestError(result.error || 'Failed to dispatch test email via SMTP');
      }

      sendSuccess(
        res,
        {
          deliveredTo: recipientEmail,
          messageId: result.messageId,
        },
        200,
        'Test email dispatched successfully',
      );
    } catch (error) {
      next(error);
    }
  }
}
