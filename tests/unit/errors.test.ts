import { describe, it, expect } from 'vitest';
import {
  AppError,
  BadRequestError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  ValidationError,
  RateLimitError,
  InternalServerError,
} from '../../src/common/errors/app-error.js';

describe('AppError Hierarchy & Domain Exceptions', () => {
  it('instantiates BadRequestError with correct status and code', () => {
    const err = new BadRequestError('Invalid payload', { field: ['Required'] });
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe('BAD_REQUEST');
    expect(err.details).toEqual({ field: ['Required'] });
    expect(err.isOperational).toBe(true);
  });

  it('instantiates UnauthorizedError with default message and status 401', () => {
    const err = new UnauthorizedError();
    expect(err.statusCode).toBe(401);
    expect(err.code).toBe('UNAUTHORIZED');
    expect(err.message).toBe('Authentication required');
  });

  it('instantiates ForbiddenError with status 403', () => {
    const err = new ForbiddenError('Tenant permission denied');
    expect(err.statusCode).toBe(403);
    expect(err.code).toBe('FORBIDDEN');
    expect(err.message).toBe('Tenant permission denied');
  });

  it('instantiates NotFoundError with status 404', () => {
    const err = new NotFoundError('Organization not found');
    expect(err.statusCode).toBe(404);
    expect(err.code).toBe('NOT_FOUND');
  });

  it('instantiates ConflictError with status 409', () => {
    const err = new ConflictError('User already exists');
    expect(err.statusCode).toBe(409);
    expect(err.code).toBe('CONFLICT');
  });

  it('instantiates ValidationError with status 422', () => {
    const err = new ValidationError('Validation failed', { email: ['Invalid format'] });
    expect(err.statusCode).toBe(422);
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.details).toEqual({ email: ['Invalid format'] });
  });

  it('instantiates RateLimitError with status 429', () => {
    const err = new RateLimitError();
    expect(err.statusCode).toBe(429);
    expect(err.code).toBe('RATE_LIMITED');
  });

  it('instantiates InternalServerError with status 500 and isOperational false', () => {
    const err = new InternalServerError();
    expect(err.statusCode).toBe(500);
    expect(err.code).toBe('INTERNAL_SERVER_ERROR');
    expect(err.isOperational).toBe(false);
  });
});
