import { Request, Response, NextFunction } from 'express';
import { UnauthorizedError } from '../errors/app-error.js';
import { AuthService } from '../../modules/auth/auth.service.js';

export async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const token = req.cookies?.flowpilot_session;

  if (!token || typeof token !== 'string') {
    return next(new UnauthorizedError('Authentication required'));
  }

  const session = await AuthService.validateSession(token);

  if (!session) {
    return next(new UnauthorizedError('Session expired or invalid'));
  }

  req.user = session.user;
  req.sessionId = session.sessionId;
  req.sessionToken = token;

  next();
}
