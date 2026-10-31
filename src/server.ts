import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './common/logging/logger.js';
import { disconnectDatabase } from './database/prisma.js';
import { AuthService } from './modules/auth/auth.service.js';
import { initReminderCron } from './modules/notifications/reminder.cron.js';

const app = createApp();

// FlowPilot Server Entry Point â€” Production Deliverability & Client Portal Enabled
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

// Graceful shutdown handling
let isShuttingDown = false;

async function handleShutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;
  clearInterval(tokenCleanupInterval);

  logger.info({ signal }, 'Received termination signal. Starting graceful shutdown...');

  // Set timeout to force exit if cleanup takes too long
  const forceExitTimeout = setTimeout(() => {
    logger.error('Graceful shutdown timed out. Forcing process termination.');
    process.exit(1);
  }, 10000);
  forceExitTimeout.unref();

  server.close(async (err) => {
    if (err) {
      logger.error({ err }, 'Error closing HTTP server');
      process.exit(1);
    }

    try {
      await disconnectDatabase();
      logger.info('Graceful shutdown completed successfully.');
      process.exit(0);
    } catch (dbErr) {
      logger.error({ dbErr }, 'Error during database disconnect');
      process.exit(1);
    }
  });
}

process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.fatal({ reason }, 'Unhandled Promise Rejection detected');
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  logger.fatal({ error }, 'Uncaught Exception detected');
  process.exit(1);
});
