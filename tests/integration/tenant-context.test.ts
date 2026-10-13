import { describe, it, expect } from 'vitest';
import express, { Request, Response } from 'express';
import request from 'supertest';
import { tenantContextMiddleware } from '../../src/common/middleware/tenant-context.js';
import { errorHandler } from '../../src/common/middleware/error-handler.js';
import { sendSuccess } from '../../src/common/http/response.js';

describe('Tenant Context Middleware & Server-Side Multi-Tenancy Validation', () => {
  function createTenantTestApp(requireAuth = false) {
    const app = express();
    app.use(express.json());

    // Mock auth middleware if required
    if (requireAuth) {
      app.use((req, _res, next) => {
        req.user = { id: 'user-1', email: 'user@example.com', name: 'Test User', role: 'MEMBER' };
        next();
      });
    }

    app.get(
      '/api/v1/test-tenant',
      tenantContextMiddleware({ requireMembershipVerification: requireAuth }),
      (req: Request, res: Response) => {
        sendSuccess(res, { tenant: req.tenant });
      },
    );

    app.use(errorHandler);
    return app;
  }

  it('returns HTTP 400 when X-Organization-Id header is missing', async () => {
    const app = createTenantTestApp();
    const res = await request(app).get('/api/v1/test-tenant');

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('BAD_REQUEST');
    expect(res.body.error.message).toContain('Missing required X-Organization-Id header');
  });

  it('returns HTTP 400 when X-Organization-Id is not a valid UUID', async () => {
    const app = createTenantTestApp();
    const res = await request(app)
      .get('/api/v1/test-tenant')
      .set('X-Organization-Id', 'not-a-uuid');

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('BAD_REQUEST');
    expect(res.body.error.message).toContain('Must be a valid UUID');
  });

  it('attaches verified tenant context when valid UUID is supplied', async () => {
    const app = createTenantTestApp();
    const validUuid = '123e4567-e89b-12d3-a456-426614174000';
    const res = await request(app).get('/api/v1/test-tenant').set('X-Organization-Id', validUuid);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.tenant.organizationId).toBe(validUuid);
  });
});
