import { Request, Response, NextFunction } from 'express';
import { ServiceCatalogService } from './service.service.js';
import { sendSuccess } from '../../common/http/response.js';
import { BadRequestError } from '../../common/errors/app-error.js';

export class ServiceController {
  public static async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const activeOnly = req.query.activeOnly === 'true';
      const services = await ServiceCatalogService.listServices(organizationId, activeOnly);
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
      const { name, description, price, durationMinutes, isActive } = req.body;

      const created = await ServiceCatalogService.createService(organizationId, {
        name,
        description,
        price: Number(price),
        durationMinutes: durationMinutes ? Number(durationMinutes) : undefined,
        isActive,
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

      const { name, description, price, durationMinutes, isActive } = req.body;

      const updated = await ServiceCatalogService.updateService(organizationId, id, {
        name,
        description,
        price: price !== undefined ? Number(price) : undefined,
        durationMinutes: durationMinutes !== undefined ? Number(durationMinutes) : undefined,
        isActive,
      });

      sendSuccess(res, updated);
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
