import { Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';

/**
 * Conservative request ID pattern:
 * Allows alphanumeric characters, hyphens, underscores, dots, and colons.
 * Strictly caps length to 64 characters and rejects CR/LF, spaces, and special symbols.
 */
const REQUEST_ID_REGEX = /^[a-zA-Z0-9._:-]{1,64}$/;

export function sanitizeRequestId(rawId: unknown): string {
  if (typeof rawId === 'string') {
    const trimmed = rawId.trim();
    if (REQUEST_ID_REGEX.test(trimmed)) {
      return trimmed;
    }
  }
  return crypto.randomUUID();
}

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const requestId = sanitizeRequestId(req.headers['x-request-id']);

  req.id = requestId;
  res.setHeader('X-Request-Id', requestId);
  next();
}
