import { Request, Response, NextFunction } from 'express';
import { PublicBookingService } from './public-booking.service.js';
import { sendSuccess } from '../../common/http/response.js';
import { BadRequestError } from '../../common/errors/app-error.js';

export class PublicBookingController {
  public static async getProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const slug = req.params.slug;
      if (!slug) throw new BadRequestError('Organization slug is required');

      const profile = await PublicBookingService.getOrganizationProfile(slug);
      sendSuccess(res, profile);
    } catch (err) {
      next(err);
    }
  }

  public static async getSlots(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const slug = req.params.slug;
      const serviceId = req.query.serviceId as string;
      const date = req.query.date as string;
      const staffMemberId = (req.query.staffMemberId as string) || undefined;

      if (!slug) throw new BadRequestError('Organization slug is required');
      if (!serviceId) throw new BadRequestError('Service ID is required');
      if (!date) throw new BadRequestError('Date is required');

      const slots = await PublicBookingService.getAvailableSlots(
        slug,
        serviceId,
        date,
        staffMemberId,
      );
      sendSuccess(res, slots);
    } catch (err) {
      next(err);
    }
  }

  public static async book(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const slug = req.params.slug;
      if (!slug) throw new BadRequestError('Organization slug is required');

      const {
        serviceId,
        staffMemberId,
        date,
        time,
        customerName,
        customerEmail,
        customerPhone,
        notes,
      } = req.body;

      const result = await PublicBookingService.bookAppointment(slug, {
        serviceId,
        staffMemberId,
        date,
        time,
        customerName,
        customerEmail,
        customerPhone,
        notes,
      });

      sendSuccess(res, result, 201);
    } catch (err) {
      next(err);
    }
  }
}
