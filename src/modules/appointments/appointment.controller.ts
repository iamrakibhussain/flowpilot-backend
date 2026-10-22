import { Request, Response, NextFunction } from 'express';
import { AppointmentService } from './appointment.service.js';
import { sendSuccess } from '../../common/http/response.js';
import { BadRequestError } from '../../common/errors/app-error.js';
import { AppointmentStatus, AppointmentType } from '@prisma/client';
import { ListAppointmentsQuery } from './appointment.types.js';

export class AppointmentController {
  /**
   * GET /api/v1/appointments
   */
  public static async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const { startDate, endDate, customerId, staffMemberId, serviceId, status, type, search } =
        req.query;

      const query: ListAppointmentsQuery = {
        startDate: typeof startDate === 'string' ? startDate : undefined,
        endDate: typeof endDate === 'string' ? endDate : undefined,
        customerId: typeof customerId === 'string' ? customerId : undefined,
        staffMemberId: typeof staffMemberId === 'string' ? staffMemberId : undefined,
        serviceId: typeof serviceId === 'string' ? serviceId : undefined,
        status:
          typeof status === 'string' &&
          Object.values(AppointmentStatus).includes(status as AppointmentStatus)
            ? (status as AppointmentStatus)
            : undefined,
        type:
          typeof type === 'string' &&
          Object.values(AppointmentType).includes(type as AppointmentType)
            ? (type as AppointmentType)
            : undefined,
        search: typeof search === 'string' ? search : undefined,
      };

      const result = await AppointmentService.listAppointments(organizationId, query);
      sendSuccess(res, result);
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/v1/appointments/:id
   */
  public static async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const id = req.params.id;
      if (!id) {
        throw new BadRequestError('Appointment ID is required');
      }

      const appointment = await AppointmentService.getAppointmentById(organizationId, id);
      sendSuccess(res, appointment);
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/v1/appointments
   */
  public static async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const {
        customerId,
        serviceId,
        staffMemberId,
        title,
        scheduledAt,
        durationMinutes,
        type,
        location,
        notes,
        status,
      } = req.body;

      if (!customerId) {
        throw new BadRequestError('Client ID is required to schedule an appointment');
      }
      if (!scheduledAt) {
        throw new BadRequestError('Appointment date and time (scheduledAt) is required');
      }

      const created = await AppointmentService.createAppointment(organizationId, {
        customerId,
        serviceId,
        staffMemberId,
        title,
        scheduledAt,
        durationMinutes: durationMinutes ? Number(durationMinutes) : undefined,
        type,
        location,
        notes,
        status,
      });

      sendSuccess(res, created, 201);
    } catch (err) {
      next(err);
    }
  }

  /**
   * PATCH /api/v1/appointments/:id
   */
  public static async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const id = req.params.id;
      if (!id) {
        throw new BadRequestError('Appointment ID is required');
      }

      const updated = await AppointmentService.updateAppointment(organizationId, id, req.body);
      sendSuccess(res, updated);
    } catch (err) {
      next(err);
    }
  }

  /**
   * PATCH /api/v1/appointments/:id/reschedule
   */
  public static async reschedule(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const id = req.params.id;
      const { newScheduledAt, newDurationMinutes, newStaffMemberId, reason } = req.body;

      if (!id) {
        throw new BadRequestError('Appointment ID is required');
      }
      if (!newScheduledAt) {
        throw new BadRequestError('newScheduledAt date is required for rescheduling');
      }

      const updated = await AppointmentService.rescheduleAppointment(organizationId, id, {
        newScheduledAt,
        newDurationMinutes: newDurationMinutes ? Number(newDurationMinutes) : undefined,
        newStaffMemberId,
        reason,
      });

      sendSuccess(res, updated);
    } catch (err) {
      next(err);
    }
  }

  /**
   * PATCH /api/v1/appointments/:id/status
   */
  public static async updateStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const id = req.params.id;
      const { status, notes } = req.body;

      if (!id) {
        throw new BadRequestError('Appointment ID is required');
      }
      if (!status || !Object.values(AppointmentStatus).includes(status)) {
        throw new BadRequestError('Valid appointment status is required');
      }

      const updated = await AppointmentService.updateStatus(organizationId, id, status, notes);
      sendSuccess(res, updated);
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/v1/appointments/check-conflict
   */
  public static async checkConflict(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const { staffMemberId, scheduledAt, durationMinutes, excludeAppointmentId } = req.body;

      if (!staffMemberId || !scheduledAt) {
        throw new BadRequestError('staffMemberId and scheduledAt are required');
      }

      const result = await AppointmentService.checkConflict(organizationId, {
        staffMemberId,
        scheduledAt,
        durationMinutes: durationMinutes ? Number(durationMinutes) : 60,
        excludeAppointmentId,
      });

      sendSuccess(res, result);
    } catch (err) {
      next(err);
    }
  }

  /**
   * DELETE /api/v1/appointments/:id
   */
  public static async cancel(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const id = req.params.id;
      const { reason } = req.body ?? {};

      if (!id) {
        throw new BadRequestError('Appointment ID is required');
      }

      const cancelled = await AppointmentService.cancelAppointment(organizationId, id, reason);
      sendSuccess(res, cancelled);
    } catch (err) {
      next(err);
    }
  }
}
