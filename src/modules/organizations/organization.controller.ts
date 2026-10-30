import { Request, Response, NextFunction } from 'express';
import { OrganizationSettingsService } from './organization.service.js';
import { updateOrganizationSettingsSchema, checkSlugSchema } from './organization.types.js';
import { sendSuccess } from '../../common/http/response.js';
import { ForbiddenError } from '../../common/errors/app-error.js';
import { Role } from '@prisma/client';

export class OrganizationController {
  public static async getSettings(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const settings = await OrganizationSettingsService.getSettings(organizationId);
      sendSuccess(res, settings);
    } catch (err) {
      next(err);
    }
  }

  public static async updateSettings(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const userRole = req.tenant!.role;

      // Only OWNER and ADMIN are permitted to update organization settings
      if (userRole !== Role.OWNER && userRole !== Role.ADMIN) {
        throw new ForbiddenError(
          'Only workspace Owners and Admins can update organization settings',
        );
      }

      const validated = updateOrganizationSettingsSchema.parse(req.body);
      const updated = await OrganizationSettingsService.updateSettings(organizationId, validated);
      sendSuccess(res, updated);
    } catch (err) {
      next(err);
    }
  }

  public static async checkSlug(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const { slug } = checkSlugSchema.parse(req.body);
      const result = await OrganizationSettingsService.checkSlugAvailability(organizationId, slug);
      sendSuccess(res, result);
    } catch (err) {
      next(err);
    }
  }
}
