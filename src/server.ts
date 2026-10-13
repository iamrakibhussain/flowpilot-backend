import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './common/logging/logger.js';
import { disconnectDatabase } from './database/prisma.js';

const app = createApp();

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

// Graceful shutdown handling
let isShuttingDown = false;

async function handleShutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

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
