export type UserRole = 'OWNER' | 'ADMIN' | 'MEMBER' | 'BILLING';

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  role?: UserRole;
}

export interface TenantContext {
  organizationId: string;
  role?: UserRole;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface ApiResponse<T = unknown> {
  success: true;
  data: T;
  message?: string;
  meta?: PaginationMeta;
}

export interface ApiErrorPayload {
  code: string;
  message: string;
  status: number;
  details?: Record<string, string[]>;
}

export interface ApiErrorResponse {
  success: false;
  error: ApiErrorPayload;
}

/* eslint-disable @typescript-eslint/no-namespace */
declare global {
  namespace Express {
    interface Request {
      id?: string;
      user?: AuthenticatedUser;
      tenant?: TenantContext;
    }
  }
}
/* eslint-enable @typescript-eslint/no-namespace */
