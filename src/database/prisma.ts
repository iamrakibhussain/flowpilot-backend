import { PrismaClient } from '@prisma/client';
import { env } from '../config/env.js';
import { logger } from '../common/logging/logger.js';

interface PrismaQueryEvent {
  duration: number;
}

type PrismaWithEvents = PrismaClient & {
  $on?: (event: string, callback: (e: PrismaQueryEvent) => void) => void;
};

class DatabaseService {
  private static instance: PrismaClient | null = null;

  public static getClient(): PrismaClient {
    if (!DatabaseService.instance) {
      DatabaseService.instance = new PrismaClient({
        log:
          env.NODE_ENV === 'development'
            ? [
                { emit: 'event', level: 'query' },
                { emit: 'stdout', level: 'warn' },
                { emit: 'stdout', level: 'error' },
              ]
            : [{ emit: 'stdout', level: 'error' }],
      });

      if (env.NODE_ENV === 'development') {
        // Log query timings safely without logging full parameter values
        const clientWithEvents = DatabaseService.instance as unknown as PrismaWithEvents;
        clientWithEvents.$on?.('query', (e: PrismaQueryEvent) => {
          logger.debug({ durationMs: e.duration }, 'Database query executed');
        });
      }
    }

    return DatabaseService.instance;
  }

  public static async disconnect(): Promise<void> {
    if (DatabaseService.instance) {
      await DatabaseService.instance.$disconnect();
      DatabaseService.instance = null;
      logger.info('Database client disconnected');
    }
  }
}

export const prisma = DatabaseService.getClient();
export const disconnectDatabase = DatabaseService.disconnect;
