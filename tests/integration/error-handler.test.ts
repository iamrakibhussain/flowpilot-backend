import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { getTestApp } from '../helpers/test-app.js';
import { errorHandler } from '../../src/common/middleware/error-handler.js';
import {
  BadRequestError,
  UnauthorizedError,
  NotFoundError,
} from '../../src/common/errors/app-error.js';
import { prisma } from '../../src/database/prisma.js';
import { ZodError, z } from 'zod';
import type { Request, Response } from 'express';

describe('Centralized Error Handler & Malformed JSON Protection Suite', () => {
  const app = getTestApp();

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('Malformed JSON Body Parser Handling', () => {
    it('returns HTTP 400 with BAD_REQUEST code when request body has malformed JSON syntax', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .set('Content-Type', 'application/json')
        .send('{"email": "test@example.com", "password":'); // Truncated JSON

      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        success: false,
        error: {
          code: 'BAD_REQUEST',
          message: 'Malformed JSON payload in request body',
          status: 400,
        },
      });
    });

    it('returns HTTP 400 when request body contains unquoted keys or invalid tokens', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .set('Content-Type', 'application/json')
        .send('{email: test@example.com, password: secret}'); // Unquoted keys

      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        success: false,
        error: {
          code: 'BAD_REQUEST',
          message: 'Malformed JSON payload in request body',
          status: 400,
        },
      });
    });

    it('does not leak internal stack traces or raw parser details in the error response', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .set('Content-Type', 'application/json')
        .send('{"invalid": [1, 2, 3,}');

      expect(res.status).toBe(400);
      expect(res.body.error.stack).toBeUndefined();
      expect((res.body as any).stack).toBeUndefined();
      expect(res.text).not.toContain('SyntaxError');
      expect(res.text).not.toContain('node:internal');
      expect(res.text).not.toContain('Unexpected token');
    });
  });

  describe('Route Reachability with Valid JSON Payloads', () => {
    it('allows valid JSON payloads to reach their intended routes and executes request validation', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .set('Content-Type', 'application/json')
        .send({ email: 'not-an-email', password: 'short' }); // Valid JSON, invalid data

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.status).toBe(422);
      expect(res.body.error.message).toBe('Request validation failed');
      expect(res.body.error.details).toBeDefined();
    });

    it('allows valid credentials verification and returns 401 for non-existent users', async () => {
      vi.spyOn(prisma.user, 'findUnique').mockResolvedValueOnce(null);

      const res = await request(app)
        .post('/api/v1/auth/login')
        .set('Content-Type', 'application/json')
        .send({ email: 'nonexistent@example.com', password: 'ValidPassword123!' });

      expect(res.status).toBe(401);
      expect(res.body).toEqual({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid email or password',
          status: 401,
        },
      });
    });
  });

  describe('Preservation of AppError, ZodError, and Unrelated SyntaxErrors', () => {
    function createMockRes(): {
      res: Response;
      getStatus: () => number;
      getBody: () => any;
    } {
      let status = 200;
      let body: any = null;

      const res: any = {
        status: vi.fn().mockImplementation((s: number) => {
          status = s;
          return res;
        }),
        json: vi.fn().mockImplementation((b: any) => {
          body = b;
          return res;
        }),
      };

      return {
        res,
        getStatus: () => status,
        getBody: () => body,
      };
    }

    it('does NOT misclassify unrelated application SyntaxErrors as malformed JSON and emits HTTP 500', () => {
      const unrelatedSyntaxError = new SyntaxError('Unexpected token in dynamic script evaluation');
      const mock = createMockRes();
      const mockReq: Partial<Request> = {
        id: 'test-req-123',
        method: 'POST',
        originalUrl: '/api/v1/test',
        path: '/api/v1/test',
      };

      errorHandler(unrelatedSyntaxError, mockReq as Request, mock.res, vi.fn());

      expect(mock.res.status).toHaveBeenCalledWith(500);
      expect(mock.getStatus()).toBe(500);
      expect(mock.getBody().error.code).toBe('INTERNAL_SERVER_ERROR');
      expect(mock.getBody().error.status).toBe(500);
    });

    it('preserves existing AppError handling (BadRequestError, UnauthorizedError, NotFoundError)', () => {
      const badReqError = new BadRequestError('Custom bad request detail', { field: ['Required'] });
      const mock1 = createMockRes();
      const mockReq: Partial<Request> = { id: 'req-app-1', method: 'GET', originalUrl: '/test' };

      errorHandler(badReqError, mockReq as Request, mock1.res, vi.fn());

      expect(mock1.getStatus()).toBe(400);
      expect(mock1.getBody().error.code).toBe('BAD_REQUEST');
      expect(mock1.getBody().error.message).toBe('Custom bad request detail');
      expect(mock1.getBody().error.details).toEqual({ field: ['Required'] });

      const unauthError = new UnauthorizedError('Custom unauthenticated message');
      const mock2 = createMockRes();
      errorHandler(unauthError, mockReq as Request, mock2.res, vi.fn());

      expect(mock2.getStatus()).toBe(401);
      expect(mock2.getBody().error.code).toBe('UNAUTHORIZED');
      expect(mock2.getBody().error.message).toBe('Custom unauthenticated message');

      const notFoundErr = new NotFoundError('Custom resource not found');
      const mock3 = createMockRes();
      errorHandler(notFoundErr, mockReq as Request, mock3.res, vi.fn());

      expect(mock3.getStatus()).toBe(404);
      expect(mock3.getBody().error.code).toBe('NOT_FOUND');
      expect(mock3.getBody().error.message).toBe('Custom resource not found');
    });

    it('preserves direct ZodError handling and emits HTTP 400', () => {
      const schema = z.object({ email: z.string().email() });
      let zodError: ZodError | null = null;
      try {
        schema.parse({ email: 'invalid' });
      } catch (err) {
        zodError = err as ZodError;
      }

      expect(zodError).not.toBeNull();
      const mock = createMockRes();
      const mockReq: Partial<Request> = {
        id: 'req-zod-1',
        method: 'POST',
        originalUrl: '/api/v1/test',
      };

      errorHandler(zodError!, mockReq as Request, mock.res, vi.fn());

      expect(mock.getStatus()).toBe(400);
      expect(mock.getBody().error.code).toBe('VALIDATION_ERROR');
      expect(mock.getBody().error.details).toBeDefined();
    });

    it('preserves CORS policy error handling and emits HTTP 403', () => {
      const corsError = new Error(
        "Origin 'https://evil.attacker.com' not allowed by FlowPilot CORS policy",
      );
      const mock = createMockRes();
      const mockReq: Partial<Request> = {
        id: 'req-cors-1',
        method: 'POST',
        originalUrl: '/api/v1/auth/login',
      };

      errorHandler(corsError, mockReq as Request, mock.res, vi.fn());

      expect(mock.getStatus()).toBe(403);
      expect(mock.getBody().error.code).toBe('FORBIDDEN');
      expect(mock.getBody().error.status).toBe(403);
    });

    it('preserves generic unexpected internal errors and emits HTTP 500', () => {
      const genericError = new Error('Database socket unexpectedly disconnected');
      const mock = createMockRes();
      const mockReq: Partial<Request> = {
        id: 'req-gen-1',
        method: 'POST',
        originalUrl: '/api/v1/projects',
      };

      errorHandler(genericError, mockReq as Request, mock.res, vi.fn());

      expect(mock.getStatus()).toBe(500);
      expect(mock.getBody().error.code).toBe('INTERNAL_SERVER_ERROR');
      expect(mock.getBody().error.status).toBe(500);
    });
  });
});
