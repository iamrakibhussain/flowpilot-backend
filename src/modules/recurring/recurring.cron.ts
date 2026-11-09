import { RecurringService } from './recurring.service.js';
import { logger } from '../../common/logging/logger.js';
import { env } from '../../config/env.js';

let isRecurringCronRunning = false;

export interface RecurringBillingRunResult {
  processedCount: number;
  invoicesCreated: number;
  completedSchedules: number;
  skipped?: boolean;
}

/**
 * Execute a single cycle of the recurring billing engine.
 */
export async function runRecurringBillingNow(): Promise<RecurringBillingRunResult> {
  if (isRecurringCronRunning) {
    logger.debug('Recurring billing cycle already in flight. Skipping overlapping execution.');
    return { processedCount: 0, invoicesCreated: 0, completedSchedules: 0, skipped: true };
  }

  isRecurringCronRunning = true;
  try {
    const result = await RecurringService.processDueSchedules();
    if (!result.skipped && (result.processedCount > 0 || result.invoicesCreated > 0)) {
      logger.info(
        { event: 'recurring_billing.processed', ...result },
        'Automated recurring billing cycle executed successfully',
      );
    }
    return result;
  } catch (error) {
    logger.error(
      {
        event: 'recurring_billing.error',
        err: error instanceof Error ? error.message : 'Unknown error',
      },
      'Error during automated recurring billing run',
    );
    return { processedCount: 0, invoicesCreated: 0, completedSchedules: 0, skipped: true };
  } finally {
    isRecurringCronRunning = false;
  }
}

/**
 * Initialize background cron runner for recurring invoicing (every 15 minutes).
 */
export function initRecurringBillingCron(): NodeJS.Timeout | null {
  if (process.env.NODE_ENV === 'test' || env.ENABLE_BACKGROUND_JOBS === false) {
    if (env.ENABLE_BACKGROUND_JOBS === false) {
      logger.info(
        { event: 'recurring_billing.cron_disabled' },
        'Automated recurring billing engine scheduler disabled via ENABLE_BACKGROUND_JOBS',
      );
    }
    return null;
  }

  // Initial check 30 seconds after server startup
  setTimeout(() => {
    runRecurringBillingNow().catch((err) => {
      logger.error({ err }, 'Initial recurring billing check failed');
    });
  }, 30000);

  // Periodic interval every 15 minutes
  const interval = setInterval(
    () => {
      runRecurringBillingNow().catch((err) => {
        logger.error({ err }, 'Periodic recurring billing check failed');
      });
    },
    15 * 60 * 1000,
  );

  logger.info(
    { event: 'recurring_billing.cron_started' },
    'Automated recurring billing engine scheduler initialized (15m interval)',
  );

  return interval;
}
