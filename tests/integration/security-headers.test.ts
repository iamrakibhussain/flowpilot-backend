import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { getTestApp } from '../helpers/test-app.js';
import { sanitizeRequestId } from '../../src/common/middleware/request-id.js';
import { getCorsOptions, parseTrustProxy } from '../../src/config/security.js';
import { createApp } from '../../src/app.js';

describe('Network & Security Headers Hardening', () => {
  const app = getTestApp();

  describe('Helmet & Response Headers', () => {
    it('includes Helmet security headers on responses', async () => {
      const res = await request(app).get('/api/v1/health');

      expect(res.status).toBe(200);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBeDefined();
    });
  });

  describe('Request ID Validation & Sanitization (SEC-11)', () => {
    it('generates a fresh UUID when X-Request-Id header is missing', async () => {
      const res = await request(app).get('/api/v1/health');

      const reqId = res.headers['x-request-id'] as string | undefined;
      expect(reqId).toBeDefined();
      expect(typeof reqId).toBe('string');
      expect(reqId!.length).toBe(36);
    });

    it('propagates a valid alphanumeric client-supplied X-Request-Id', async () => {
      const validId = 'trace-id-abc_123.test:node';
      const res = await request(app).get('/api/v1/health').set('X-Request-Id', validId);

      expect(res.headers['x-request-id']).toBe(validId);
    });

    it('rejects client request ID containing carriage return or newline characters (CRLF)', () => {
      const crlfId = 'valid-id\r\nInjected-Header: evil';
      const sanitized = sanitizeRequestId(crlfId);

      expect(sanitized).not.toContain('\r');
      expect(sanitized).not.toContain('\n');
      expect(sanitized).not.toBe(crlfId);
      expect(sanitized.length).toBe(36); // Replaced with UUID
    });

    it('rejects client request ID containing whitespace or invalid characters in HTTP request', async () => {
      const invalidId = 'invalid request id with spaces';
      const res = await request(app).get('/api/v1/health').set('X-Request-Id', invalidId);

      const reqId = res.headers['x-request-id'] as string;
      expect(reqId).not.toBe(invalidId);
      expect(reqId.length).toBe(36);
    });

    it('rejects client request ID exceeding 64 characters and replaces with UUID', async () => {
      const longId = 'a'.repeat(65);
      const res = await request(app).get('/api/v1/health').set('X-Request-Id', longId);

      const reqId = res.headers['x-request-id'] as string;
      expect(reqId).not.toBe(longId);
      expect(reqId.length).toBe(36);
    });

    it('rejects client request ID with invalid symbols (angle brackets, quotes)', async () => {
      const invalidSymbolsId = '<script>alert(1)</script>';
      const res = await request(app).get('/api/v1/health').set('X-Request-Id', invalidSymbolsId);

      const reqId = res.headers['x-request-id'] as string;
      expect(reqId).not.toBe(invalidSymbolsId);
      expect(reqId.length).toBe(36);
    });
  });

  describe('CORS Policy & Preflight Enforcement (SEC-07)', () => {
    it('allows requests with no Origin header (non-browser clients, mobile apps, curl)', async () => {
      const res = await request(app).get('/api/v1/health');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('enforces CORS allowlist policy for recognized frontend origin', async () => {
      const res = await request(app).get('/api/v1/health').set('Origin', 'http://localhost:3000');

      expect(res.status).toBe(200);
      expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    });

    it('rejects origins not in the CORS allowlist with HTTP 403', async () => {
      const res = await request(app)
        .get('/api/v1/health')
        .set('Origin', 'https://malicious-website.com');

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN');
      expect(res.body.error.message).toContain('not allowed by FlowPilot CORS policy');
    });

    it('handles preflight OPTIONS requests for allowed origins', async () => {
      const res = await request(app)
        .options('/api/v1/health')
        .set('Origin', 'http://localhost:3000')
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'X-Request-Id, X-Organization-Id');

      expect(res.status).toBe(204);
      expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
      expect(res.headers['access-control-allow-credentials']).toBe('true');
      expect(res.headers['access-control-allow-methods']).toContain('POST');
    });

    it('throws error when wildcard origin is configured with credentials', () => {
      expect(() => getCorsOptions('*')).toThrow(
        /Wildcard '\*' origin is not permitted with credentialed CORS requests/,
      );
      expect(() => getCorsOptions('http://localhost:3000, *')).toThrow(
        /Wildcard '\*' origin is not permitted with credentialed CORS requests/,
      );
    });
  });

  describe('Reverse Proxy Trust Configuration (SEC-08)', () => {
    it('parses boolean false, true, numbers, and strings correctly', () => {
      expect(parseTrustProxy('false')).toBe(false);
      expect(parseTrustProxy('FALSE')).toBe(false);
      expect(parseTrustProxy('true')).toBe(true);
      expect(parseTrustProxy('TRUE')).toBe(true);
      expect(parseTrustProxy('1')).toBe(1);
      expect(parseTrustProxy('2')).toBe(2);
      expect(parseTrustProxy('loopback')).toBe('loopback');
      expect(parseTrustProxy('10.0.0.0/8, 172.16.0.0/12')).toBe('10.0.0.0/8, 172.16.0.0/12');
    });

    it('configures trust proxy explicitly in createApp', () => {
      const customApp = createApp({ trustProxy: 'loopback', enableRateLimiting: false });
      expect(customApp.get('trust proxy')).toBe('loopback');

      const disabledProxyApp = createApp({ trustProxy: false, enableRateLimiting: false });
      expect(disabledProxyApp.get('trust proxy')).toBe(false);
    });
  });
});
