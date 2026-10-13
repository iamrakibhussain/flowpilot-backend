import { createApp } from '../../src/app.js';
import { Express } from 'express';

export function getTestApp(): Express {
  // Disable rate limiting in tests for deterministic assertions
  return createApp({ enableRateLimiting: false });
}
