import express, { Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import {
  getCorsOptions,
  getRateLimitOptions,
  getAuthRateLimitOptions,
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

  // 5. Body parsers with safe payload limits
  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: true, limit: '100kb' }));

  // 6. Cookie parser
  app.use(cookieParser());

  // 7. Rate limiters (optional in integration test runs)
  if (options.enableRateLimiting) {
    app.use('/api', rateLimit(getRateLimitOptions()));
    app.use('/api/v1/auth/login', rateLimit(getAuthRateLimitOptions()));
    app.use('/api/v1/auth/register', rateLimit(getAuthRateLimitOptions()));
  }

  // 8. API v1 route mount
  app.use('/api/v1', v1Routes);

  // 9. 404 Route Not Found handler
  app.use(notFoundHandler);

  // 10. Centralized Error Handler
  app.use(errorHandler);

  return app;
}
