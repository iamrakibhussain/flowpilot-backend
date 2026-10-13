import { Response } from 'express';
import { ApiResponse, ApiErrorResponse, ApiErrorPayload, PaginationMeta } from '../types/index.js';

export function sendSuccess<T>(
  res: Response,
  data: T,
  statusCode = 200,
  message?: string,
  meta?: PaginationMeta,
): Response<ApiResponse<T>> {
  const payload: ApiResponse<T> = {
    success: true,
    data,
    ...(message ? { message } : {}),
    ...(meta ? { meta } : {}),
  };
  return res.status(statusCode).json(payload);
}

export function sendError(
  res: Response,
  error: ApiErrorPayload,
  statusCode?: number,
): Response<ApiErrorResponse> {
  const status = statusCode ?? error.status;
  const payload: ApiErrorResponse = {
    success: false,
    error,
  };
  return res.status(status).json(payload);
}
