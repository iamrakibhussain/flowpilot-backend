import { Request, Response, NextFunction } from 'express';
import { AppError } from '../errors/app-error.js';
import { sendError } from '../http/response.js';
import { logger } from '../logging/logger.js';
import { env } from '../../config/env.js';

export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction): void {
  const requestId = req.id || 'unknown';

  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      logger.error({ err, requestId, path: req.path }, 'Operational 5xx error');
    }

    sendError(
      res,
      {
        code: err.code,
        message: err.message,
        status: err.statusCode,
        ...(err.details ? { details: err.details } : {}),
      },
      err.statusCode,
    );
    return;
  }

  // Handle CORS policy errors
  if (err.message && err.message.includes('not allowed by FlowPilot CORS policy')) {
    sendError(
      res,
      {
        code: 'FORBIDDEN',
        message: err.message,
        status: 403,
      },
      403,
    );
    return;
  }

  // Unhandled / unexpected internal errors
  logger.error(
    {
      err: {
        message: err.message,
        stack: err.stack,
        name: err.name,
      },
      requestId,
      method: req.method,
      url: req.originalUrl,
    },
    'Unhandled server error occurred',
  );

  const isDev = env.NODE_ENV === 'development';
  sendError(
    res,
    {
      code: 'INTERNAL_SERVER_ERROR',
      message: isDev
        ? err.message
        : 'An unexpected internal error occurred. Please contact support.',
      status: 500,
    },
    500,
  );
}
