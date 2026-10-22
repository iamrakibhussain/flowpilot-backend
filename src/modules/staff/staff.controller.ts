import { Request, Response, NextFunction } from 'express';
import { StaffService } from './staff.service.js';
import { sendSuccess } from '../../common/http/response.js';
import { BadRequestError } from '../../common/errors/app-error.js';
import { StaffStatus } from '@prisma/client';

export class StaffController {
  public static async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const staff = await StaffService.listStaff(organizationId);
      sendSuccess(res, staff);
    } catch (err) {
      next(err);
    }
  }

  public static async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const { name, roleTitle, email, avatarBg, status } = req.body;

      const created = await StaffService.createStaff(organizationId, {
        name,
        roleTitle,
        email,
        avatarBg,
        status,
      });

      sendSuccess(res, created, 201);
    } catch (err) {
      next(err);
    }
  }

  public static async updateStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const id = req.params.id;
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
}
