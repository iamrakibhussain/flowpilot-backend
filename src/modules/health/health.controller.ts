import { Request, Response } from 'express';
import { sendSuccess, sendError } from '../../common/http/response.js';
import { env } from '../../config/env.js';
import { prisma } from '../../database/prisma.js';
import { logger } from '../../common/logging/logger.js';

export class HealthController {
  public static getLiveness(_req: Request, res: Response): void {
    sendSuccess(res, {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: env.NODE_ENV,
    });
  }

  public static async getReadiness(req: Request, res: Response): Promise<void> {
    try {
      // Non-destructive ping to verify database connection readiness
      await prisma.$queryRaw`SELECT 1`;
      sendSuccess(res, {
        status: 'ready',
        database: 'connected',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error(
        {
          requestId: req.id,
          err: error instanceof Error ? error.message : 'Unknown error',
        },
        'Database readiness check failed',
      );

      sendError(
        res,
        {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Database service is unavailable',
          status: 503,
        },
        503,
      );
    }
  }
}
