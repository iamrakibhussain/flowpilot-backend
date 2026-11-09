import crypto from 'crypto';
import { prisma } from '../../database/prisma.js';
import { logger } from '../../common/logging/logger.js';
import { EmailService } from '../../common/email/email.service.js';
import { env } from '../../config/env.js';

// Type-safe model accessor for Quotes & QuoteTokens
const prismaQuotes = prisma as unknown as {
  quote: {
    findMany: (args: unknown) => Promise<
      Array<{
        id: string;
        quoteNumber: string;
        title: string;
        status: string;
        totalAmount: unknown;
        expiresAt: Date | null;
        customerId: string;
        organizationId: string;
        customer: { id: string; name: string; email: string };
        organization: {
          id: string;
          name: string;
          slug: string;
          brandColor: string | null;
          currency: string;
        };
      }>
    >;
  };
  quoteToken: {
    create: (args: {
      data: {
        quoteId: string;
        tokenHash: string;
        expiresAt: Date;
      };
    }) => Promise<{ id: string; tokenHash: string }>;
  };
};

export interface ReminderTelemetry {
  checkedAppointments: number;
  dispatched24hAppt: number;
  dispatched2hAppt: number;
  checkedInvoices: number;
  promotedOverdueInvoices: number;
  dispatched3dDunning: number;
  dispatched7dDunning: number;
  checkedQuotes: number;
  dispatchedQuoteWarnings: number;
}

let isCronRunning = false;

/**
 * Executes a full multi-channel communication & dunning cycle:
 * 1. 24-hour and 2-hour advance appointment reminders.
 * 2. 3-day soft and 7-day urgent overdue invoice dunning sequence with auto-state promotion.
 * 3. 48-hour proposal expiration notices with secure 1-click review & sign links.
 * Scoped optionally to a specific tenant organizationId for manual on-demand triggers.
 */
export async function runReminderCheckNow(targetOrgId?: string): Promise<ReminderTelemetry> {
  const telemetry: ReminderTelemetry = {
    checkedAppointments: 0,
    dispatched24hAppt: 0,
    dispatched2hAppt: 0,
    checkedInvoices: 0,
    promotedOverdueInvoices: 0,
    dispatched3dDunning: 0,
    dispatched7dDunning: 0,
    checkedQuotes: 0,
    dispatchedQuoteWarnings: 0,
  };

  if (isCronRunning) {
    logger.info({ event: 'reminders.skipped_running' }, 'Reminder cycle skipped: already active');
    return telemetry;
  }

  isCronRunning = true;
  const now = new Date();

  try {
    // =========================================================================
    // 1A. 24-Hour Advance Appointment Reminders
    // =========================================================================
    const windowStart24h = new Date(now.getTime() + 23 * 60 * 60 * 1000);
    const windowEnd24h = new Date(now.getTime() + 25 * 60 * 60 * 1000);

    const appts24h = await prisma.appointment.findMany({
      where: {
        scheduledAt: { gte: windowStart24h, lte: windowEnd24h },
        status: 'CONFIRMED',
        reminderSentAt: null,
        ...(targetOrgId ? { organizationId: targetOrgId } : {}),
      },
      include: {
        customer: true,
        service: true,
        staffMember: true,
        organization: true,
      },
    });

    telemetry.checkedAppointments += appts24h.length;

    for (const appt of appts24h) {
      if (!appt.customer.email) continue;
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
        hoursNotice: 24,
      });

      if (sent) {
        await prisma.appointment.update({
          where: { id: appt.id },
          data: { reminderSentAt: new Date() },
        });

        await prisma.notification
          .create({
            data: {
              organizationId: appt.organizationId,
              type: 'SYSTEM',
              title: `24-Hour Reminder Sent: ${appt.customer.name}`,
              message: `Advance reminder sent to ${appt.customer.name} for ${appt.service?.name || appt.title} scheduled tomorrow.`,
              actionUrl: '/dashboard/calendar',
              metadata: {
                appointmentId: appt.id,
                customerId: appt.customerId,
                alertType: 'APPT_24H',
              },
            },
          })
          .catch(() => {});

        telemetry.dispatched24hAppt++;
      }
    }

    // =========================================================================
    // 1B. 2-Hour Urgent Appointment Reminders
    // =========================================================================
    const windowStart2h = new Date(now.getTime() + 105 * 60 * 1000); // 1h 45m
    const windowEnd2h = new Date(now.getTime() + 135 * 60 * 1000); // 2h 15m

    const appts2h = await prisma.appointment.findMany({
      where: {
        scheduledAt: { gte: windowStart2h, lte: windowEnd2h },
        status: 'CONFIRMED',
        ...(targetOrgId ? { organizationId: targetOrgId } : {}),
      },
      include: {
        customer: true,
        service: true,
        staffMember: true,
        organization: true,
      },
    });

    telemetry.checkedAppointments += appts2h.length;

    for (const appt of appts2h) {
      if (!appt.customer.email) continue;

      const alreadySent2h = await prisma.notification.findFirst({
        where: {
          organizationId: appt.organizationId,
          title: { contains: `[APPT-2H] ${appt.id}` },
        },
      });

      if (alreadySent2h) continue;

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
        hoursNotice: 2,
      });

      if (sent) {
        await prisma.notification
          .create({
            data: {
              organizationId: appt.organizationId,
              type: 'SYSTEM',
              title: `[APPT-2H] ${appt.id} - 2-Hour Reminder: ${appt.customer.name}`,
              message: `Urgent session reminder delivered to ${appt.customer.name} for ${appt.service?.name || appt.title} starting in 2 hours.`,
              actionUrl: '/dashboard/calendar',
              metadata: {
                appointmentId: appt.id,
                customerId: appt.customerId,
                alertType: 'APPT_2H',
              },
            },
          })
          .catch(() => {});

        telemetry.dispatched2hAppt++;
      }
    }

    // =========================================================================
    // 2. Overdue Invoices Dunning Engine (3-Day & 7-Day)
    // =========================================================================
    const overdueInvoices = await prisma.invoice.findMany({
      where: {
        status: { in: ['PENDING', 'OVERDUE'] },
        dueDate: { lt: now },
        ...(targetOrgId ? { organizationId: targetOrgId } : {}),
      },
      include: {
        customer: true,
        organization: true,
      },
    });

    telemetry.checkedInvoices = overdueInvoices.length;

    for (const inv of overdueInvoices) {
      // Auto-promote status from PENDING to OVERDUE once due date passes
      if (inv.status === 'PENDING') {
        await prisma.invoice.update({
          where: { id: inv.id },
          data: { status: 'OVERDUE' },
        });
        telemetry.promotedOverdueInvoices++;
      }

      if (!inv.customer?.email) continue;

      // Ensure valid cryptographic payment token exists for 1-click settlement
      let token = inv.paymentToken;
      if (!token) {
        token = `tok_${crypto.randomBytes(16).toString('hex')}`;
        const expiry = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
        await prisma.invoice.update({
          where: { id: inv.id },
          data: { paymentToken: token, paymentTokenExpiry: expiry },
        });
      }

      const daysOverdue = Math.floor(
        (now.getTime() - new Date(inv.dueDate).getTime()) / (1000 * 60 * 60 * 24),
      );
      const payUrl = `${env.FRONTEND_URL}/pay/${token}`;
      const portalUrl = `${env.FRONTEND_URL}/portal/${inv.organization.slug}/dashboard`;

      // Stage 1: 3-Day Gentle Dunning Reminder
      if (daysOverdue >= 3 && daysOverdue < 7) {
        const alreadySent3d = await prisma.notification.findFirst({
          where: {
            organizationId: inv.organizationId,
            title: { contains: `[DUNNING-3D] Invoice #${inv.invoiceNumber}` },
          },
        });

        if (!alreadySent3d) {
          const sent = await EmailService.sendInvoiceDunningEmail({
            to: inv.customer.email,
            customerName: inv.customer.name,
            invoiceNumber: inv.invoiceNumber,
            organizationName: inv.organization.name,
            brandColor: inv.organization.brandColor,
            amount: Number(inv.total),
            currency: inv.organization.currency,
            dueDate: inv.dueDate,
            daysOverdue,
            dunningStage: '3_DAY',
            payUrl,
            portalUrl,
          });

          if (sent) {
            await prisma.notification
              .create({
                data: {
                  organizationId: inv.organizationId,
                  type: 'SYSTEM',
                  title: `[DUNNING-3D] Invoice #${inv.invoiceNumber} - Gentle Reminder Dispatched`,
                  message: `3-day overdue payment reminder delivered to ${inv.customer.name} for ${inv.organization.currency} ${Number(inv.total).toFixed(2)}.`,
                  actionUrl: '/dashboard/invoices',
                  metadata: {
                    invoiceId: inv.id,
                    customerId: inv.customerId,
                    dunningStage: '3_DAY',
                  },
                },
              })
              .catch(() => {});

            telemetry.dispatched3dDunning++;
          }
        }
      }

      // Stage 2: 7-Day Urgent Dunning Notice
      if (daysOverdue >= 7) {
        const alreadySent7d = await prisma.notification.findFirst({
          where: {
            organizationId: inv.organizationId,
            title: { contains: `[DUNNING-7D] Invoice #${inv.invoiceNumber}` },
          },
        });

        if (!alreadySent7d) {
          const sent = await EmailService.sendInvoiceDunningEmail({
            to: inv.customer.email,
            customerName: inv.customer.name,
            invoiceNumber: inv.invoiceNumber,
            organizationName: inv.organization.name,
            brandColor: inv.organization.brandColor,
            amount: Number(inv.total),
            currency: inv.organization.currency,
            dueDate: inv.dueDate,
            daysOverdue,
            dunningStage: '7_DAY',
            payUrl,
            portalUrl,
          });

          if (sent) {
            await prisma.notification
              .create({
                data: {
                  organizationId: inv.organizationId,
                  type: 'SYSTEM',
                  title: `[DUNNING-7D] Invoice #${inv.invoiceNumber} - Urgent Notice Dispatched`,
                  message: `7-day urgent dunning notice delivered to ${inv.customer.name} for ${inv.organization.currency} ${Number(inv.total).toFixed(2)}.`,
                  actionUrl: '/dashboard/invoices',
                  metadata: {
                    invoiceId: inv.id,
                    customerId: inv.customerId,
                    dunningStage: '7_DAY',
                  },
                },
              })
              .catch(() => {});

            telemetry.dispatched7dDunning++;
          }
        }
      }
    }

    // =========================================================================
    // 3. 48-Hour Quote Expiration Warnings
    // =========================================================================
    const windowEndQuote = new Date(now.getTime() + 48 * 60 * 60 * 1000);

    const expiringQuotes = await prismaQuotes.quote.findMany({
      where: {
        status: 'SENT',
        expiresAt: { gte: now, lte: windowEndQuote },
        ...(targetOrgId ? { organizationId: targetOrgId } : {}),
      },
      include: {
        customer: true,
        organization: true,
      },
    });

    telemetry.checkedQuotes = expiringQuotes.length;

    for (const q of expiringQuotes) {
      if (!q.customer?.email || !q.expiresAt) continue;

      const alreadyWarned = await prisma.notification.findFirst({
        where: {
          organizationId: q.organizationId,
          title: { contains: `[QUOTE-EXP-48H] Quote #${q.quoteNumber}` },
        },
      });

      if (alreadyWarned) continue;

      // Generate single-use review token
      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      const tokenExpiry = q.expiresAt || new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

      await prismaQuotes.quoteToken.create({
        data: {
          quoteId: q.id,
          tokenHash,
          expiresAt: tokenExpiry,
        },
      });

      const reviewUrl = `${env.FRONTEND_URL}/quote/${rawToken}`;

      const sent = await EmailService.sendQuoteExpiryWarningEmail({
        to: q.customer.email,
        customerName: q.customer.name,
        quoteNumber: q.quoteNumber,
        quoteTitle: q.title,
        organizationName: q.organization.name,
        brandColor: q.organization.brandColor,
        totalAmount: Number(q.totalAmount),
        currency: q.organization.currency,
        expiresAt: q.expiresAt,
        reviewUrl,
      });

      if (sent) {
        await prisma.notification
          .create({
            data: {
              organizationId: q.organizationId,
              type: 'SYSTEM',
              title: `[QUOTE-EXP-48H] Quote #${q.quoteNumber} - 48h Expiry Notice Dispatched`,
              message: `Advance proposal expiration warning delivered to ${q.customer.name} for "${q.title}".`,
              actionUrl: '/dashboard/quotes',
              metadata: {
                quoteId: q.id,
                customerId: q.customerId,
                alertType: 'QUOTE_EXPIRING_48H',
              },
            },
          })
          .catch(() => {});

        telemetry.dispatchedQuoteWarnings++;
      }
    }

    logger.info(
      { event: 'reminders.cycle_completed', ...telemetry },
      'Multi-channel reminder and dunning cycle completed successfully',
    );

    return telemetry;
  } catch (error) {
    logger.error(
      {
        event: 'reminders.cron_error',
        err: error instanceof Error ? error.message : 'Unknown error',
      },
      'Error during automated reminder and dunning check',
    );
    return telemetry;
  } finally {
    isCronRunning = false;
  }
}

/**
 * Initializes a background reminder timer running every 15 minutes in production/server runtime.
 */
export function initReminderCron(): NodeJS.Timeout | null {
  if (process.env.NODE_ENV === 'test' || env.ENABLE_BACKGROUND_JOBS === false) {
    if (env.ENABLE_BACKGROUND_JOBS === false) {
      logger.info(
        { event: 'reminders.cron_disabled' },
        'Automated communications & dunning scheduler disabled via ENABLE_BACKGROUND_JOBS',
      );
    }
    return null;
  }

  // Run initial check 15 seconds after boot
  setTimeout(() => {
    runReminderCheckNow().catch((err) => {
      logger.error({ err }, 'Initial reminder check failed');
    });
  }, 15000);

  // Repeat every 15 minutes (900000 ms)
  const interval = setInterval(
    () => {
      runReminderCheckNow().catch((err) => {
        logger.error({ err }, 'Periodic reminder check failed');
      });
    },
    15 * 60 * 1000,
  );

  logger.info(
    { event: 'reminders.cron_started' },
    'Automated communications & dunning scheduler initialized (15m interval)',
  );

  return interval;
}
