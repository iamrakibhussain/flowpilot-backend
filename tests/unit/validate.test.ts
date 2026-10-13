import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { validateRequest } from '../../src/common/middleware/validate.js';
import { Request, Response, NextFunction } from 'express';
import { ValidationError } from '../../src/common/errors/app-error.js';

describe('Zod Request Validation Middleware', () => {
  const schema = z.object({
    name: z.string().min(3),
    count: z.number().int().positive(),
  });

  it('calls next() without errors when input is valid', async () => {
    const middleware = validateRequest({ body: schema });
    const req = { body: { name: 'FlowPilot', count: 5 } } as Request;
    const res = {} as Response;
    const next = vi.fn();

    await middleware(req, res, next as unknown as NextFunction);
    expect(next).toHaveBeenCalledWith();
  });

  it('passes a structured ValidationError to next() when input fails validation', async () => {
    const middleware = validateRequest({ body: schema });
    const req = { body: { name: 'ab', count: -1 } } as Request;
    const res = {} as Response;
    const next = vi.fn();

    await middleware(req, res, next as unknown as NextFunction);
    expect(next).toHaveBeenCalledTimes(1);

    const callArg = next.mock.calls[0]?.[0];
    expect(callArg).toBeInstanceOf(ValidationError);
    expect(callArg.statusCode).toBe(422);
    expect(callArg.code).toBe('VALIDATION_ERROR');
    expect(callArg.details).toHaveProperty('name');
    expect(callArg.details).toHaveProperty('count');
  });
});
