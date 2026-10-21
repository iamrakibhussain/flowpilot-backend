import { Request, Response, NextFunction } from 'express';
import { DashboardService } from './dashboard.service.js';
import { TimeframeType } from './dashboard.types.js';
import { sendSuccess } from '../../common/http/response.js';
import { BadRequestError } from '../../common/errors/app-error.js';

export class DashboardController {
  /**
   * GET /api/v1/dashboard/metrics
   */
  public static async getMetrics(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const rawTimeframe = (req.query.timeframe as string) || '30d';

      if (!['7d', '30d', '90d'].includes(rawTimeframe)) {
        throw new BadRequestError('Invalid timeframe. Must be 7d, 30d, or 90d');
      }

      const metrics = await DashboardService.getMetrics(
        organizationId,
        rawTimeframe as TimeframeType,
      );

      sendSuccess(res, metrics);
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/v1/dashboard/activities
   */
  public static async getActivities(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 10;
      const type = (req.query.type as 'all' | 'invoices' | 'appointments') || 'all';

      const activities = await DashboardService.getActivities(organizationId, limit, type);
      sendSuccess(res, activities);
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/v1/dashboard/schedule/today
   */
  public static async getTodaySchedule(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const schedule = await DashboardService.getTodaySchedule(organizationId);
      sendSuccess(res, schedule);
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/v1/dashboard/staff/on-duty
   */
  public static async getOnDutyStaff(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const staff = await DashboardService.getOnDutyStaff(organizationId);
      sendSuccess(res, staff);
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/v1/dashboard/customers
   */
  public static async getCustomers(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const customers = await DashboardService.getCustomers(organizationId);
      sendSuccess(res, customers);
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/v1/dashboard/invoices
   */
  public static async createInvoice(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const { customerId, customerName, description, amount, dueDate, status, items } = req.body;

      if ((!customerId && !customerName) || amount === undefined) {
        throw new BadRequestError('Either customerId or customerName, and amount are required');
      }

      const invoice = await DashboardService.createInvoice(organizationId, {
        customerId,
        customerName,
        description,
        amount: Number(amount),
        dueDate,
        status,
        items,
      });

      sendSuccess(res, invoice, 201);
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/v1/dashboard/appointments
   */
  public static async createAppointment(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const {
        customerId,
        customerName,
        serviceId,
        serviceTitle,
        staffMemberId,
        staffName,
        title,
        scheduledAt,
        date,
        time,
        durationMinutes,
        type,
        locationType,
        location,
        notes,
      } = req.body;

      if ((!customerId && !customerName) || (!scheduledAt && !date)) {
        throw new BadRequestError('Customer information and scheduled date/time are required');
      }

      const appointment = await DashboardService.createAppointment(organizationId, {
        customerId,
        customerName,
        serviceId,
        serviceTitle,
        staffMemberId,
        staffName,
        title: title ?? serviceTitle,
        scheduledAt,
        date,
        time,
        durationMinutes: durationMinutes ? Number(durationMinutes) : 60,
        type,
        locationType,
        location,
        notes,
      });

      sendSuccess(res, appointment, 201);
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/v1/dashboard/customers
   */
  public static async createCustomer(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const { name, contactName, email, phone, company, tier, currency, assignedStaff, notes } =
        req.body;

      if (!name || !email) {
        throw new BadRequestError('name and email are required');
      }

      const customer = await DashboardService.createCustomer(organizationId, {
        name,
        contactName,
        email,
        phone,
        company,
        tier,
        currency,
        assignedStaff,
        notes,
      });

      sendSuccess(res, customer, 201);
    } catch (err) {
      next(err);
    }
  }
}
