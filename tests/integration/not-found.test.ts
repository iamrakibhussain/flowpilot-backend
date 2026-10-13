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
});
