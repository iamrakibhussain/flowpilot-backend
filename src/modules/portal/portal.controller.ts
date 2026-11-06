import { Request, Response, NextFunction } from 'express';
import { PortalService } from './portal.service.js';
import {
  requestPortalLinkSchema,
  verifyPortalTokenSchema,
  rescheduleAppointmentSchema,
  cancelAppointmentSchema,
  updatePortalProfileSchema,
  signPortalContractSchema,
  acceptPortalQuoteSchema,
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
   * Generate secure access token to review a quote/proposal
   */
  public static async getQuoteToken(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      if (!req.portalContext) {
        throw new UnauthorizedError('Portal context missing');
      }

      const quoteId = req.params.id;
      if (!quoteId) {
        throw new BadRequestError('Quote ID is required');
      }

      const result = await PortalService.getQuoteAccessToken(
        req.portalContext.organization.id,
        req.portalContext.customer.id,
        quoteId,
      );

      sendSuccess(res, result, 200);
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

  /**
   * List contracts for client
   */
  public static async listContracts(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      if (!req.portalContext) throw new UnauthorizedError('Portal context missing');
      const contracts = await PortalService.listContracts(
        req.portalContext.organization.id,
        req.portalContext.customer.id,
      );
      sendSuccess(res, contracts, 200);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get single contract
   */
  public static async getContract(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.portalContext) throw new UnauthorizedError('Portal context missing');
      const contractId = req.params.id;
      if (!contractId) throw new BadRequestError('Contract ID required');
      const contract = await PortalService.getContractById(
        req.portalContext.organization.id,
        req.portalContext.customer.id,
        contractId,
      );
      sendSuccess(res, contract, 200);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Execute in-portal digital signature
   */
  public static async signContract(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.portalContext) throw new UnauthorizedError('Portal context missing');
      const contractId = req.params.id;
      if (!contractId) throw new BadRequestError('Contract ID required');
      const parsed = signPortalContractSchema.parse(req.body);
      const result = await PortalService.signContract(
        req.portalContext.organization.id,
        req.portalContext.customer.id,
        contractId,
        parsed,
        {
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
        },
      );
      sendSuccess(res, result, 200, 'Contract digitally signed and verified');
    } catch (error) {
      next(error);
    }
  }

  /**
   * Accept proposal/quote in-portal
   */
  public static async acceptQuote(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.portalContext) throw new UnauthorizedError('Portal context missing');
      const quoteId = req.params.id;
      if (!quoteId) throw new BadRequestError('Quote ID required');
      const parsed = acceptPortalQuoteSchema.parse(req.body);
      const result = await PortalService.acceptQuote(
        req.portalContext.organization.id,
        req.portalContext.customer.id,
        quoteId,
        parsed,
        { ipAddress: req.ip },
      );
      sendSuccess(res, result, 200, 'Proposal accepted successfully');
    } catch (error) {
      next(error);
    }
  }

  /**
   * Available slots for rescheduling
   */
  public static async getAvailableSlots(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      if (!req.portalContext) throw new UnauthorizedError('Portal context missing');
      const appointmentId = req.params.id;
      const dateStr = req.query.date as string;
      if (!appointmentId) throw new BadRequestError('Appointment ID required');
      if (!dateStr) throw new BadRequestError('date query parameter (YYYY-MM-DD) required');

      const slots = await PortalService.getAvailableSlotsForReschedule(
        req.portalContext.organization.id,
        req.portalContext.customer.id,
        appointmentId,
        dateStr,
      );
      sendSuccess(res, slots, 200);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Notifications feed for client portal
   */
  public static async getNotifications(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      if (!req.portalContext) throw new UnauthorizedError('Portal context missing');
      const data = await PortalService.getNotifications(
        req.portalContext.organization.id,
        req.portalContext.customer.id,
      );
      sendSuccess(res, data, 200);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Mark single notification as read
   */
  public static async markNotificationRead(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      if (!req.portalContext) throw new UnauthorizedError('Portal context missing');
      const id = req.params.id;
      if (!id) throw new BadRequestError('Notification ID required');
      const updated = await PortalService.markNotificationRead(
        req.portalContext.organization.id,
        req.portalContext.customer.id,
        id,
      );
      sendSuccess(res, updated, 200);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Mark all notifications as read
   */
  public static async markAllNotificationsRead(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      if (!req.portalContext) throw new UnauthorizedError('Portal context missing');
      const result = await PortalService.markAllNotificationsRead(
        req.portalContext.organization.id,
        req.portalContext.customer.id,
      );
      sendSuccess(res, result, 200);
    } catch (error) {
      next(error);
    }
  }
}
