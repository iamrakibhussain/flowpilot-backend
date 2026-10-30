import { Request, Response, NextFunction } from 'express';
import { PortalService } from './portal.service.js';
import { UnauthorizedError } from '../../common/errors/app-error.js';

export const PORTAL_COOKIE_NAME = 'flowpilot_client_session';

export interface PortalContext {
  customer: {
    id: string;
    name: string;
    email: string;
    phone: string | null;
    company: string | null;
  };
  organization: {
    id: string;
    name: string;
    slug: string;
  };
  session: {
    id: string;
    expiresAt: Date;
  };
}

/* eslint-disable @typescript-eslint/no-namespace */
declare global {
  namespace Express {
    interface Request {
      portalContext?: PortalContext;
    }
  }
}
/* eslint-enable @typescript-eslint/no-namespace */

export async function requirePortalAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const rawToken =
      req.cookies?.[PORTAL_COOKIE_NAME] ||
      (req.headers['x-portal-session-token'] as string | undefined);

    if (!rawToken) {
      throw new UnauthorizedError('Client portal authentication required');
    }

    const { customer, organization, session } = await PortalService.validateSession(rawToken);

    req.portalContext = {
      customer,
      organization,
      session,
    };

    next();
  } catch (error) {
    next(error);
  }
}
