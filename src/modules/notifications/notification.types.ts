import { z } from 'zod';
import type { NotificationType } from '@prisma/client';

export const listNotificationsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  isRead: z
    .enum(['true', 'false', 'all'])
    .optional()
    .transform((val) => {
      if (val === 'true') return true;
      if (val === 'false') return false;
      return undefined;
    }),
  type: z
    .enum([
      'BOOKING_CREATED',
      'BOOKING_RESCHEDULED',
      'BOOKING_CANCELLED',
      'INVOICE_ISSUED',
      'PAYMENT_RECEIVED',
      'TEAM_INVITE',
      'SECURITY_ALERT',
      'SYSTEM',
    ])
    .optional(),
});

export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;

export interface CreateNotificationInput {
  organizationId: string;
  userId?: string | null;
  type: NotificationType;
  title: string;
  message: string;
  actionUrl?: string | null;
  metadata?: Record<string, unknown> | null;
}
