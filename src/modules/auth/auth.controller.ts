import { Request, Response, NextFunction } from 'express';
import { sendSuccess } from '../../common/http/response.js';
import { UnauthorizedError } from '../../common/errors/app-error.js';
import { AuthService } from './auth.service.js';
import { getSessionCookieOptions, getClearSessionCookieOptions } from '../../config/security.js';
import { logger } from '../../common/logging/logger.js';

export class AuthController {
  public static async login(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await AuthService.login(req.body, {
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      res.cookie('flowpilot_session', result.rawToken, getSessionCookieOptions());

      logger.info(
        {
          event: 'security.auth.login.success',
          userId: result.user.id,
          activeOrganizationId: result.activeOrganizationId,
          ip: req.ip,
          userAgent: req.headers['user-agent'],
        },
        'User authentication successful',
      );

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
      logger.warn(
        {
          event: 'security.auth.login.failed',
          ip: req.ip,
          userAgent: req.headers['user-agent'],
          reason: error instanceof Error ? error.message : 'Unknown reason',
        },
        'User authentication rejected',
      );
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

      logger.info(
        {
          event: 'security.auth.register.success',
          userId: result.user.id,
          activeOrganizationId: result.activeOrganizationId,
          ip: req.ip,
          userAgent: req.headers['user-agent'],
        },
        'User account and workspace provisioned successfully',
      );

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
      logger.warn(
        {
          event: 'security.auth.register.failed',
          ip: req.ip,
          userAgent: req.headers['user-agent'],
          reason: error instanceof Error ? error.message : 'Unknown reason',
        },
        'Registration attempt rejected',
      );
      next(error);
    }
  }

  public static async logout(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      let rawToken = req.sessionToken || req.cookies?.flowpilot_session;
      if (!rawToken && req.headers.authorization?.startsWith('Bearer ')) {
        rawToken = req.headers.authorization.slice(7).trim();
      }

      const allDevices = Boolean(req.body?.allDevices);

      if (rawToken) {
        await AuthService.logout(rawToken, { allDevices });
      }

      res.setHeader('Clear-Site-Data', '"cookies", "storage"');
      res.clearCookie('flowpilot_session', getClearSessionCookieOptions());

      logger.info(
        {
          event: allDevices ? 'security.auth.logout_all' : 'security.auth.logout',
          allDevices,
          ip: req.ip,
          userAgent: req.headers['user-agent'],
        },
        allDevices ? 'All user sessions invalidated' : 'User session invalidated',
      );

      sendSuccess(
        res,
        {
          message: allDevices ? 'All sessions logged out successfully' : 'Logged out successfully',
        },
        200,
      );
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
            isEmailVerified: Boolean(req.user.isEmailVerified),
            emailVerifiedAt: req.user.emailVerifiedAt ?? null,
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

  public static async forgotPassword(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const result = await AuthService.forgotPassword(req.body, {
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      sendSuccess(res, result, 200);
    } catch (error) {
      next(error);
    }
  }

  public static async resetPassword(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const result = await AuthService.resetPassword(req.body);

      logger.info(
        {
          event: 'security.auth.password_reset',
          ip: req.ip,
          userAgent: req.headers['user-agent'],
        },
        'Password reset successfully executed',
      );

      sendSuccess(res, result, 200);
    } catch (error) {
      next(error);
    }
  }

  public static async sendEmailVerification(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      if (!req.user) {
        throw new UnauthorizedError('Not authenticated');
      }

      const result = await AuthService.sendEmailVerification(req.user.id);
      sendSuccess(res, result, 200);
    } catch (error) {
      next(error);
    }
  }

  public static async verifyEmail(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw new UnauthorizedError('Not authenticated');
      }

      const result = await AuthService.verifyEmail(req.user.id, req.body);

      logger.info(
        {
          event: 'security.auth.email_verified',
          userId: req.user.id,
          ip: req.ip,
        },
        'User email address successfully verified',
      );

      sendSuccess(res, result, 200);
    } catch (error) {
      next(error);
    }
  }

  public static async changePassword(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      if (!req.user || !req.sessionId) {
        throw new UnauthorizedError('Not authenticated');
      }

      const result = await AuthService.changePassword(req.user.id, req.sessionId, req.body);

      logger.info(
        {
          event: 'security.auth.password_changed',
          userId: req.user.id,
          ip: req.ip,
        },
        'User password successfully changed from authenticated session',
      );

      sendSuccess(res, result, 200);
    } catch (error) {
      next(error);
    }
  }

  public static async deleteAccount(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      if (!req.user) {
        throw new UnauthorizedError('Not authenticated');
      }

      const result = await AuthService.deleteAccount(req.user.id, req.body);

      // Clear session cookie on deletion
      res.clearCookie('flowpilot_session', getClearSessionCookieOptions());

      logger.warn(
        {
          event: 'security.auth.account_deleted',
          userId: req.user.id,
          ip: req.ip,
        },
        'User account and associated workspace permanently deleted',
      );

      sendSuccess(res, result, 200);
    } catch (error) {
      next(error);
    }
  }
}
