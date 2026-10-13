import { describe, it, expect, vi } from 'vitest';
import { sendSuccess, sendError } from '../../src/common/http/response.js';
import { Response } from 'express';

describe('Unified API Response Format', () => {
  it('formats success response matching frontend ApiResponse envelope', () => {
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    } as unknown as Response;

    const data = { id: '123', name: 'Acme Corp' };
    sendSuccess(res, data, 200, 'Created', { page: 1, limit: 10, total: 1, totalPages: 1 });

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data,
      message: 'Created',
      meta: { page: 1, limit: 10, total: 1, totalPages: 1 },
    });
  });

  it('formats error response matching frontend ApiErrorResponse envelope', () => {
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    } as unknown as Response;

    const errorPayload = {
      code: 'UNAUTHORIZED',
      message: 'Session expired',
      status: 401,
      details: { token: ['Expired at 12:00'] },
    };

    sendError(res, errorPayload, 401);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: errorPayload,
    });
  });
});
