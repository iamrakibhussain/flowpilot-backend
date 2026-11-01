import { prisma } from '../../database/prisma.js';
import {
  CreateBlockedTimeInput,
  UpdateBlockedTimeInput,
  ListBlockedTimesQuery,
  BlockedTimeDto,
  ActorContext,
} from './blocked-time.types.js';
import { NotFoundError, ForbiddenError, BadRequestError } from '../../common/errors/app-error.js';
import { logger } from '../../common/logging/logger.js';

export class BlockedTimeService {
  /**
   * Helper: Records an immutable audit log entry for blocked time operations.
   */
  private static async recordAuditLog(
    organizationId: string,
    actor: ActorContext,
    action: string,
    details: string,
  ): Promise<void> {
    try {
      await prisma.workspaceAuditLog.create({
        data: {
          organizationId,
          userId: actor.id,
          userName: actor.name || actor.email,
          action,
          category: 'AVAILABILITY',
          details,
          ipAddress: actor.ip || null,
        },
      });
    } catch (err) {
      logger.error({ err, organizationId, action }, 'Failed to record audit log for blocked time');
    }
  }

  /**
   * List blocked times for an organization with optional date range and staff filters.
   */
  public static async list(
    organizationId: string,
    query: ListBlockedTimesQuery,
  ): Promise<BlockedTimeDto[]> {
    const whereClause: Record<string, unknown> = {
      organizationId,
    };

    if (query.staffMemberId) {
      // Include both the specific staff member's blocks AND organization-wide holidays
      whereClause.OR = [{ staffMemberId: query.staffMemberId }, { staffMemberId: null }];
    }

    if (query.startDate || query.endDate) {
      whereClause.AND = [];
      if (query.startDate) {
        (whereClause.AND as Array<unknown>).push({
          endTime: { gte: new Date(query.startDate) },
        });
      }
      if (query.endDate) {
        (whereClause.AND as Array<unknown>).push({
          startTime: { lte: new Date(query.endDate) },
        });
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const records = await (prisma as any).blockedTime.findMany({
      where: whereClause,
      include: {
        staffMember: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: {
        startTime: 'asc',
      },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return records.map((record: any) => ({
      id: record.id,
      organizationId: record.organizationId,
      staffMemberId: record.staffMemberId,
      staffName: record.staffMember?.name || null,
      title: record.title,
      type: record.type,
      startTime: record.startTime.toISOString(),
      endTime: record.endTime.toISOString(),
      allDay: record.allDay,
      notes: record.notes,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    }));
  }

  /**
   * Create a new blocked interval or organization holiday with strict role & IDOR defense.
   */
  public static async create(
    organizationId: string,
    actor: ActorContext,
    input: CreateBlockedTimeInput,
  ): Promise<BlockedTimeDto> {
    // 1. Role enforcement: BILLING role is strictly forbidden from modifying scheduling availability
    if (actor.role === 'BILLING') {
      throw new ForbiddenError('Billing personnel cannot modify scheduling availability');
    }

    const isCompanyHoliday = !input.staffMemberId || input.type === 'COMPANY_HOLIDAY';

    // 2. Organization-wide holiday authorization: Only OWNER or ADMIN
    if (isCompanyHoliday) {
      if (actor.role !== 'OWNER' && actor.role !== 'ADMIN') {
        throw new ForbiddenError(
          'Only organization Owners or Admins can declare company-wide holidays or office closures',
        );
      }
    }

    // 3. Specialist-specific time-off: If caller is MEMBER, verify IDOR boundary
    let targetStaffMemberId: string | null = null;
    let targetStaffName: string | null = null;

    if (!isCompanyHoliday && input.staffMemberId) {
      const staff = await prisma.staffMember.findFirst({
        where: {
          id: input.staffMemberId,
          organizationId,
        },
        select: { id: true, name: true, userId: true },
      });

      if (!staff) {
        throw new NotFoundError(
          `Staff member with ID '${input.staffMemberId}' not found in this organization`,
        );
      }

      // IDOR Defense: If actor is a MEMBER, they can ONLY block time for their own linked staff account
      if (actor.role === 'MEMBER' && staff.userId !== actor.id) {
        throw new ForbiddenError(
          'Team members are only authorized to block time for their own schedule',
        );
      }

      targetStaffMemberId = staff.id;
      targetStaffName = staff.name;
    }

    const startTime = new Date(input.startTime);
    const endTime = new Date(input.endTime);

    if (endTime <= startTime) {
      throw new BadRequestError('End time must be after start time');
    }

    // 4. Pre-flight check: Detect if any appointments already overlap with this blocked window
    const affectedAppointments = await prisma.appointment.count({
      where: {
        organizationId,
        status: { in: ['CONFIRMED', 'PENDING'] },
        scheduledAt: { lt: endTime },
        createdAt: { lte: new Date() },
        AND: [
          {
            OR: [
              ...(targetStaffMemberId ? [{ staffMemberId: targetStaffMemberId }] : []),
              ...(!targetStaffMemberId
                ? [{ staffMemberId: null }, { staffMemberId: { not: null } }]
                : []),
            ],
          },
        ],
      },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const created = await (prisma as any).blockedTime.create({
      data: {
        organizationId,
        staffMemberId: targetStaffMemberId,
        title: input.title,
        type: input.type,
        startTime,
        endTime,
        allDay: input.allDay,
        notes: input.notes || null,
      },
      include: {
        staffMember: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    // 5. Immutable audit logging
    const targetDesc = targetStaffName
      ? `for specialist "${targetStaffName}"`
      : 'workspace-wide (Office Closure)';
    await this.recordAuditLog(
      organizationId,
      actor,
      'BLOCKED_TIME_CREATED',
      `Created ${input.type} block "${input.title}" ${targetDesc} from ${startTime.toISOString()} to ${endTime.toISOString()}${
        affectedAppointments > 0
          ? ` (Note: ${affectedAppointments} existing appointments overlap)`
          : ''
      }`,
    );

    return {
      id: created.id,
      organizationId: created.organizationId,
      staffMemberId: created.staffMemberId,
      staffName: created.staffMember?.name || targetStaffName,
      title: created.title,
      type: created.type,
      startTime: created.startTime.toISOString(),
      endTime: created.endTime.toISOString(),
      allDay: created.allDay,
      notes: created.notes,
      affectedAppointmentsCount: affectedAppointments,
      createdAt: created.createdAt.toISOString(),
      updatedAt: created.updatedAt.toISOString(),
    };
  }

  /**
   * Update an existing blocked time entry with IDOR protection.
   */
  public static async update(
    organizationId: string,
    id: string,
    actor: ActorContext,
    input: UpdateBlockedTimeInput,
  ): Promise<BlockedTimeDto> {
    if (actor.role === 'BILLING') {
      throw new ForbiddenError('Billing personnel cannot modify scheduling availability');
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const existing = await (prisma as any).blockedTime.findFirst({
      where: {
        id,
        organizationId,
      },
      include: {
        staffMember: {
          select: {
            id: true,
            userId: true,
            name: true,
          },
        },
      },
    });

    if (!existing) {
      throw new NotFoundError('Blocked time entry not found');
    }

    // Authorization Guard:
    // If company-wide holiday or being converted to one, require OWNER or ADMIN
    const isCompanyHoliday =
      !existing.staffMemberId || input.type === 'COMPANY_HOLIDAY' || input.staffMemberId === null;
    if (isCompanyHoliday && actor.role !== 'OWNER' && actor.role !== 'ADMIN') {
      throw new ForbiddenError('Only organization Owners or Admins can modify company-wide blocks');
    }

    // IDOR Guard: If caller is MEMBER, ensure they own the existing staff record AND target staff record
    if (actor.role === 'MEMBER') {
      if (existing.staffMember?.userId !== actor.id) {
        throw new ForbiddenError(
          'You do not have permission to modify another team member’s blocked time',
        );
      }
      if (input.staffMemberId && input.staffMemberId !== existing.staffMemberId) {
        throw new ForbiddenError('Members cannot reassign blocked time to other staff');
      }
    }

    if (input.staffMemberId) {
      const staff = await prisma.staffMember.findFirst({
        where: {
          id: input.staffMemberId,
          organizationId,
        },
      });
      if (!staff) {
        throw new NotFoundError('Target staff member not found in this organization');
      }
    }

    const startTime = input.startTime ? new Date(input.startTime) : existing.startTime;
    const endTime = input.endTime ? new Date(input.endTime) : existing.endTime;

    if (endTime <= startTime) {
      throw new BadRequestError('End time must be after start time');
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updated = await (prisma as any).blockedTime.update({
      where: { id },
      data: {
        staffMemberId:
          input.staffMemberId !== undefined ? input.staffMemberId : existing.staffMemberId,
        title: input.title !== undefined ? input.title : existing.title,
        type: input.type !== undefined ? input.type : existing.type,
        startTime,
        endTime,
        allDay: input.allDay !== undefined ? input.allDay : existing.allDay,
        notes: input.notes !== undefined ? input.notes : existing.notes,
      },
      include: {
        staffMember: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    await this.recordAuditLog(
      organizationId,
      actor,
      'BLOCKED_TIME_UPDATED',
      `Updated blocked time "${updated.title}" (${updated.type})`,
    );

    return {
      id: updated.id,
      organizationId: updated.organizationId,
      staffMemberId: updated.staffMemberId,
      staffName: updated.staffMember?.name || null,
      title: updated.title,
      type: updated.type,
      startTime: updated.startTime.toISOString(),
      endTime: updated.endTime.toISOString(),
      allDay: updated.allDay,
      notes: updated.notes,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    };
  }

  /**
   * Delete a blocked time entry with IDOR defense and audit logging.
   */
  public static async delete(
    organizationId: string,
    id: string,
    actor: ActorContext,
  ): Promise<{ success: boolean; id: string }> {
    if (actor.role === 'BILLING') {
      throw new ForbiddenError('Billing personnel cannot modify scheduling availability');
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const existing = await (prisma as any).blockedTime.findFirst({
      where: {
        id,
        organizationId,
      },
      include: {
        staffMember: {
          select: {
            id: true,
            userId: true,
            name: true,
          },
        },
      },
    });

    if (!existing) {
      throw new NotFoundError('Blocked time entry not found');
    }

    // Role Guard: Company-wide holiday removal requires OWNER or ADMIN
    if (!existing.staffMemberId && actor.role !== 'OWNER' && actor.role !== 'ADMIN') {
      throw new ForbiddenError(
        'Only organization Owners or Admins can remove company-wide holidays',
      );
    }

    // IDOR Guard: Member can only delete their own time-off
    if (actor.role === 'MEMBER' && existing.staffMember?.userId !== actor.id) {
      throw new ForbiddenError(
        'You do not have permission to delete another team member’s blocked time',
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (prisma as any).blockedTime.delete({
      where: { id },
    });

    await this.recordAuditLog(
      organizationId,
      actor,
      'BLOCKED_TIME_DELETED',
      `Deleted blocked time entry "${existing.title}" (${existing.type})`,
    );

    return { success: true, id };
  }
}
