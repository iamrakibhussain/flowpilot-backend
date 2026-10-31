import { prisma } from '../../database/prisma.js';
import { NotFoundError, BadRequestError } from '../../common/errors/app-error.js';
import { EmailService } from '../../common/email/email.service.js';
import { NotificationService } from '../notifications/notification.service.js';
import {
  PublicBookingInput,
  PublicBookingResult,
  PublicOrganizationProfile,
  TimeSlot,
} from './public-booking.types.js';

const DAY_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'] as const;

function timeStringToMinutes(timeStr: string): number {
  const [hours, minutes] = timeStr.split(':').map(Number);
  return (hours || 0) * 60 + (minutes || 0);
}

function minutesToTimeString(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export class PublicBookingService {
  public static async getOrganizationProfile(slug: string): Promise<PublicOrganizationProfile> {
    if (!slug || slug.trim().length === 0) {
      throw new BadRequestError('Organization slug is required');
    }

    const org = await prisma.organization.findUnique({
      where: { slug: slug.trim().toLowerCase() },
      include: {
        services: {
          where: { isActive: true },
          include: {
            staffMembers: {
              select: { staffMemberId: true },
            },
          },
          orderBy: [{ category: 'asc' }, { name: 'asc' }],
        },
        staffMembers: {
          where: { status: { not: 'OFFLINE' } },
          select: {
            id: true,
            name: true,
            roleTitle: true,
            avatarBg: true,
            initials: true,
            bio: true,
          },
          orderBy: { name: 'asc' },
        },
      },
    });

    if (!org || org.status !== 'ACTIVE') {
      throw new NotFoundError('Business not found or is currently inactive');
    }

    if (!org.bookingEnabled) {
      throw new BadRequestError('Online booking is currently disabled for this business');
    }

    return {
      id: org.id,
      name: org.name,
      slug: org.slug,
      bookingEnabled: org.bookingEnabled,
      bookingTitle: org.bookingTitle || `Book an Appointment with ${org.name}`,
      bookingNotice: org.bookingNotice,
      logoUrl: org.logoUrl,
      tagline: org.tagline,
      brandColor: org.brandColor || '#2563eb',
      customDomain: org.customDomain || null,
      contactEmail: org.contactEmail,
      contactPhone: org.contactPhone,
      address: org.address,
      currency: org.currency,
      timezone: org.timezone,
      minNoticeHours: org.minNoticeHours,
      cancellationHours: org.cancellationHours,
      services: org.services.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description ?? null,
        category: s.category || 'General',
        price: Number(s.price),
        durationMinutes: s.durationMinutes,
        bufferBefore: s.bufferBefore,
        bufferAfter: s.bufferAfter,
        requireDeposit: s.requireDeposit,
        depositType: s.depositType || 'FIXED',
        depositAmount: s.depositAmount ? Number(s.depositAmount) : null,
        assignedStaffIds: s.staffMembers.map((sm) => sm.staffMemberId),
      })),
      staffMembers: org.staffMembers,
    };
  }

  public static async getAvailableSlots(
    slug: string,
    serviceId: string,
    dateStr: string,
    requestedStaffMemberId?: string,
  ): Promise<TimeSlot[]> {
    if (!serviceId) throw new BadRequestError('Service ID is required');
    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      throw new BadRequestError('Valid date (YYYY-MM-DD) is required');
    }

    const todayIso = new Date().toISOString().slice(0, 10);
    if (dateStr < todayIso) {
      return [];
    }

    const org = await prisma.organization.findUnique({
      where: { slug: slug.trim().toLowerCase() },
      select: { id: true, bookingEnabled: true, status: true, minNoticeHours: true },
    });

    if (!org || org.status !== 'ACTIVE' || !org.bookingEnabled) {
      throw new NotFoundError('Business booking portal not available');
    }

    const service = await prisma.service.findFirst({
      where: { id: serviceId, organizationId: org.id, isActive: true },
      include: {
        staffMembers: { select: { staffMemberId: true } },
      },
    });

    if (!service) {
      throw new NotFoundError('Service not found or is inactive');
    }

    // Determine target day of week
    const targetDate = new Date(`${dateStr}T00:00:00Z`);
    if (isNaN(targetDate.getTime())) {
      throw new BadRequestError('Invalid date provided');
    }
    const dayOfWeekIndex = targetDate.getUTCDay();
    const dayOfWeekName = DAY_NAMES[dayOfWeekIndex] ?? 'MON';

    // Find candidate staff
    const assignedStaffIds = service.staffMembers.map((sm) => sm.staffMemberId);
    let staffFilterIds = assignedStaffIds;
    if (requestedStaffMemberId) {
      if (assignedStaffIds.length > 0 && !assignedStaffIds.includes(requestedStaffMemberId)) {
        throw new BadRequestError('The selected staff member does not provide this service');
      }
      staffFilterIds = [requestedStaffMemberId];
    }

    const candidateStaff = await prisma.staffMember.findMany({
      where: {
        organizationId: org.id,
        status: { not: 'OFFLINE' },
        ...(staffFilterIds.length > 0 ? { id: { in: staffFilterIds } } : {}),
      },
    });

    // Filter staff who work on this day
    const availableStaffForDay = candidateStaff.filter((staff) => {
      const days =
        staff.workingDays && staff.workingDays.length > 0
          ? staff.workingDays
          : ['MON', 'TUE', 'WED', 'THU', 'FRI'];
      return days.includes(dayOfWeekName);
    });

    if (availableStaffForDay.length === 0) {
      return [];
    }

    // Fetch existing appointments on targetDate for these staff
    const startOfDay = new Date(`${dateStr}T00:00:00Z`);
    const endOfDay = new Date(`${dateStr}T23:59:59.999Z`);

    const existingAppointments = await prisma.appointment.findMany({
      where: {
        organizationId: org.id,
        scheduledAt: { gte: startOfDay, lte: endOfDay },
        status: { not: 'CANCELLED' },
        staffMemberId: { in: availableStaffForDay.map((s) => s.id) },
      },
      select: {
        id: true,
        staffMemberId: true,
        scheduledAt: true,
        durationMinutes: true,
      },
    });

    // Slot interval (30 min steps)
    const slotStepMinutes = 30;
    const duration = service.durationMinutes;
    const bufferBefore = service.bufferBefore || 0;
    const bufferAfter = service.bufferAfter || 0;

    const slotsMap = new Map<string, Set<string>>();

    for (const staff of availableStaffForDay) {
      const shiftStartMin = timeStringToMinutes(staff.shiftStart || '09:00');
      const shiftEndMin = timeStringToMinutes(staff.shiftEnd || '17:00');

      const staffAppointments = existingAppointments.filter((a) => a.staffMemberId === staff.id);

      for (
        let timeMin = shiftStartMin;
        timeMin + duration <= shiftEndMin;
        timeMin += slotStepMinutes
      ) {
        const slotStartMin = timeMin;
        const slotEndMin = timeMin + duration;

        // Check buffer windows: [slotStartMin - bufferBefore, slotEndMin + bufferAfter]
        const windowStart = slotStartMin - bufferBefore;
        const windowEnd = slotEndMin + bufferAfter;

        const hasConflict = staffAppointments.some((appt) => {
          const apptUtcHours = appt.scheduledAt.getUTCHours();
          const apptUtcMinutes = appt.scheduledAt.getUTCMinutes();
          const apptStartMin = apptUtcHours * 60 + apptUtcMinutes;
          const apptEndMin = apptStartMin + appt.durationMinutes;

          // Conflict occurs if appointment overlaps with our buffered window
          return windowStart < apptEndMin && windowEnd > apptStartMin;
        });

        if (!hasConflict) {
          const timeString = minutesToTimeString(slotStartMin);
          if (!slotsMap.has(timeString)) {
            slotsMap.set(timeString, new Set());
          }
          slotsMap.get(timeString)!.add(staff.id);
        }
      }
    }

    // Format output and enforce minimum advance notice policy
    const sortedTimeStrings = Array.from(slotsMap.keys()).sort();
    const now = new Date();
    const isToday = dateStr === now.toISOString().slice(0, 10);
    const minNoticeHours = org.minNoticeHours ?? 2;
    const currentMinutesFromMidnight = now.getUTCHours() * 60 + now.getUTCMinutes();
    const cutoffMinutes = currentMinutesFromMidnight + minNoticeHours * 60;

    return sortedTimeStrings
      .filter((timeStr) => {
        if (!isToday) return true;
        return timeStringToMinutes(timeStr) >= cutoffMinutes;
      })
      .map((timeStr) => {
        const startMin = timeStringToMinutes(timeStr);
        const endMin = startMin + duration;
        return {
          startTime: timeStr,
          endTime: minutesToTimeString(endMin),
          availableStaffIds: Array.from(slotsMap.get(timeStr)!),
        };
      });
  }

  public static async bookAppointment(
    slug: string,
    input: PublicBookingInput,
  ): Promise<PublicBookingResult> {
    if (!input.customerName || input.customerName.trim().length === 0) {
      throw new BadRequestError('Customer name is required');
    }
    if (input.customerName.trim().length > 100) {
      throw new BadRequestError('Customer name cannot exceed 100 characters');
    }
    if (!input.customerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.customerEmail.trim())) {
      throw new BadRequestError('A valid email address is required');
    }
    if (input.customerEmail.trim().length > 150) {
      throw new BadRequestError('Customer email cannot exceed 150 characters');
    }
    if (input.customerPhone && input.customerPhone.trim().length > 30) {
      throw new BadRequestError('Customer phone cannot exceed 30 characters');
    }
    if (input.notes && input.notes.trim().length > 1000) {
      throw new BadRequestError('Booking notes cannot exceed 1000 characters');
    }
    if (!input.date || !/^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
      throw new BadRequestError('A valid booking date (YYYY-MM-DD) is required');
    }
    const todayIso = new Date().toISOString().slice(0, 10);
    if (input.date < todayIso) {
      throw new BadRequestError('Cannot schedule appointments in the past');
    }
    if (!input.time || !/^\d{2}:\d{2}$/.test(input.time)) {
      throw new BadRequestError('A valid booking time (HH:mm) is required');
    }

    const org = await prisma.organization.findUnique({
      where: { slug: slug.trim().toLowerCase() },
      select: { id: true, name: true, bookingEnabled: true, status: true },
    });

    if (!org || org.status !== 'ACTIVE' || !org.bookingEnabled) {
      throw new NotFoundError('Business booking portal is currently unavailable');
    }

    const service = await prisma.service.findFirst({
      where: { id: input.serviceId, organizationId: org.id, isActive: true },
      include: {
        staffMembers: { select: { staffMemberId: true } },
      },
    });

    if (!service) {
      throw new NotFoundError('Selected service is not available');
    }

    // Determine available staff for this specific slot
    const slots = await this.getAvailableSlots(
      slug,
      service.id,
      input.date,
      input.staffMemberId || undefined,
    );

    const matchingSlot = slots.find((s) => s.startTime === input.time);
    if (!matchingSlot || matchingSlot.availableStaffIds.length === 0) {
      throw new BadRequestError(
        'The selected time slot is no longer available. Please select another slot.',
      );
    }

    // Choose staff: requested staff or first available qualified staff
    const assignedStaffId =
      input.staffMemberId && matchingSlot.availableStaffIds.includes(input.staffMemberId)
        ? input.staffMemberId
        : matchingSlot.availableStaffIds[0];

    const staff = await prisma.staffMember.findUnique({
      where: { id: assignedStaffId },
      select: { id: true, name: true },
    });

    // Construct scheduledAt DateTime in UTC
    const scheduledAt = new Date(`${input.date}T${input.time}:00Z`);

    // Calculate deposit requirement
    let depositAmount: number | null = null;
    if (service.requireDeposit && service.depositAmount) {
      if (service.depositType === 'PERCENTAGE') {
        depositAmount = Number(
          ((Number(service.price) * Number(service.depositAmount)) / 100).toFixed(2),
        );
      } else {
        depositAmount = Number(Number(service.depositAmount).toFixed(2));
      }
    }

    // Transaction: Find or create customer, create appointment
    const result = await prisma.$transaction(async (tx) => {
      const email = input.customerEmail.trim().toLowerCase();
      let customer = await tx.customer.findFirst({
        where: {
          organizationId: org.id,
          email,
        },
      });

      if (!customer) {
        customer = await tx.customer.create({
          data: {
            organizationId: org.id,
            name: input.customerName.trim(),
            email,
            phone: input.customerPhone?.trim() || null,
            status: 'ACTIVE',
            notes: 'Booked online via public scheduling portal',
          },
        });
      } else if (input.customerPhone?.trim() && !customer.phone) {
        customer = await tx.customer.update({
          where: { id: customer.id },
          data: { phone: input.customerPhone.trim() },
        });
      }

      const appointment = await tx.appointment.create({
        data: {
          organizationId: org.id,
          customerId: customer.id,
          serviceId: service.id,
          staffMemberId: staff?.id || null,
          title: `${service.name} - ${input.customerName.trim()}`,
          scheduledAt,
          durationMinutes: service.durationMinutes,
          status: 'CONFIRMED',
          type: 'IN_PERSON',
          location: org.name,
          notes: input.notes?.trim() || null,
          depositPaid: false,
          depositAmount: depositAmount !== null ? depositAmount : undefined,
        },
      });

      return {
        appointmentId: appointment.id,
        serviceName: service.name,
        staffName: staff?.name ?? null,
        scheduledAt: appointment.scheduledAt.toISOString(),
        durationMinutes: appointment.durationMinutes,
        customerName: customer.name,
        customerEmail: customer.email,
        status: appointment.status,
        requireDeposit: service.requireDeposit,
        depositAmount,
      };
    });

    // 1. Dispatch confirmation email asynchronously (fire-and-forget safely)
    EmailService.sendBookingConfirmationEmail({
      to: result.customerEmail,
      customerName: result.customerName,
      serviceTitle: result.serviceName,
      scheduledAt: new Date(result.scheduledAt),
      durationMinutes: result.durationMinutes,
      specialistName: result.staffName,
      organizationName: org.name,
    }).catch(() => {
      // Handled inside EmailService
    });

    // 2. Persist in-app notification for the workspace staff
    NotificationService.createNotification({
      organizationId: org.id,
      type: 'BOOKING_CREATED',
      title: `New Online Booking: ${result.serviceName}`,
      message: `${result.customerName} booked ${result.serviceName} for ${new Date(result.scheduledAt).toLocaleDateString()}${result.staffName ? ` with ${result.staffName}` : ''}.`,
      actionUrl: '/dashboard/calendar',
      metadata: {
        appointmentId: result.appointmentId,
        customerEmail: result.customerEmail,
      },
    }).catch(() => {
      // Handled inside NotificationService
    });

    return result;
  }
}
