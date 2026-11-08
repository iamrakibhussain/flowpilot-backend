export interface ShutdownLogger {
  info: (objOrMsg: unknown, msg?: string) => void;
  error: (objOrMsg: unknown, msg?: string) => void;
}

export interface ShutdownDependencies {
  server: { close: (cb: (err?: Error | null) => void) => void };
  disconnectDb: () => Promise<void>;
  intervals: Array<NodeJS.Timeout | null | undefined>;
  logger: ShutdownLogger;
  exitProcess?: (code: number) => void;
  timeoutMs?: number;
}

/**
 * Creates a robust, idempotent graceful shutdown handler for FlowPilot.
 * - Prevents multiple re-entrant shutdown executions on repeated signals.
 * - Clears all in-memory intervals and recurring task schedulers.
 * - Drains in-flight HTTP connections via server.close().
 * - Disconnects database clients cleanly via disconnectDb().
 * - Arms a safety watchdog timer to prevent process hanging.
 */
export function createShutdownHandler(deps: ShutdownDependencies) {
  let isShuttingDown = false;

  return async function handleShutdown(signal: string): Promise<boolean> {
    if (isShuttingDown) {
      deps.logger.info({ signal }, 'Shutdown already in progress. Ignoring duplicate signal.');
      return false;
    }
    isShuttingDown = true;

    // 1. Clear all active background intervals
    for (const interval of deps.intervals) {
      if (interval) {
        clearInterval(interval);
      }
    }

    deps.logger.info({ signal }, 'Received termination signal. Starting graceful shutdown...');

    // 2. Set watchdog timeout to force termination if graceful drain hangs
    const timeoutMs = deps.timeoutMs ?? 10000;
    const forceExitTimeout = setTimeout(() => {
      deps.logger.error('Graceful shutdown timed out. Forcing process termination.');
      (deps.exitProcess || process.exit)(1);
    }, timeoutMs);

    if (typeof forceExitTimeout.unref === 'function') {
      forceExitTimeout.unref();
    }

    // 3. Drain HTTP server and disconnect database
    return new Promise<boolean>((resolve) => {
      deps.server.close(async (err) => {
        if (err) {
          deps.logger.error({ err }, 'Error closing HTTP server');
          (deps.exitProcess || process.exit)(1);
          return resolve(false);
        }

        try {
          await deps.disconnectDb();
          deps.logger.info('Graceful shutdown completed successfully.');
          (deps.exitProcess || process.exit)(0);
          resolve(true);
        } catch (dbErr) {
          deps.logger.error({ dbErr }, 'Error during database disconnect');
          (deps.exitProcess || process.exit)(1);
          resolve(false);
        }
      });
    });
  };
}

