import { Request, Response, NextFunction } from 'express';
import { ServiceCatalogService } from './service.service.js';
import { sendSuccess } from '../../common/http/response.js';
import { BadRequestError } from '../../common/errors/app-error.js';

export class ServiceController {
  public static async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const activeOnly = req.query.activeOnly === 'true';
      const category = typeof req.query.category === 'string' ? req.query.category : undefined;
      const search = typeof req.query.search === 'string' ? req.query.search : undefined;

      const services = await ServiceCatalogService.listServices(organizationId, {
        activeOnly,
        category,
        search,
      });
      sendSuccess(res, services);
    } catch (err) {
      next(err);
    }
  }

  public static async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const id = req.params.id;
      if (!id) throw new BadRequestError('Service ID is required');

      const service = await ServiceCatalogService.getServiceById(organizationId, id);
      sendSuccess(res, service);
    } catch (err) {
      next(err);
    }
  }

  public static async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const {
        name,
        description,
        category,
        price,
        durationMinutes,
        bufferBefore,
        bufferAfter,
        isActive,
        requireDeposit,
        depositType,
        depositAmount,
        staffMemberIds,
      } = req.body;

      const created = await ServiceCatalogService.createService(organizationId, {
        name,
        description,
        category,
        price: Number(price),
        durationMinutes: durationMinutes !== undefined ? Number(durationMinutes) : undefined,
        bufferBefore: bufferBefore !== undefined ? Number(bufferBefore) : undefined,
        bufferAfter: bufferAfter !== undefined ? Number(bufferAfter) : undefined,
        isActive,
        requireDeposit: requireDeposit !== undefined ? Boolean(requireDeposit) : undefined,
        depositType,
        depositAmount:
          depositAmount !== undefined && depositAmount !== null ? Number(depositAmount) : null,
        staffMemberIds: Array.isArray(staffMemberIds) ? staffMemberIds : undefined,
      });

      sendSuccess(res, created, 201);
    } catch (err) {
      next(err);
    }
  }

  public static async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const id = req.params.id;
      if (!id) throw new BadRequestError('Service ID is required');

      const {
        name,
        description,
        category,
        price,
        durationMinutes,
        bufferBefore,
        bufferAfter,
        isActive,
        requireDeposit,
        depositType,
        depositAmount,
        staffMemberIds,
      } = req.body;

      const updated = await ServiceCatalogService.updateService(organizationId, id, {
        name,
        description,
        category,
        price: price !== undefined ? Number(price) : undefined,
        durationMinutes: durationMinutes !== undefined ? Number(durationMinutes) : undefined,
        bufferBefore: bufferBefore !== undefined ? Number(bufferBefore) : undefined,
        bufferAfter: bufferAfter !== undefined ? Number(bufferAfter) : undefined,
        isActive,
        requireDeposit: requireDeposit !== undefined ? Boolean(requireDeposit) : undefined,
        depositType,
        depositAmount:
          depositAmount !== undefined && depositAmount !== null ? Number(depositAmount) : undefined,
        staffMemberIds: Array.isArray(staffMemberIds) ? staffMemberIds : undefined,
      });

      sendSuccess(res, updated);
    } catch (err) {
      next(err);
    }
  }

  public static async syncStaff(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const id = req.params.id;
      if (!id) throw new BadRequestError('Service ID is required');

      const staffMemberIds = Array.isArray(req.body.staffMemberIds) ? req.body.staffMemberIds : [];
      const updated = await ServiceCatalogService.syncServiceStaff(
        organizationId,
        id,
        staffMemberIds,
      );
      sendSuccess(res, updated);
    } catch (err) {
      next(err);
    }
  }

  public static async delete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const id = req.params.id;
      if (!id) throw new BadRequestError('Service ID is required');

      const result = await ServiceCatalogService.deleteService(organizationId, id);
      sendSuccess(res, result);
    } catch (err) {
      next(err);
    }
  }

  public static async toggleActive(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const id = req.params.id;
      if (!id) throw new BadRequestError('Service ID is required');

      const updated = await ServiceCatalogService.toggleActive(organizationId, id);
      sendSuccess(res, updated);
    } catch (err) {
      next(err);
    }
  }
}
