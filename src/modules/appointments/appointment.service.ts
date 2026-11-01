import {
  AppointmentStatus,
  AppointmentType,
  Prisma,
  Appointment,
  Customer,
  Service,
  StaffMember,
} from '@prisma/client';
import { prisma } from '../../database/prisma.js';
import { NotFoundError, BadRequestError } from '../../common/errors/app-error.js';
import {
  AppointmentListItem,
  ListAppointmentsQuery,
  CreateAppointmentInput,
  UpdateAppointmentInput,
  RescheduleAppointmentInput,
  CheckConflictInput,
  ConflictCheckResult,
} from './appointment.types.js';

type AppointmentWithRelations = Appointment & {
  customer?: Customer | null;
  service?: Service | null;
  staffMember?: StaffMember | null;
};

export class AppointmentService {
  /**
   * Helper to format Prisma appointment model to normalized AppointmentListItem
   */
  private static formatAppointment(apt: AppointmentWithRelations): AppointmentListItem {
    return {
      id: apt.id,
      organizationId: apt.organizationId,
      customerId: apt.customerId,
      customerName: apt.customer?.name ?? 'Unknown Client',
      customerEmail: apt.customer?.email ?? '',
      customerPhone: apt.customer?.phone ?? null,
      serviceId: apt.serviceId ?? null,
      serviceName: apt.service?.name ?? null,
      servicePrice: apt.service?.price ? Number(apt.service.price) : null,
      staffMemberId: apt.staffMemberId ?? null,
      staffMemberName: apt.staffMember?.name ?? null,
      staffMemberRole: apt.staffMember?.roleTitle ?? null,
      staffAvatarBg: apt.staffMember?.avatarBg ?? null,
      staffInitials: apt.staffMember?.initials ?? null,
      title: apt.title,
      scheduledAt: apt.scheduledAt.toISOString(),
      durationMinutes: apt.durationMinutes,
      status: apt.status,
      type: apt.type,
      location: apt.location ?? null,
      notes: apt.notes ?? null,
      createdAt: apt.createdAt.toISOString(),
      updatedAt: apt.updatedAt.toISOString(),
    };
  }

  /**
   * List appointments with optional date range, staff, customer, and status filtering
   */
  public static async listAppointments(
    organizationId: string,
    query: ListAppointmentsQuery = {},
  ): Promise<AppointmentListItem[]> {
    const where: Prisma.AppointmentWhereInput = {
      organizationId,
    };

    if (query.customerId) {
      where.customerId = query.customerId;
    }

    if (query.staffMemberId) {
      where.staffMemberId = query.staffMemberId;
    }

    if (query.serviceId) {
      where.serviceId = query.serviceId;
    }

    if (query.status) {
      where.status = query.status;
    }

    if (query.type) {
      where.type = query.type;
    }

    // Date range filter
    if (query.startDate || query.endDate) {
      where.scheduledAt = {};
      if (query.startDate) {
        where.scheduledAt.gte = new Date(query.startDate);
      }
      if (query.endDate) {
        where.scheduledAt.lte = new Date(query.endDate);
      }
    }

    // Text search in title or client name
    if (query.search && query.search.trim().length > 0) {
      const searchTerm = query.search.trim();
      where.OR = [
        { title: { contains: searchTerm, mode: 'insensitive' } },
        { customer: { name: { contains: searchTerm, mode: 'insensitive' } } },
        { customer: { email: { contains: searchTerm, mode: 'insensitive' } } },
      ];
    }

    const appointments = await prisma.appointment.findMany({
      where,
      orderBy: { scheduledAt: 'asc' },
      include: {
        customer: true,
        service: true,
        staffMember: true,
      },
    });

    return appointments.map(this.formatAppointment);
  }

  /**
   * Get single appointment by ID
   */
  public static async getAppointmentById(
    organizationId: string,
    id: string,
  ): Promise<AppointmentListItem> {
    const apt = await prisma.appointment.findFirst({
      where: { id, organizationId },
      include: {
        customer: true,
        service: true,
        staffMember: true,
      },
    });

    if (!apt) {
      throw new NotFoundError('Appointment not found');
    }

    return this.formatAppointment(apt);
  }

  /**
   * Detect scheduling conflicts for a given staff member and time slot
   */
  public static async checkConflict(
    organizationId: string,
    input: CheckConflictInput,
  ): Promise<ConflictCheckResult> {
    if (!input.staffMemberId) {
      return { hasConflict: false };
    }

    const requestedStart = new Date(input.scheduledAt);
    const requestedEnd = new Date(requestedStart.getTime() + input.durationMinutes * 60 * 1000);

    // Query active appointments for this staff member within +/- 24 hours
    const bufferStart = new Date(requestedStart.getTime() - 24 * 60 * 60 * 1000);
    const bufferEnd = new Date(requestedEnd.getTime() + 24 * 60 * 60 * 1000);

    const candidates = await prisma.appointment.findMany({
      where: {
        organizationId,
        staffMemberId: input.staffMemberId,
        status: { in: [AppointmentStatus.CONFIRMED, AppointmentStatus.PENDING] },
        scheduledAt: { gte: bufferStart, lte: bufferEnd },
        ...(input.excludeAppointmentId ? { id: { not: input.excludeAppointmentId } } : {}),
      },
      include: {
        staffMember: true,
      },
    });

    for (const cand of candidates) {
      const candStart = cand.scheduledAt;
      const candEnd = new Date(candStart.getTime() + cand.durationMinutes * 60 * 1000);

      // Overlap condition: startA < endB && endA > startB
      if (candStart < requestedEnd && candEnd > requestedStart) {
        return {
          hasConflict: true,
          conflictingAppointment: {
            id: cand.id,
            title: cand.title,
            scheduledAt: cand.scheduledAt.toISOString(),
            durationMinutes: cand.durationMinutes,
            staffMemberName: cand.staffMember?.name,
          },
        };
      }
    }

    // Check for blocked times and company holidays
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const blockedCandidates = await (prisma as any).blockedTime.findMany({
      where: {
        organizationId,
        startTime: { lt: requestedEnd },
        endTime: { gt: requestedStart },
        OR: [{ staffMemberId: null }, { staffMemberId: input.staffMemberId }],
      },
      include: {
        staffMember: { select: { name: true } },
      },
    });

    if (blockedCandidates.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const block = blockedCandidates[0] as any;
      const isCompanyHoliday = !block.staffMemberId;
      return {
        hasConflict: true,
        conflictingAppointment: {
          id: block.id,
          title: `[${isCompanyHoliday ? 'Holiday' : 'Blocked'}: ${block.title}]`,
          scheduledAt: block.startTime.toISOString(),
          durationMinutes: Math.max(
            15,
            Math.round((block.endTime.getTime() - block.startTime.getTime()) / 60000),
          ),
          staffMemberName: isCompanyHoliday
            ? 'Company Holiday / Office Closed'
            : block.staffMember?.name || 'Staff Leave',
        },
      };
    }

    return { hasConflict: false };
  }

  /**
   * Create a new appointment with multi-tenant isolation & atomic conflict check
   */
  public static async createAppointment(
    organizationId: string,
    input: CreateAppointmentInput,
  ): Promise<AppointmentListItem> {
    // 1. Verify customer
    const customer = await prisma.customer.findFirst({
      where: { id: input.customerId, organizationId },
    });
    if (!customer) {
      throw new NotFoundError('Selected client does not exist in this organization');
    }
    if (customer.status === 'INACTIVE') {
      throw new BadRequestError(
        'Cannot schedule an appointment for an archived or inactive client. Please reactivate them first.',
      );
    }

    // 2. Verify staff member if specified
    let staffMember = null;
    if (input.staffMemberId) {
      staffMember = await prisma.staffMember.findFirst({
        where: { id: input.staffMemberId, organizationId },
      });
      if (!staffMember) {
        throw new NotFoundError('Selected staff member was not found');
      }
    }

    // 3. Verify service if specified
    let service = null;
    if (input.serviceId) {
      service = await prisma.service.findFirst({
        where: { id: input.serviceId, organizationId },
      });
      if (!service) {
        throw new NotFoundError('Selected service was not found');
      }
    }

    const scheduledDate = new Date(input.scheduledAt);
    const duration = input.durationMinutes ?? service?.durationMinutes ?? 60;

    // 4. Run conflict prevention check if staff member is assigned
    if (input.staffMemberId) {
      const conflict = await this.checkConflict(organizationId, {
        staffMemberId: input.staffMemberId,
        scheduledAt: scheduledDate,
        durationMinutes: duration,
      });

      if (conflict.hasConflict && conflict.conflictingAppointment) {
        throw new BadRequestError(
          `Schedule Conflict: ${conflict.conflictingAppointment.staffMemberName ?? 'Staff member'} is already booked for "${conflict.conflictingAppointment.title}" at this time.`,
        );
      }
    }

    // 5. Generate descriptive title if not provided
    const title =
      input.title && input.title.trim().length > 0
        ? input.title.trim()
        : service
          ? `${service.name} with ${customer.name}`
          : `Session with ${customer.name}`;

    const created = await prisma.appointment.create({
      data: {
        organizationId,
        customerId: customer.id,
        serviceId: service?.id ?? null,
        staffMemberId: staffMember?.id ?? null,
        title,
        scheduledAt: scheduledDate,
        durationMinutes: duration,
        status: input.status ?? AppointmentStatus.CONFIRMED,
        type: input.type ?? AppointmentType.VIDEO,
        location:
          input.location ?? (input.type === 'IN_PERSON' ? 'Headquarters Studio' : 'Virtual Bridge'),
        notes: input.notes ?? null,
      },
      include: {
        customer: true,
        service: true,
        staffMember: true,
      },
    });

    return this.formatAppointment(created);
  }

  /**
   * Update appointment details
   */
  public static async updateAppointment(
    organizationId: string,
    id: string,
    input: UpdateAppointmentInput,
  ): Promise<AppointmentListItem> {
    const existing = await prisma.appointment.findFirst({
      where: { id, organizationId },
    });
    if (!existing) {
      throw new NotFoundError('Appointment not found');
    }

    const scheduledDate = input.scheduledAt ? new Date(input.scheduledAt) : existing.scheduledAt;
    const duration = input.durationMinutes ?? existing.durationMinutes;
    const targetStaffId =
      input.staffMemberId !== undefined ? input.staffMemberId : existing.staffMemberId;

    // Multi-tenant security guard: Verify foreign relations belong to tenant
    if (input.staffMemberId) {
      const staffMember = await prisma.staffMember.findFirst({
        where: { id: input.staffMemberId, organizationId },
      });
      if (!staffMember) {
        throw new NotFoundError('Selected staff member was not found in this organization');
      }
    }

    if (input.serviceId) {
      const service = await prisma.service.findFirst({
        where: { id: input.serviceId, organizationId },
      });
      if (!service) {
        throw new NotFoundError('Selected service was not found in this organization');
      }
    }

    // Check conflict if time or staff changed
    if (targetStaffId) {
      const conflict = await this.checkConflict(organizationId, {
        staffMemberId: targetStaffId,
        scheduledAt: scheduledDate,
        durationMinutes: duration,
        excludeAppointmentId: id,
      });

      if (conflict.hasConflict && conflict.conflictingAppointment) {
        throw new BadRequestError(
          `Schedule Conflict: ${conflict.conflictingAppointment.staffMemberName ?? 'Staff member'} is already booked for "${conflict.conflictingAppointment.title}" at this time.`,
        );
      }
    }

    const updated = await prisma.appointment.update({
      where: { id },
      data: {
        title: input.title !== undefined ? input.title : undefined,
        scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : undefined,
        durationMinutes: input.durationMinutes !== undefined ? input.durationMinutes : undefined,
        type: input.type !== undefined ? input.type : undefined,
        location: input.location !== undefined ? input.location : undefined,
        notes: input.notes !== undefined ? input.notes : undefined,
        serviceId: input.serviceId !== undefined ? input.serviceId : undefined,
        staffMemberId: input.staffMemberId !== undefined ? input.staffMemberId : undefined,
      },
      include: {
        customer: true,
        service: true,
        staffMember: true,
      },
    });

    return this.formatAppointment(updated);
  }

  /**
   * Reschedule appointment with conflict check
   */
  public static async rescheduleAppointment(
    organizationId: string,
    id: string,
    input: RescheduleAppointmentInput,
  ): Promise<AppointmentListItem> {
    const existing = await prisma.appointment.findFirst({
      where: { id, organizationId },
    });
    if (!existing) {
      throw new NotFoundError('Appointment not found');
    }

    if (input.newStaffMemberId) {
      const staffMember = await prisma.staffMember.findFirst({
        where: { id: input.newStaffMemberId, organizationId },
      });
      if (!staffMember) {
        throw new NotFoundError('Selected staff member was not found in this organization');
      }
    }

    const targetStaffId = input.newStaffMemberId ?? existing.staffMemberId;
    const newScheduledDate = new Date(input.newScheduledAt);
    const duration = input.newDurationMinutes ?? existing.durationMinutes;

    if (targetStaffId) {
      const conflict = await this.checkConflict(organizationId, {
        staffMemberId: targetStaffId,
        scheduledAt: newScheduledDate,
        durationMinutes: duration,
        excludeAppointmentId: id,
      });

      if (conflict.hasConflict && conflict.conflictingAppointment) {
        throw new BadRequestError(
          `Schedule Conflict: ${conflict.conflictingAppointment.staffMemberName ?? 'Staff member'} is already booked for "${conflict.conflictingAppointment.title}" during this slot.`,
        );
      }
    }

    const updatedNotes = input.reason
      ? existing.notes
        ? `${existing.notes}\n[Rescheduled: ${new Date().toLocaleDateString()}] Reason: ${input.reason}`
        : `[Rescheduled: ${new Date().toLocaleDateString()}] Reason: ${input.reason}`
      : existing.notes;

    const updated = await prisma.appointment.update({
      where: { id },
      data: {
        scheduledAt: newScheduledDate,
        durationMinutes: duration,
        staffMemberId: targetStaffId,
        notes: updatedNotes,
        status: AppointmentStatus.CONFIRMED,
      },
      include: {
        customer: true,
        service: true,
        staffMember: true,
      },
    });

    return this.formatAppointment(updated);
  }

  /**
   * Transition appointment lifecycle status
   */
  public static async updateStatus(
    organizationId: string,
    id: string,
    status: AppointmentStatus,
    notes?: string,
  ): Promise<AppointmentListItem> {
    const existing = await prisma.appointment.findFirst({
      where: { id, organizationId },
    });
    if (!existing) {
      throw new NotFoundError('Appointment not found');
    }

    let finalNotes = existing.notes;
    if (notes && notes.trim().length > 0) {
      finalNotes = existing.notes
        ? `${existing.notes}\n[Status changed to ${status}: ${new Date().toLocaleDateString()}] ${notes}`
        : `[Status changed to ${status}: ${new Date().toLocaleDateString()}] ${notes}`;
    }

    const updated = await prisma.appointment.update({
      where: { id },
      data: {
        status,
        notes: finalNotes,
      },
      include: {
        customer: true,
        service: true,
        staffMember: true,
      },
    });

    return this.formatAppointment(updated);
  }

  /**
   * Cancel or archive appointment
   */
  public static async cancelAppointment(
    organizationId: string,
    id: string,
    reason?: string,
  ): Promise<AppointmentListItem> {
    return this.updateStatus(organizationId, id, AppointmentStatus.CANCELLED, reason);
  }
}
