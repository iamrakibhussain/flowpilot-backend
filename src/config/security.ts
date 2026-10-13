import { CorsOptions } from 'cors';
import { Options as RateLimitOptions } from 'express-rate-limit';
import { CookieOptions } from 'express';
import { env } from './env.js';

export function parseTrustProxy(val: string): boolean | number | string {
  const trimmed = val.trim();
  if (trimmed.toLowerCase() === 'false') return false;
  if (trimmed.toLowerCase() === 'true') return true;
  const num = Number(trimmed);
  if (!Number.isNaN(num) && Number.isInteger(num) && num >= 0) {
    return num;
  }
  return trimmed;
}

export function getCorsOptions(allowedOriginsString = env.CORS_ORIGIN): CorsOptions {
  const allowedOrigins = allowedOriginsString
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  if (allowedOrigins.includes('*')) {
    throw new Error("Wildcard '*' origin is not permitted with credentialed CORS requests");
  }

  return {
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g. mobile apps, curl, or same-origin server-to-server)
      if (!origin) {
        return callback(null, true);
      }
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error(`Origin '${origin}' not allowed by FlowPilot CORS policy`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'X-Organization-Id'],
    exposedHeaders: ['X-Request-Id'],
    maxAge: 86400, // 24 hours
  };
}

export function getRateLimitOptions(): Partial<RateLimitOptions> {
  return {
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    max: env.RATE_LIMIT_MAX_REQUESTS,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: {
      success: false,
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many requests, please try again later.',
        status: 429,
      },
    },
  };
}

export function getSessionCookieOptions(): CookieOptions {
  const isProd = env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'strict' : 'lax',
    path: '/',
    maxAge: env.SESSION_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
  };
}
