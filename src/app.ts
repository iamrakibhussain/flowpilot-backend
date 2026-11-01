import express, { Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import {
  getCorsOptions,
  getAllowedOrigins,
  getRateLimitOptions,
  getAuthRateLimitOptions,
  getEmailDispatchRateLimitOptions,
  getVerificationRateLimitOptions,
  getPasswordActionRateLimitOptions,
  getPaymentRateLimitOptions,
  getPublicBookingRateLimitOptions,
  getSchedulingActionRateLimitOptions,
  parseTrustProxy,
} from './config/security.js';
import { requestIdMiddleware } from './common/middleware/request-id.js';
import { notFoundHandler } from './common/middleware/not-found.js';
import { errorHandler } from './common/middleware/error-handler.js';
import { v1Routes } from './routes/v1.js';
import { env } from './config/env.js';

export interface AppOptions {
  enableRateLimiting?: boolean;
  trustProxy?: boolean | number | string;
}

export function createApp(options: AppOptions = { enableRateLimiting: true }): Express {
  const app = express();

  // 1. Explicit reverse proxy trust configuration (defaults to false unless configured)
  const trustProxySetting = options.trustProxy ?? parseTrustProxy(env.TRUST_PROXY);
  app.set('trust proxy', trustProxySetting);

  // 2. HTTP Security headers
  app.use(helmet());

  // 3. Request ID tracking & propagation
  app.use(requestIdMiddleware);

  // 4. CORS protection
  app.use(cors(getCorsOptions()));

  // 5. Enforce Content-Type & Referer origin validation for state-changing requests (Anti-CSRF defense-in-depth)
  app.use((req, res, next) => {
    const method = req.method.toUpperCase();
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      // Defense-in-depth: If Origin is absent but Referer is present on mutation requests, ensure Referer origin is trusted
      const referer = req.headers.referer;
      if (!req.headers.origin && referer) {
        try {
          const refererOrigin = new URL(referer).origin;
          const allowed = getAllowedOrigins();
          if (!allowed.includes(refererOrigin)) {
            res.status(403).json({
              success: false,
              error: {
                code: 'FORBIDDEN',
                message: `Referer origin '${refererOrigin}' is not allowed by FlowPilot security policy`,
                status: 403,
              },
            });
            return;
          }
        } catch {
          res.status(403).json({
            success: false,
            error: {
              code: 'FORBIDDEN',
              message: 'Malformed Referer header rejected',
              status: 403,
            },
          });
          return;
        }
      }

      const contentLength = req.headers['content-length'];
      const transferEncoding = req.headers['transfer-encoding'];
      const hasBody =
        (contentLength !== undefined && contentLength !== '0') || Boolean(transferEncoding);
      if (hasBody) {
        const contentType = req.headers['content-type'];
        if (!contentType || !contentType.toLowerCase().includes('application/json')) {
          res.status(415).json({
            success: false,
            error: {
              code: 'UNSUPPORTED_MEDIA_TYPE',
              message: 'Content-Type must be application/json for request payloads',
              status: 415,
            },
          });
          return;
        }
      }
    }
    next();
  });

  // 6. JSON body parser with rawBody preservation for Stripe webhook verification
  app.use(
    express.json({
      limit: '100kb',
      verify: (req: express.Request & { rawBody?: Buffer }, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );

  // 7. Cookie parser
  app.use(cookieParser());

  // 8. Granular rate limiters (disabled in unit/integration tests via options)
  if (options.enableRateLimiting) {
    app.use('/api', rateLimit(getRateLimitOptions()));
    app.use('/api/v1/auth/login', rateLimit(getAuthRateLimitOptions()));
    app.use('/api/v1/auth/register', rateLimit(getAuthRateLimitOptions()));
    app.use('/api/v1/auth/forgot-password', rateLimit(getEmailDispatchRateLimitOptions()));
    app.use('/api/v1/auth/send-verification', rateLimit(getEmailDispatchRateLimitOptions()));
    app.use('/api/v1/auth/verify-email', rateLimit(getVerificationRateLimitOptions()));
    app.use('/api/v1/auth/reset-password', rateLimit(getPasswordActionRateLimitOptions()));
    app.use('/api/v1/auth/change-password', rateLimit(getPasswordActionRateLimitOptions()));
    app.use('/api/v1/auth/account', rateLimit(getPasswordActionRateLimitOptions()));
    app.use('/api/v1/payments/public', rateLimit(getPaymentRateLimitOptions()));
    app.use('/api/v1/public/booking', rateLimit(getPublicBookingRateLimitOptions()));
    app.use('/api/v1/portal/auth/request-link', rateLimit(getEmailDispatchRateLimitOptions()));
    app.use('/api/v1/portal/auth/verify', rateLimit(getVerificationRateLimitOptions()));
    app.use('/api/v1/notifications/test-email', rateLimit(getEmailDispatchRateLimitOptions()));
    app.use('/api/v1/invoices/:id/send-email', rateLimit(getEmailDispatchRateLimitOptions()));
    app.use('/api/v1/staff/blocked-time', rateLimit(getSchedulingActionRateLimitOptions()));
  }

  // 8. API v1 route mount
  app.use('/api/v1', v1Routes);

  // 9. 404 Route Not Found handler
  app.use(notFoundHandler);

  // 10. Centralized Error Handler
  app.use(errorHandler);

  return app;
}
