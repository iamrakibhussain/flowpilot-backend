import { prisma } from '../../database/prisma.js';
import { logger } from '../../common/logging/logger.js';
import { EmailService } from '../../common/email/email.service.js';
import { env } from '../../config/env.js';

/**
 * Checks for upcoming appointments scheduled between 23 and 25 hours from now
 * and dispatches 24-hour advance reminder emails (NOTIF-03).
 */
export async function runReminderCheckNow(): Promise<{ checked: number; dispatched: number }> {
  const now = new Date();
  const windowStart = new Date(now.getTime() + 23 * 60 * 60 * 1000);
  const windowEnd = new Date(now.getTime() + 25 * 60 * 60 * 1000);

  try {
    const upcomingAppointments = await prisma.appointment.findMany({
      where: {
        scheduledAt: {
          gte: windowStart,
          lte: windowEnd,
        },
        status: 'CONFIRMED',
        reminderSentAt: null,
      },
      include: {
        customer: true,
        service: true,
        staffMember: true,
        organization: true,
      },
    });

    let dispatchedCount = 0;

    for (const appt of upcomingAppointments) {
      if (!appt.customer.email) {
        continue;
      }

      const portalUrl = `${env.FRONTEND_URL}/portal/${appt.organization.slug}`;

      const sent = await EmailService.sendAppointmentReminderEmail({
        to: appt.customer.email,
        customerName: appt.customer.name,
        serviceTitle: appt.service?.name || appt.title,
        scheduledAt: appt.scheduledAt,
        specialistName: appt.staffMember?.name,
        type: appt.type,
        location: appt.location,
        portalUrl,
        organizationName: appt.organization.name,
        brandColor: appt.organization.brandColor,
      });

      if (sent) {
        await prisma.appointment.update({
          where: { id: appt.id },
          data: { reminderSentAt: new Date() },
        });
        dispatchedCount++;
      }
    }

    if (dispatchedCount > 0) {
      logger.info(
        {
          event: 'reminders.dispatched',
          totalFound: upcomingAppointments.length,
          dispatchedCount,
        },
        '24-Hour advance appointment reminders dispatched successfully',
      );
    }

    return {
      checked: upcomingAppointments.length,
      dispatched: dispatchedCount,
    };
  } catch (error) {
    logger.error(
      {
        event: 'reminders.cron_error',
        err: error instanceof Error ? error.message : 'Unknown error',
      },
      'Error during 24-hour appointment reminder check',
    );
    return { checked: 0, dispatched: 0 };
  }
}

/**
 * Initializes a background reminder timer running every 30 minutes in production/server runtime.
 */
export function initReminderCron(): NodeJS.Timeout | null {
  if (process.env.NODE_ENV === 'test') {
    return null;
  }

  // Run initial check 15 seconds after boot
  setTimeout(() => {
    runReminderCheckNow().catch((err) => {
      logger.error({ err }, 'Initial reminder check failed');
    });
  }, 15000);

  // Repeat every 30 minutes (1800000 ms)
  const interval = setInterval(
    () => {
      runReminderCheckNow().catch((err) => {
        logger.error({ err }, 'Periodic reminder check failed');
      });
    },
    30 * 60 * 1000,
  );

  logger.info(
    { event: 'reminders.cron_started' },
    '24-hour reminder background scheduler initialized',
  );

  return interval;
}
