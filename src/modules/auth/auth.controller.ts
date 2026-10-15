import { Request, Response, NextFunction } from 'express';
import { sendSuccess } from '../../common/http/response.js';
import { UnauthorizedError } from '../../common/errors/app-error.js';
import { AuthService } from './auth.service.js';
import { getSessionCookieOptions, getClearSessionCookieOptions } from '../../config/security.js';

export class AuthController {
  public static async login(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await AuthService.login(req.body, {
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      res.cookie('flowpilot_session', result.rawToken, getSessionCookieOptions());

      sendSuccess(
        res,
        {
          user: result.user,
          activeOrganizationId: result.activeOrganizationId,
          memberships: result.memberships,
        },
        200,
        'Login successful',
      );
    } catch (error) {
      next(error);
    }
  }

  public static async register(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await AuthService.register(req.body, {
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      res.cookie('flowpilot_session', result.rawToken, getSessionCookieOptions());

      sendSuccess(
        res,
        {
          user: result.user,
          activeOrganizationId: result.activeOrganizationId,
          memberships: result.memberships,
        },
        201,
        'Registration successful',
      );
    } catch (error) {
      next(error);
    }
  }

  public static async logout(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const rawToken = req.sessionToken || req.cookies?.flowpilot_session;
      if (rawToken) {
        await AuthService.logout(rawToken);
      }

      res.clearCookie('flowpilot_session', getClearSessionCookieOptions());
      sendSuccess(res, { message: 'Logged out successfully' }, 200);
    } catch (error) {
      next(error);
    }
  }

  public static async me(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw new UnauthorizedError('Not authenticated');
      }

      sendSuccess(
        res,
        {
          user: {
            id: req.user.id,
            email: req.user.email,
            name: req.user.name,
          },
          activeOrganizationId: req.user.memberships?.[0]?.organizationId ?? null,
          memberships: req.user.memberships ?? [],
        },
        200,
      );
    } catch (error) {
      next(error);
    }
  }
}
