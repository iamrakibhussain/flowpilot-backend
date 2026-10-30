import { Request, Response, NextFunction } from 'express';
import { PortalService } from './portal.service.js';
import {
  requestPortalLinkSchema,
  verifyPortalTokenSchema,
  rescheduleAppointmentSchema,
  cancelAppointmentSchema,
  updatePortalProfileSchema,
} from './portal.types.js';
import { sendSuccess } from '../../common/http/response.js';
import { getSessionCookieOptions, getClearSessionCookieOptions } from '../../config/security.js';
import { PORTAL_COOKIE_NAME } from './portal.middleware.js';
import { UnauthorizedError, BadRequestError } from '../../common/errors/app-error.js';

export class PortalController {
  /**
   * Request magic link & 6-digit OTP passcode
   */
  public static async requestLink(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const parsed = requestPortalLinkSchema.parse(req.body);
      const result = await PortalService.requestPortalLink(parsed, {
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
      sendSuccess(res, result, 200, result.message);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Verify token or code & set portal session cookie
   */
  public static async verifyToken(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const parsed = verifyPortalTokenSchema.parse(req.body);
      const result = await PortalService.verifyPortalToken(parsed, {
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });

      // Set HttpOnly session cookie
      res.cookie(PORTAL_COOKIE_NAME, result.rawSessionToken, getSessionCookieOptions());

      sendSuccess(
        res,
        {
          customer: result.customer,
          organization: result.organization,
        },
        200,
        'Client portal session authenticated',
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Return authenticated customer identity
   */
  public static async getMe(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.portalContext) {
        throw new UnauthorizedError('Portal context missing');
      }

      sendSuccess(
        res,
        {
          customer: req.portalContext.customer,
          organization: req.portalContext.organization,
        },
        200,
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Fetch complete portal dashboard state (appointments, invoices, brand)
   */
  public static async getDashboard(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.portalContext) {
        throw new UnauthorizedError('Portal context missing');
      }

      const data = await PortalService.getPortalDashboardData(
        req.portalContext.organization.id,
        req.portalContext.customer.id,
      );

      sendSuccess(res, data, 200);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Reschedule appointment self-service
   */
  public static async reschedule(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.portalContext) {
        throw new UnauthorizedError('Portal context missing');
      }

      const appointmentId = req.params.id;
      if (!appointmentId) {
        throw new BadRequestError('Appointment ID is required');
      }

      const parsed = rescheduleAppointmentSchema.parse(req.body);
      const updated = await PortalService.rescheduleAppointment(
        req.portalContext.organization.id,
        req.portalContext.customer.id,
        appointmentId,
        parsed,
      );

      sendSuccess(res, updated, 200, 'Appointment rescheduled successfully');
    } catch (error) {
      next(error);
    }
  }

  /**
   * Cancel appointment self-service
   */
  public static async cancel(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.portalContext) {
        throw new UnauthorizedError('Portal context missing');
      }

      const appointmentId = req.params.id;
      if (!appointmentId) {
        throw new BadRequestError('Appointment ID is required');
      }

      const parsed = cancelAppointmentSchema.parse(req.body);
      const updated = await PortalService.cancelAppointment(
        req.portalContext.organization.id,
        req.portalContext.customer.id,
        appointmentId,
        parsed,
      );

      sendSuccess(res, updated, 200, 'Appointment cancelled successfully');
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update client contact coordinates
   */
  public static async updateProfile(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      if (!req.portalContext) {
        throw new UnauthorizedError('Portal context missing');
      }

      const parsed = updatePortalProfileSchema.parse(req.body);
      const updated = await PortalService.updateProfile(
        req.portalContext.organization.id,
        req.portalContext.customer.id,
        parsed,
      );

      sendSuccess(res, updated, 200, 'Profile updated successfully');
    } catch (error) {
      next(error);
    }
  }

  /**
   * End portal session & clear cookie
   */
  public static async logout(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const rawToken =
        req.cookies?.[PORTAL_COOKIE_NAME] ||
        (req.headers['x-portal-session-token'] as string | undefined);

      if (rawToken) {
        await PortalService.logout(rawToken);
      }

      res.clearCookie(PORTAL_COOKIE_NAME, getClearSessionCookieOptions());
      sendSuccess(res, null, 200, 'Logged out of client portal');
    } catch (error) {
      next(error);
    }
  }
}
