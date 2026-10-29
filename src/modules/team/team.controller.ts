import { Request, Response, NextFunction } from 'express';
import { TeamService } from './team.service.js';
import { sendSuccess } from '../../common/http/response.js';
import { BadRequestError } from '../../common/errors/app-error.js';
import { getSessionCookieOptions } from '../../config/security.js';

export class TeamController {
  public static async listMembers(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const members = await TeamService.listMembers(organizationId);
      sendSuccess(res, members);
    } catch (err) {
      next(err);
    }
  }

  public static async listInvitations(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const invitations = await TeamService.listInvitations(organizationId);
      sendSuccess(res, invitations);
    } catch (err) {
      next(err);
    }
  }

  public static async sendInvitation(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const inviterUserId = req.user!.id;
      const { email, role, staffMemberId } = req.body;

      const invitation = await TeamService.sendInvitation(organizationId, inviterUserId, {
        email,
        role,
        staffMemberId,
      });

      sendSuccess(res, invitation, 201, 'Workspace invitation sent successfully');
    } catch (err) {
      next(err);
    }
  }

  public static async revokeInvitation(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const { id } = req.params;

      if (!id) throw new BadRequestError('Invitation ID is required');

      const result = await TeamService.revokeInvitation(organizationId, id);
      sendSuccess(res, result, 200, 'Invitation revoked');
    } catch (err) {
      next(err);
    }
  }

  public static async updateMemberRole(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const currentUserId = req.user!.id;
      const { id } = req.params;
      const { role } = req.body;

      if (!id) throw new BadRequestError('Membership ID is required');
      if (!role) throw new BadRequestError('Target role is required');

      const updated = await TeamService.updateMemberRole(organizationId, currentUserId, id, role);

      sendSuccess(res, updated, 200, 'Team member role updated');
    } catch (err) {
      next(err);
    }
  }

  public static async removeMember(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const currentUserId = req.user!.id;
      const { id } = req.params;

      if (!id) throw new BadRequestError('Membership ID is required');

      const result = await TeamService.removeMember(organizationId, currentUserId, id);
      sendSuccess(res, result, 200, 'Member removed from workspace');
    } catch (err) {
      next(err);
    }
  }

  public static async verifyInvitation(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { token } = req.params;
      if (!token) throw new BadRequestError('Token parameter is required');

      const verification = await TeamService.verifyInvitationToken(token);
      sendSuccess(res, verification);
    } catch (err) {
      next(err);
    }
  }

  public static async acceptInvitation(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { token, name, password } = req.body;
      if (!token) throw new BadRequestError('Invitation token is required');

      const result = await TeamService.acceptInvitation({ token, name, password });

      res.cookie('flowpilot_session', result.rawToken, getSessionCookieOptions());

      sendSuccess(
        res,
        {
          user: result.user,
          activeOrganizationId: result.activeOrganizationId,
          role: result.role,
        },
        200,
        'Welcome to the workspace! Invitation accepted successfully.',
      );
    } catch (err) {
      next(err);
    }
  }
}
