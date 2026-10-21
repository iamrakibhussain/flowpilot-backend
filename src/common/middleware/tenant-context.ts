import { Request, Response, NextFunction } from 'express';
import { BadRequestError, UnauthorizedError, ForbiddenError } from '../errors/app-error.js';
import { UserRole } from '../types/index.js';
import { prisma } from '../../database/prisma.js';
import { logger } from '../logging/logger.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface TenantContextOptions {
  requireMembershipVerification?: boolean;
  allowedRoles?: UserRole[];
}

/**
 * TenantContextMiddleware extracts and securely validates organization context.
 * Non-negotiable security rule: NEVER trust client-supplied organization ID as proof of access.
 * Every tenant-scoped operation must verify user membership on the server.
 * Defaults to requireMembershipVerification: true (secure-by-default).
 */
export function tenantContextMiddleware(options: TenantContextOptions = {}) {
  const requireVerification = options.requireMembershipVerification ?? true;

  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const orgIdHeader = req.headers['x-organization-id'];

    if (!orgIdHeader) {
      return next(new BadRequestError('Missing required X-Organization-Id header'));
    }

    if (typeof orgIdHeader !== 'string' || !UUID_REGEX.test(orgIdHeader.trim())) {
      return next(
        new BadRequestError('Invalid X-Organization-Id header format. Must be a valid UUID'),
      );
    }

    const organizationId = orgIdHeader.trim();

    // If endpoint requires server-side membership authorization (enabled by default):
    if (requireVerification) {
      if (!req.user || !req.user.id) {
        return next(new UnauthorizedError('Authentication required for tenant-scoped operations'));
      }

      // 1. Check user memberships attached to session if available
      const matchingMembership = req.user.memberships?.find(
        (m) => m.organizationId === organizationId,
      );
      let role = matchingMembership?.role;
      let orgStatus = matchingMembership?.status;

      // 2. Query database if membership was not pre-hydrated
      if (!role) {
        try {
          const membership = await prisma.membership.findUnique({
            where: {
              userId_organizationId: {
                userId: req.user.id,
                organizationId,
              },
            },
            include: {
              organization: true,
            },
          });
          if (membership) {
            role = membership.role as UserRole;
            orgStatus = membership.organization.status;
          }
        } catch (dbErr) {
          logger.error(
            { err: dbErr, organizationId, userId: req.user.id },
            'Database error during tenant membership verification',
          );
          return next(new ForbiddenError('Failed to verify organization membership'));
        }
      }

      // If user has no active membership in the target organization
      if (!role) {
        return next(new ForbiddenError('You do not have access to this organization'));
      }

      // 3. Verify organization is ACTIVE (reject SUSPENDED or ARCHIVED organizations)
      if (orgStatus && orgStatus !== 'ACTIVE') {
        return next(new ForbiddenError('This organization is suspended or archived'));
      }

      // 3. Verify granular role permissions if specified
      if (options.allowedRoles && options.allowedRoles.length > 0) {
        if (!options.allowedRoles.includes(role)) {
          return next(
            new ForbiddenError('Insufficient organization permissions for this operation'),
          );
        }
      }

      req.tenant = {
        organizationId,
        role,
      };

      return next();
    }

    req.tenant = {
      organizationId,
      role: undefined,
    };

    next();
  };
}
