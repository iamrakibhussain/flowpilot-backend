import { Request, Response, NextFunction } from 'express';
import { RecurringService } from './recurring.service.js';
import { sendSuccess } from '../../common/http/response.js';
import {
  createRecurringScheduleSchema,
  updateRecurringScheduleSchema,
  logRetainerHoursSchema,
  ListRecurringSchedulesQuery,
} from './recurring.types.js';
import type { RecurringFrequency, RecurringStatus } from '@prisma/client';

export class RecurringController {
  /**
   * GET /api/v1/recurring
   */
  public static async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const { status, customerId, frequency, search, page, limit } = req.query;

      const query: ListRecurringSchedulesQuery = {
        status: typeof status === 'string' ? (status as RecurringStatus) : undefined,
        customerId: typeof customerId === 'string' ? customerId : undefined,
        frequency: typeof frequency === 'string' ? (frequency as RecurringFrequency) : undefined,
        search: typeof search === 'string' ? search : undefined,
        page: typeof page === 'string' ? parseInt(page, 10) : undefined,
        limit: typeof limit === 'string' ? parseInt(limit, 10) : undefined,
      };

      const result = await RecurringService.listSchedules(organizationId, query);
      const totalPages = Math.ceil(result.total / result.limit);

      sendSuccess(res, result.schedules, 200, undefined, {
        total: result.total,
        page: result.page,
        limit: result.limit,
        totalPages,
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/v1/recurring/stats
   */
  public static async getStats(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const stats = await RecurringService.getStats(organizationId);
      sendSuccess(res, stats);
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/v1/recurring/:id
   */
  public static async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const id = req.params.id as string;
      const schedule = await RecurringService.getScheduleById(organizationId, id);
      sendSuccess(res, schedule);
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/v1/recurring
   */
  public static async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const validated = createRecurringScheduleSchema.parse(req.body);
      const created = await RecurringService.createSchedule(organizationId, validated);
      sendSuccess(res, created, 201, 'Recurring schedule created successfully');
    } catch (err) {
      next(err);
    }
  }

  /**
   * PATCH /api/v1/recurring/:id
   */
  public static async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const id = req.params.id as string;
      const validated = updateRecurringScheduleSchema.parse(req.body);
      const updated = await RecurringService.updateSchedule(organizationId, id, validated);
      sendSuccess(res, updated, 200, 'Recurring schedule updated successfully');
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/v1/recurring/:id/pause
   */
  public static async pause(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const id = req.params.id as string;
      const paused = await RecurringService.pauseSchedule(organizationId, id);
      sendSuccess(res, paused, 200, 'Recurring schedule paused');
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/v1/recurring/:id/resume
   */
  public static async resume(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const id = req.params.id as string;
      const resumed = await RecurringService.resumeSchedule(organizationId, id);
      sendSuccess(res, resumed, 200, 'Recurring schedule resumed');
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/v1/recurring/:id/cancel
   */
  public static async cancel(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const id = req.params.id as string;
      const cancelled = await RecurringService.cancelSchedule(organizationId, id);
      sendSuccess(res, cancelled, 200, 'Recurring schedule cancelled');
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/v1/recurring/:id/retainer-hours
   */
  public static async logRetainerHours(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const id = req.params.id as string;
      const validated = logRetainerHoursSchema.parse(req.body);
      const result = await RecurringService.logRetainerHours(organizationId, id, validated);
      sendSuccess(res, result, 200, 'Retainer hours logged successfully');
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/v1/recurring/process-now
   * Trigger immediate processing of all due schedules
   */
  public static async processNow(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await RecurringService.processDueSchedules();
      sendSuccess(res, result, 200, 'Recurring schedules processed');
    } catch (err) {
      next(err);
    }
  }
}
