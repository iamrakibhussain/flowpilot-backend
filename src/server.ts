import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './common/logging/logger.js';
import { disconnectDatabase } from './database/prisma.js';
import { AuthService } from './modules/auth/auth.service.js';
import { initReminderCron } from './modules/notifications/reminder.cron.js';
import { initRecurringBillingCron } from './modules/recurring/recurring.cron.js';
import { createShutdownHandler } from './common/lifecycle/shutdown.js';

const app = createApp();

// FlowPilot Server Entry Point — Production Deliverability & Client Portal Enabled
const server = app.listen(env.PORT, env.HOST, () => {
  logger.info(
    {
      port: env.PORT,
      host: env.HOST,
      environment: env.NODE_ENV,
    },
    'FlowPilot Backend Server successfully started',
  );
});

// Periodic maintenance: Purge expired tokens and sessions (runs every hour)
const tokenCleanupInterval = setInterval(
  () => {
    AuthService.cleanupExpiredTokens()
      .then((stats) => {
        if (
          stats.expiredSessions > 0 ||
          stats.expiredResetTokens > 0 ||
          stats.expiredVerificationCodes > 0
        ) {
          logger.info(
            { event: 'maintenance.cleanup', stats },
            'Automated cleanup purged expired tokens and sessions',
          );
        }
      })
      .catch((err) => {
        logger.error({ err }, 'Failed to run automated token cleanup maintenance');
      });
  },
  60 * 60 * 1000,
);
tokenCleanupInterval.unref();

// Periodic 24-hour advance appointment reminder cron
const reminderInterval = initReminderCron();
if (reminderInterval) {
  reminderInterval.unref();
}

// Periodic 15-minute recurring billing processor cron
const recurringInterval = initRecurringBillingCron();
if (recurringInterval) {
  recurringInterval.unref();
}

// Graceful shutdown handling
export const handleShutdown = createShutdownHandler({
  server,
  disconnectDb: disconnectDatabase,
  intervals: [tokenCleanupInterval, reminderInterval, recurringInterval],
  logger,
});

process.on('SIGTERM', () => {
  handleShutdown('SIGTERM').catch((err) => {
    logger.fatal({ err }, 'Fatal error during SIGTERM graceful shutdown');
  });
});
process.on('SIGINT', () => {
  handleShutdown('SIGINT').catch((err) => {
    logger.fatal({ err }, 'Fatal error during SIGINT graceful shutdown');
  });
});

process.on('unhandledRejection', (reason) => {
  logger.fatal({ reason }, 'Unhandled Promise Rejection detected');
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  logger.fatal({ error }, 'Uncaught Exception detected');
  process.exit(1);
});
