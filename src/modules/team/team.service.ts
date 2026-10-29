import crypto from 'node:crypto';
import { prisma } from '../../database/prisma.js';
import { NotFoundError, BadRequestError } from '../../common/errors/app-error.js';
import { Role } from '@prisma/client';
import { EmailService } from '../../common/email/email.service.js';
import { generateSessionToken, hashSessionToken, hashPassword } from '../auth/crypto.js';
import {
  TeamMemberItem,
  TeamInvitationItem,
  SendInvitationInput,
  VerifyInvitationResult,
  AcceptInvitationInput,
} from './team.types.js';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class TeamService {
  public static async listMembers(organizationId: string): Promise<TeamMemberItem[]> {
    const memberships = await prisma.membership.findMany({
      where: { organizationId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    const userIds = memberships.map((m) => m.userId);

    // Fetch corresponding staff member records if linked
    const linkedStaffMembers = await prisma.staffMember.findMany({
      where: {
        organizationId,
        userId: { in: userIds },
      },
      select: {
        id: true,
        userId: true,
        roleTitle: true,
        avatarBg: true,
        initials: true,
        status: true,
        shiftStart: true,
        shiftEnd: true,
      },
    });

    const staffMap = new Map<string, (typeof linkedStaffMembers)[number]>();
    for (const sm of linkedStaffMembers) {
      if (sm.userId) {
        staffMap.set(sm.userId, sm);
      }
    }

    return memberships.map((m) => {
      const staff = staffMap.get(m.userId);
      return {
        id: m.id,
        userId: m.userId,
        name: m.user.name,
        email: m.user.email,
        role: m.role,
        joinedAt: m.createdAt.toISOString(),
        staffProfile: staff
          ? {
              id: staff.id,
              roleTitle: staff.roleTitle,
              avatarBg: staff.avatarBg,
              initials: staff.initials,
              status: staff.status,
              shiftStart: staff.shiftStart,
              shiftEnd: staff.shiftEnd,
            }
          : null,
      };
    });
  }

  public static async listInvitations(organizationId: string): Promise<TeamInvitationItem[]> {
    const invitations = await prisma.organizationInvitation.findMany({
      where: {
        organizationId,
        status: 'PENDING',
        expiresAt: { gt: new Date() },
      },
      include: {
        inviter: { select: { name: true } },
        staffMember: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return invitations.map((inv) => ({
      id: inv.id,
      organizationId: inv.organizationId,
      email: inv.email,
      role: inv.role,
      status: inv.status,
      inviterName: inv.inviter.name,
      staffMemberId: inv.staffMemberId,
      staffMemberName: inv.staffMember?.name || null,
      expiresAt: inv.expiresAt.toISOString(),
      createdAt: inv.createdAt.toISOString(),
    }));
  }

  public static async sendInvitation(
    organizationId: string,
    inviterUserId: string,
    input: SendInvitationInput,
  ): Promise<TeamInvitationItem> {
    const email = input.email.trim().toLowerCase();

    if (!email || !EMAIL_REGEX.test(email)) {
      throw new BadRequestError('A valid recipient email address is required');
    }

    if (!input.role || !Object.values(Role).includes(input.role)) {
      throw new BadRequestError('Valid workspace role is required');
    }

    // 1. Check if user with this email is already an active member of this organization
    const existingUser = await prisma.user.findUnique({
      where: { email },
      include: {
        memberships: {
          where: { organizationId },
        },
      },
    });

    if (existingUser && existingUser.memberships.length > 0) {
      throw new BadRequestError(
        'A user with this email address is already an active member of this workspace',
      );
    }

    // 2. Fetch inviter and organization info for the email dispatch
    const [inviter, organization] = await Promise.all([
      prisma.user.findUnique({ where: { id: inviterUserId }, select: { name: true } }),
      prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true } }),
    ]);

    if (!inviter || !organization) {
      throw new NotFoundError('Inviter or Organization context could not be resolved');
    }

    // 3. Resolve optional staff member linkage
    let targetStaffMemberId = input.staffMemberId;
    if (!targetStaffMemberId) {
      const matchingStaff = await prisma.staffMember.findFirst({
        where: {
          organizationId,
          email: { equals: email, mode: 'insensitive' },
        },
        select: { id: true },
      });
      if (matchingStaff) {
        targetStaffMemberId = matchingStaff.id;
      }
    } else {
      // Validate that the specified staffMemberId belongs to this organization
      const validStaff = await prisma.staffMember.findFirst({
        where: { id: targetStaffMemberId, organizationId },
        select: { id: true },
      });
      if (!validStaff) {
        throw new BadRequestError('Selected staff specialist does not belong to this organization');
      }
    }

    // 4. Invalidate any existing pending invitations for this email in this org
    await prisma.organizationInvitation.updateMany({
      where: {
        organizationId,
        email,
        status: 'PENDING',
      },
      data: {
        status: 'REVOKED',
      },
    });

    // 5. Generate high-entropy 256-bit invitation token and SHA-256 hash
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const created = await prisma.organizationInvitation.create({
      data: {
        organizationId,
        email,
        role: input.role,
        tokenHash,
        inviterId: inviterUserId,
        staffMemberId: targetStaffMemberId ?? null,
        status: 'PENDING',
        expiresAt,
      },
      include: {
        inviter: { select: { name: true } },
        staffMember: { select: { name: true } },
      },
    });

    // 6. Dispatch invitation email
    const frontendBaseUrl =
      process.env.FRONTEND_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const acceptUrl = `${frontendBaseUrl}/invitation/accept?token=${rawToken}`;

    await EmailService.sendWorkspaceInvitation(
      email,
      inviter.name,
      organization.name,
      input.role,
      acceptUrl,
    );

    return {
      id: created.id,
      organizationId: created.organizationId,
      email: created.email,
      role: created.role,
      status: created.status,
      inviterName: created.inviter.name,
      staffMemberId: created.staffMemberId,
      staffMemberName: created.staffMember?.name || null,
      expiresAt: created.expiresAt.toISOString(),
      createdAt: created.createdAt.toISOString(),
      acceptUrl,
    };
  }

  public static async revokeInvitation(
    organizationId: string,
    invitationId: string,
  ): Promise<{ success: boolean }> {
    const existing = await prisma.organizationInvitation.findFirst({
      where: {
        id: invitationId,
        organizationId,
        status: 'PENDING',
      },
    });

    if (!existing) {
      throw new NotFoundError('Pending invitation was not found');
    }

    await prisma.organizationInvitation.update({
      where: { id: invitationId },
      data: { status: 'REVOKED' },
    });

    return { success: true };
  }

  public static async updateMemberRole(
    organizationId: string,
    _currentUserId: string,
    targetMembershipId: string,
    newRole: Role,
  ): Promise<TeamMemberItem> {
    const targetMembership = await prisma.membership.findFirst({
      where: {
        id: targetMembershipId,
        organizationId,
      },
      include: {
        user: true,
      },
    });

    if (!targetMembership) {
      throw new NotFoundError('Team membership not found in this organization');
    }

    // Safety: If demoting an OWNER, ensure at least one other OWNER exists
    if (targetMembership.role === Role.OWNER && newRole !== Role.OWNER) {
      const ownerCount = await prisma.membership.count({
        where: {
          organizationId,
          role: Role.OWNER,
        },
      });

      if (ownerCount <= 1) {
        throw new BadRequestError(
          'Cannot demote the only organization Owner. Promote another team member first.',
        );
      }
    }

    const updated = await prisma.membership.update({
      where: { id: targetMembershipId },
      data: { role: newRole },
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
    });

    const staffProfile = await prisma.staffMember.findFirst({
      where: { organizationId, userId: updated.userId },
      select: {
        id: true,
        roleTitle: true,
        avatarBg: true,
        initials: true,
        status: true,
        shiftStart: true,
        shiftEnd: true,
      },
    });

    return {
      id: updated.id,
      userId: updated.userId,
      name: updated.user.name,
      email: updated.user.email,
      role: updated.role,
      joinedAt: updated.createdAt.toISOString(),
      staffProfile: staffProfile
        ? {
            id: staffProfile.id,
            roleTitle: staffProfile.roleTitle,
            avatarBg: staffProfile.avatarBg,
            initials: staffProfile.initials,
            status: staffProfile.status,
            shiftStart: staffProfile.shiftStart,
            shiftEnd: staffProfile.shiftEnd,
          }
        : null,
    };
  }

  public static async removeMember(
    organizationId: string,
    currentUserId: string,
    targetMembershipId: string,
  ): Promise<{ success: boolean }> {
    const target = await prisma.membership.findFirst({
      where: {
        id: targetMembershipId,
        organizationId,
      },
    });

    if (!target) {
      throw new NotFoundError('Team membership not found in this organization');
    }

    if (target.userId === currentUserId) {
      throw new BadRequestError('You cannot remove yourself from the workspace.');
    }

    // Prevent removing the sole OWNER
    if (target.role === Role.OWNER) {
      const ownerCount = await prisma.membership.count({
        where: {
          organizationId,
          role: Role.OWNER,
        },
      });
      if (ownerCount <= 1) {
        throw new BadRequestError('Cannot remove the primary Owner from the workspace.');
      }
    }

    await prisma.$transaction(async (tx) => {
      // Unlink any associated staff member record
      await tx.staffMember.updateMany({
        where: { organizationId, userId: target.userId },
        data: { userId: null },
      });

      // Delete membership
      await tx.membership.delete({
        where: { id: targetMembershipId },
      });
    });

    return { success: true };
  }

  public static async verifyInvitationToken(token: string): Promise<VerifyInvitationResult> {
    if (!token || typeof token !== 'string') {
      throw new BadRequestError('Invitation token is required');
    }

    const tokenHash = crypto.createHash('sha256').update(token.trim()).digest('hex');

    const invitation = await prisma.organizationInvitation.findUnique({
      where: { tokenHash },
      include: {
        organization: { select: { name: true, slug: true } },
        inviter: { select: { name: true } },
      },
    });

    if (!invitation || invitation.status !== 'PENDING') {
      throw new NotFoundError('Invitation is invalid, revoked, or has already been accepted.');
    }

    if (new Date() > invitation.expiresAt) {
      throw new BadRequestError('This invitation link has expired. Please ask for a new invite.');
    }

    const existingUser = await prisma.user.findUnique({
      where: { email: invitation.email },
      select: { id: true },
    });

    return {
      valid: true,
      email: invitation.email,
      organizationName: invitation.organization.name,
      organizationSlug: invitation.organization.slug,
      inviterName: invitation.inviter.name,
      role: invitation.role,
      userExists: Boolean(existingUser),
    };
  }

  public static async acceptInvitation(input: AcceptInvitationInput): Promise<{
    rawToken: string;
    user: { id: string; email: string; name: string };
    activeOrganizationId: string;
    role: Role;
  }> {
    const { token } = input;
    if (!token || typeof token !== 'string') {
      throw new BadRequestError('Invitation token is required');
    }

    const tokenHash = crypto.createHash('sha256').update(token.trim()).digest('hex');

    const invitation = await prisma.organizationInvitation.findUnique({
      where: { tokenHash },
      include: {
        organization: true,
      },
    });

    if (!invitation || invitation.status !== 'PENDING') {
      throw new NotFoundError('Invitation is invalid or has already been accepted.');
    }

    if (new Date() > invitation.expiresAt) {
      throw new BadRequestError('This invitation link has expired. Please ask for a new invite.');
    }

    let user = await prisma.user.findUnique({
      where: { email: invitation.email },
    });

    // If new user, register them
    if (!user) {
      const { name, password } = input;
      if (!name || name.trim().length === 0) {
        throw new BadRequestError('Your full name is required to complete registration');
      }
      if (!password || password.length < 8) {
        throw new BadRequestError('A secure password of at least 8 characters is required');
      }

      const passwordHash = await hashPassword(password);

      user = await prisma.user.create({
        data: {
          email: invitation.email,
          name: name.trim(),
          passwordHash,
          status: 'ACTIVE',
          emailVerifiedAt: new Date(),
        },
      });
    }

    // Execute atomic transaction for membership creation and invitation state
    await prisma.$transaction(async (tx) => {
      // Create or update membership
      const existingMembership = await tx.membership.findUnique({
        where: {
          userId_organizationId: {
            userId: user.id,
            organizationId: invitation.organizationId,
          },
        },
      });

      if (!existingMembership) {
        await tx.membership.create({
          data: {
            userId: user.id,
            organizationId: invitation.organizationId,
            role: invitation.role,
          },
        });
      }

      // Link StaffMember record if applicable
      if (invitation.staffMemberId) {
        await tx.staffMember.updateMany({
          where: {
            id: invitation.staffMemberId,
            organizationId: invitation.organizationId,
          },
          data: {
            userId: user.id,
          },
        });
      } else {
        // Auto-link staff member matching the user email in this org
        await tx.staffMember.updateMany({
          where: {
            organizationId: invitation.organizationId,
            email: { equals: invitation.email, mode: 'insensitive' },
            userId: null,
          },
          data: {
            userId: user.id,
          },
        });
      }

      // Mark invitation accepted
      await tx.organizationInvitation.update({
        where: { id: invitation.id },
        data: { status: 'ACCEPTED' },
      });
    });

    // Create active authenticated session
    const rawToken = generateSessionToken();
    const sessionTokenHash = hashSessionToken(rawToken);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

    await prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: sessionTokenHash,
        expiresAt,
      },
    });

    return {
      rawToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
      activeOrganizationId: invitation.organizationId,
      role: invitation.role,
    };
  }
}
