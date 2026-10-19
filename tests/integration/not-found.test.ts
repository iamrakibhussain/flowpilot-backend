import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { getTestApp } from '../helpers/test-app.js';

describe('404 Route Not Found Handling', () => {
  const app = getTestApp();

  it('returns HTTP 404 with unified error format for undefined routes', async () => {
    const res = await request(app).get('/api/v1/non-existent-route-12345');

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error.status).toBe(404);
    expect(res.body.error.message).toContain('Route not found');
  });

  describe('Test-Only & Debug Route Protection (Production Safety)', () => {
    it.each([
      ['/api/v1/tenant/test-bypass'],
      ['/api/v1/tenant/test-protected'],
      ['/api/v1/tenant/test-admin'],
      ['/api/v1/tenant/test-owner'],
      ['/api/v1/test-tenant'],
      ['/api/v1/tenant-resource'],
      ['/api/v1/owner-only-resource'],
      ['/api/v1/debug'],
      ['/api/v1/debug/vars'],
      ['/api/v1/debug/env'],
      ['/api/v1/test/bypass-auth'],
    ])('guarantees %s is not registered on the application and returns HTTP 404', async (path) => {
      const res = await request(app).get(path);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('NOT_FOUND');
      expect(res.body.error.message).toContain('Route not found');
    });
  });
});
