import { Request, Response, NextFunction } from 'express';
import { StaffService } from './staff.service.js';
import { sendSuccess } from '../../common/http/response.js';
import { BadRequestError } from '../../common/errors/app-error.js';
import { StaffStatus, StaffTier } from '@prisma/client';

export class StaffController {
  public static async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const { search, status, tier, serviceId } = req.query;

      const staff = await StaffService.listStaff(organizationId, {
        search: typeof search === 'string' ? search : undefined,
        status:
          typeof status === 'string' && Object.values(StaffStatus).includes(status as StaffStatus)
            ? (status as StaffStatus)
            : undefined,
        tier:
          typeof tier === 'string' && Object.values(StaffTier).includes(tier as StaffTier)
            ? (tier as StaffTier)
            : undefined,
        serviceId: typeof serviceId === 'string' ? serviceId : undefined,
      });

      sendSuccess(res, staff);
    } catch (err) {
      next(err);
    }
  }

  public static async getMetrics(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const metrics = await StaffService.getMetrics(organizationId);
      sendSuccess(res, metrics);
    } catch (err) {
      next(err);
    }
  }

  public static async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const { id } = req.params;

      if (!id) throw new BadRequestError('Staff ID is required');

      const staff = await StaffService.getStaffById(organizationId, id);
      sendSuccess(res, staff);
    } catch (err) {
      next(err);
    }
  }

  public static async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const {
        name,
        roleTitle,
        email,
        phone,
        avatarBg,
        status,
        tier,
        hourlyRate,
        commissionRate,
        workingDays,
        shiftStart,
        shiftEnd,
        bio,
        serviceIds,
      } = req.body;

      const created = await StaffService.createStaff(organizationId, {
        name,
        roleTitle,
        email,
        phone,
        avatarBg,
        status,
        tier,
        hourlyRate: hourlyRate != null ? Number(hourlyRate) : undefined,
        commissionRate: commissionRate != null ? Number(commissionRate) : undefined,
        workingDays,
        shiftStart,
        shiftEnd,
        bio,
        serviceIds,
      });

      sendSuccess(res, created, 201);
    } catch (err) {
      next(err);
    }
  }

  public static async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const { id } = req.params;

      if (!id) throw new BadRequestError('Staff ID is required');

      const {
        name,
        roleTitle,
        email,
        phone,
        avatarBg,
        status,
        tier,
        hourlyRate,
        commissionRate,
        workingDays,
        shiftStart,
        shiftEnd,
        bio,
        serviceIds,
      } = req.body;

      const updated = await StaffService.updateStaff(organizationId, id, {
        name,
        roleTitle,
        email,
        phone,
        avatarBg,
        status,
        tier,
        hourlyRate:
          hourlyRate !== undefined ? (hourlyRate != null ? Number(hourlyRate) : null) : undefined,
        commissionRate:
          commissionRate !== undefined
            ? commissionRate != null
              ? Number(commissionRate)
              : null
            : undefined,
        workingDays,
        shiftStart,
        shiftEnd,
        bio,
        serviceIds,
      });

      sendSuccess(res, updated);
    } catch (err) {
      next(err);
    }
  }

  public static async updateStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const { id } = req.params;
      const { status } = req.body;

      if (!id) throw new BadRequestError('Staff ID is required');
      if (!status || !Object.values(StaffStatus).includes(status)) {
        throw new BadRequestError('Valid StaffStatus is required');
      }

      const updated = await StaffService.updateStatus(organizationId, id, status);
      sendSuccess(res, updated);
    } catch (err) {
      next(err);
    }
  }

  public static async delete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const { id } = req.params;

      if (!id) throw new BadRequestError('Staff ID is required');

      const result = await StaffService.deleteStaff(organizationId, id);
      sendSuccess(res, result);
    } catch (err) {
      next(err);
    }
  }
}
