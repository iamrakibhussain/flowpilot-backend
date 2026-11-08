import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createShutdownHandler } from '../../src/common/lifecycle/shutdown.js';

describe('Graceful Shutdown Lifecycle Handler', () => {
  let mockServer: { close: ReturnType<typeof vi.fn> };
  let mockDisconnectDb: ReturnType<typeof vi.fn>;
  let mockLogger: { info: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
  let mockExit: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockServer = {
      close: vi.fn((cb: (err?: Error | null) => void) => {
        cb(null);
      }),
    };
    mockDisconnectDb = vi.fn().mockResolvedValue(undefined);
    mockLogger = {
      info: vi.fn(),
      error: vi.fn(),
    };
    mockExit = vi.fn();
  });

  it('clears active intervals and terminates cleanly upon signal', async () => {
    const timer1 = setInterval(() => {}, 100000);
    const timer2 = setInterval(() => {}, 100000);
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval');

    const handleShutdown = createShutdownHandler({
      server: mockServer,
      disconnectDb: mockDisconnectDb,
      intervals: [timer1, timer2, null, undefined],
      logger: mockLogger,
      exitProcess: mockExit,
    });

    const success = await handleShutdown('SIGTERM');

    expect(success).toBe(true);
    expect(clearIntervalSpy).toHaveBeenCalledWith(timer1);
    expect(clearIntervalSpy).toHaveBeenCalledWith(timer2);
    expect(mockServer.close).toHaveBeenCalledTimes(1);
    expect(mockDisconnectDb).toHaveBeenCalledTimes(1);
    expect(mockExit).toHaveBeenCalledWith(0);
    expect(mockLogger.info).toHaveBeenCalledWith(
      { signal: 'SIGTERM' },
      expect.stringContaining('Starting graceful shutdown'),
    );
  });

  it('prevents duplicate executions on repeated shutdown signals (idempotent)', async () => {
    const handleShutdown = createShutdownHandler({
      server: mockServer,
      disconnectDb: mockDisconnectDb,
      intervals: [],
      logger: mockLogger,
      exitProcess: mockExit,
    });

    const [first, second] = await Promise.all([
      handleShutdown('SIGTERM'),
      handleShutdown('SIGINT'),
    ]);

    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(mockServer.close).toHaveBeenCalledTimes(1);
    expect(mockDisconnectDb).toHaveBeenCalledTimes(1);
    expect(mockLogger.info).toHaveBeenCalledWith(
      { signal: 'SIGINT' },
      expect.stringContaining('Shutdown already in progress'),
    );
  });

  it('handles server close failure by logging and exiting with code 1', async () => {
    const closeError = new Error('Socket close failed');
    mockServer.close = vi.fn((cb: (err?: Error | null) => void) => {
      cb(closeError);
    });

    const handleShutdown = createShutdownHandler({
      server: mockServer,
      disconnectDb: mockDisconnectDb,
      intervals: [],
      logger: mockLogger,
      exitProcess: mockExit,
    });

    const result = await handleShutdown('SIGTERM');

    expect(result).toBe(false);
    expect(mockDisconnectDb).not.toHaveBeenCalled();
    expect(mockLogger.error).toHaveBeenCalledWith({ err: closeError }, 'Error closing HTTP server');
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it('handles database disconnect failure by logging and exiting with code 1', async () => {
    const dbError = new Error('Database connection hang');
    mockDisconnectDb.mockRejectedValueOnce(dbError);

    const handleShutdown = createShutdownHandler({
      server: mockServer,
      disconnectDb: mockDisconnectDb,
      intervals: [],
      logger: mockLogger,
      exitProcess: mockExit,
    });

    const result = await handleShutdown('SIGTERM');

    expect(result).toBe(false);
    expect(mockServer.close).toHaveBeenCalledTimes(1);
    expect(mockLogger.error).toHaveBeenCalledWith(
      { dbErr: dbError },
      'Error during database disconnect',
    );
    expect(mockExit).toHaveBeenCalledWith(1);
  });
});
