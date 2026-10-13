import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import { getTestApp } from '../helpers/test-app.js';
import { prisma } from '../../src/database/prisma.js';

describe('GET /api/v1/health (Operational Health Endpoints)', () => {
  const app = getTestApp();

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns HTTP 200 with liveness metadata', async () => {
    const res = await request(app).get('/api/v1/health');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('ok');
    expect(res.body.data.environment).toBeDefined();
    expect(res.body.data.uptime).toBeGreaterThanOrEqual(0);
    expect(res.body.data.timestamp).toBeDefined();
  });

  it('returns HTTP 200 on /api/v1/health/ready when database is connected', async () => {
    vi.spyOn(prisma, '$queryRaw').mockResolvedValueOnce([{ 1: 1 }]);

    const res = await request(app).get('/api/v1/health/ready');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('ready');
    expect(res.body.data.database).toBe('connected');
    expect(res.body.data.timestamp).toBeDefined();
  });

  it('returns HTTP 503 on /api/v1/health/ready when database ping fails', async () => {
    vi.spyOn(prisma, '$queryRaw').mockRejectedValueOnce(new Error('Connection refused'));

    const res = await request(app).get('/api/v1/health/ready');

    expect(res.status).toBe(503);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).toBe('SERVICE_UNAVAILABLE');
    expect(res.body.error.message).toBe('Database service is unavailable');
    expect(res.body.error.status).toBe(503);
  });
});
