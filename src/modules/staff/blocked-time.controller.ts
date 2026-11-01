import { Request, Response, NextFunction } from 'express';
import { BlockedTimeService } from './blocked-time.service.js';
import {
  createBlockedTimeSchema,
  updateBlockedTimeSchema,
  listBlockedTimesQuerySchema,
  ActorContext,
} from './blocked-time.types.js';
import { BadRequestError, UnauthorizedError } from '../../common/errors/app-error.js';
import { sendSuccess } from '../../common/http/response.js';

export class BlockedTimeController {
  private static getActor(req: Request): ActorContext {
    if (!req.user || !req.user.id) {
      throw new UnauthorizedError('User authentication required');
    }
    return {
      id: req.user.id,
      name: req.user.name || 'User',
      email: req.user.email,
      role: req.tenant?.role || 'MEMBER',
      ip: req.ip || null,
    };
  }

  public static async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant?.organizationId;
      if (!organizationId) {
        throw new BadRequestError('Organization context required');
      }

      const parsedQuery = listBlockedTimesQuerySchema.parse(req.query);
      const data = await BlockedTimeService.list(organizationId, parsedQuery);

      sendSuccess(res, data);
    } catch (err) {
      next(err);
    }
  }

  public static async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant?.organizationId;
      if (!organizationId) {
        throw new BadRequestError('Organization context required');
      }

      const actor = BlockedTimeController.getActor(req);
      const input = createBlockedTimeSchema.parse(req.body);
      const data = await BlockedTimeService.create(organizationId, actor, input);

      sendSuccess(res, data, 201);
    } catch (err) {
      next(err);
    }
  }

  public static async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant?.organizationId;
      const { id } = req.params;

      if (!organizationId) {
        throw new BadRequestError('Organization context required');
      }
      if (!id) {
        throw new BadRequestError('Blocked time ID is required');
      }

      const actor = BlockedTimeController.getActor(req);
      const input = updateBlockedTimeSchema.parse(req.body);
      const data = await BlockedTimeService.update(organizationId, id, actor, input);

      sendSuccess(res, data);
    } catch (err) {
      next(err);
    }
  }

  public static async delete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant?.organizationId;
      const { id } = req.params;

      if (!organizationId) {
        throw new BadRequestError('Organization context required');
      }
      if (!id) {
        throw new BadRequestError('Blocked time ID is required');
      }

      const actor = BlockedTimeController.getActor(req);
      const data = await BlockedTimeService.delete(organizationId, id, actor);

      sendSuccess(res, data);
    } catch (err) {
      next(err);
    }
  }
}
