import crypto from 'node:crypto';
import { prisma } from '../../database/prisma.js';
import { generateSessionToken, hashSessionToken } from '../auth/crypto.js';
import { EmailService } from '../../common/email/email.service.js';
import {
  BadRequestError,
  NotFoundError,
  UnauthorizedError,
} from '../../common/errors/app-error.js';
import { logger } from '../../common/logging/logger.js';
import type {
  RequestPortalLinkInput,
  VerifyPortalTokenInput,
  RescheduleAppointmentInput,
  CancelAppointmentInput,
  UpdatePortalProfileInput,
} from './portal.types.js';

export class PortalService {
  /**
   * Dispatches a single-use 15-minute magic login link and 6-digit OTP code to the customer.
   * Adheres strictly to OWASP anti-enumeration: always returns success even if customer is not found.
   */
  public static async requestPortalLink(
    input: RequestPortalLinkInput,
    meta: { ipAddress?: string; userAgent?: string },
  ) {
    const org = await prisma.organization.findUnique({
      where: { slug: input.organizationSlug },
      select: {
        id: true,
        name: true,
        slug: true,
        brandColor: true,
        logoUrl: true,
      },
    });

    if (!org) {
      throw new NotFoundError(`Organization "${input.organizationSlug}" not found`);
    }

    let customer = await prisma.customer.findFirst({
      where: {
        organizationId: org.id,
        email: {
          equals: input.email,
          mode: 'insensitive',
        },
      },
      select: {
        id: true,
        name: true,
        email: true,
      },
    });

    // If customer record not found, check if they are a registered workspace member or owner
    if (!customer) {
      const workspaceMember = await prisma.user.findFirst({
        where: {
          email: { equals: input.email, mode: 'insensitive' },
          memberships: {
            some: { organizationId: org.id },
          },
        },
        select: {
          id: true,
          name: true,
          email: true,
        },
      });

      if (workspaceMember) {
        customer = await prisma.customer.create({
          data: {
            organizationId: org.id,
            name: workspaceMember.name,
            email: workspaceMember.email.toLowerCase(),
            status: 'ACTIVE',
            notes: 'Workspace member client portal profile',
          },
          select: {
            id: true,
            name: true,
            email: true,
          },
        });
      }
    }

    if (customer) {
      // 1. Generate high-entropy 256-bit magic token
      const rawToken = generateSessionToken();
      const tokenHash = hashSessionToken(rawToken);

      // 2. Generate 6-digit numeric OTP backup code
      const rawCode = crypto.randomInt(100000, 999999).toString();
      const codeHash = hashSessionToken(rawCode);

      // 3. Set strict 15-minute expiration
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

      await prisma.customerPortalToken.create({
        data: {
          organizationId: org.id,
          customerId: customer.id,
          tokenHash,
          codeHash,
          expiresAt,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
        },
      });

      // 4. Send branded email
      await EmailService.sendCustomerPortalMagicLinkEmail({
        to: customer.email,
        customerName: customer.name,
        organizationName: org.name,
        organizationSlug: org.slug,
        brandColor: org.brandColor,
        rawToken,
        code: rawCode,
      });

      logger.info(
        {
          event: 'portal.magic_link_issued',
          customerId: customer.id,
          organizationId: org.id,
        },
        'Portal magic link and OTP issued successfully',
      );
    } else {
      logger.info(
        {
          event: 'portal.magic_link_ignored',
          email: input.email,
          organizationId: org.id,
        },
        'Portal login requested for non-existent customer; silent return to prevent enumeration',
      );
    }

    return {
      success: true,
      message:
        'If a client account matches this email, a sign-in link and passcode have been sent.',
    };
  }

  /**
   * Verifies the magic token or 6-digit OTP code and creates an authenticated customer portal session.
   */
  public static async verifyPortalToken(
    input: VerifyPortalTokenInput,
    meta: { ipAddress?: string; userAgent?: string },
  ) {
    const org = await prisma.organization.findUnique({
      where: { slug: input.organizationSlug },
      select: { id: true, name: true, slug: true },
    });

    if (!org) {
      throw new NotFoundError(`Organization "${input.organizationSlug}" not found`);
    }

    let tokenRecord = null;
    const now = new Date();

    if (input.token) {
      const tokenHash = hashSessionToken(input.token.trim());
      tokenRecord = await prisma.customerPortalToken.findFirst({
        where: {
          organizationId: org.id,
          tokenHash,
          usedAt: null,
          expiresAt: { gt: now },
        },
        include: { customer: true },
      });
    } else if (input.code) {
      const codeHash = hashSessionToken(input.code.trim());
      tokenRecord = await prisma.customerPortalToken.findFirst({
        where: {
          organizationId: org.id,
          codeHash,
          usedAt: null,
          expiresAt: { gt: now },
        },
        include: { customer: true },
      });
    }

    if (!tokenRecord) {
      throw new UnauthorizedError(
        'Invalid or expired login link/passcode. Please request a new one.',
      );
    }

    // Mark single-use token as redeemed
    await prisma.customerPortalToken.update({
      where: { id: tokenRecord.id },
      data: { usedAt: now },
    });

    // Create persistent 7-day client session
    const rawSessionToken = generateSessionToken();
    const sessionHash = hashSessionToken(rawSessionToken);
    const sessionExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await prisma.customerPortalSession.create({
      data: {
        organizationId: org.id,
        customerId: tokenRecord.customerId,
        sessionHash,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        expiresAt: sessionExpiresAt,
      },
    });

    logger.info(
      {
        event: 'portal.session_established',
        customerId: tokenRecord.customerId,
        organizationId: org.id,
      },
      'Client portal session authenticated successfully',
    );

    return {
      rawSessionToken,
      customer: {
        id: tokenRecord.customer.id,
        name: tokenRecord.customer.name,
        email: tokenRecord.customer.email,
      },
      organization: {
        id: org.id,
        name: org.name,
        slug: org.slug,
      },
    };
  }

  /**
   * Validates a client portal session token from cookie.
   */
  public static async validateSession(rawSessionToken: string) {
    if (!rawSessionToken) {
      throw new UnauthorizedError('Authentication required');
    }

    const sessionHash = hashSessionToken(rawSessionToken);
    const session = await prisma.customerPortalSession.findFirst({
      where: {
        sessionHash,
        expiresAt: { gt: new Date() },
      },
      include: {
        customer: true,
        organization: true,
      },
    });

    if (!session) {
      throw new UnauthorizedError('Session expired or invalid. Please sign in again.');
    }

    // Touch lastActiveAt non-blockingly
    prisma.customerPortalSession
      .update({
        where: { id: session.id },
        data: { lastActiveAt: new Date() },
      })
      .catch((err) => {
        logger.warn({ err }, 'Failed to update portal session lastActiveAt');
      });

    return {
      session,
      customer: session.customer,
      organization: session.organization,
    };
  }

  /**
   * Fetches the complete portal dashboard state for the authenticated customer.
   */
  public static async getPortalDashboardData(organizationId: string, customerId: string) {
    const [organization, customer, appointments, invoices] = await Promise.all([
      prisma.organization.findUnique({
        where: { id: organizationId },
        select: {
          id: true,
          name: true,
          slug: true,
          brandColor: true,
          logoUrl: true,
          tagline: true,
          customDomain: true,
          contactEmail: true,
          contactPhone: true,
          address: true,
          currency: true,
          timezone: true,
          minNoticeHours: true,
          cancellationHours: true,
          bookingEnabled: true,
        },
      }),
      prisma.customer.findUnique({
        where: { id: customerId },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          company: true,
          createdAt: true,
        },
      }),
      prisma.appointment.findMany({
        where: {
          organizationId,
          customerId,
        },
        include: {
          service: {
            select: {
              id: true,
              name: true,
              price: true,
              durationMinutes: true,
            },
          },
          staffMember: {
            select: {
              id: true,
              name: true,
              roleTitle: true,
              initials: true,
              avatarBg: true,
            },
          },
        },
        orderBy: {
          scheduledAt: 'desc',
        },
      }),
      prisma.invoice.findMany({
        where: {
          organizationId,
          customerId,
        },
        include: {
          items: true,
          transactions: {
            select: {
              id: true,
              amount: true,
              status: true,
              paidAt: true,
              provider: true,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      }),
    ]);

    if (!organization || !customer) {
      throw new NotFoundError('Customer or Organization records not found');
    }

    const now = new Date();

    const upcomingAppointments = appointments
      .filter(
        (appt) =>
          new Date(appt.scheduledAt).getTime() >= now.getTime() - 30 * 60 * 1000 &&
          appt.status !== 'CANCELLED',
      )
      .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());

    const pastAppointments = appointments
      .filter(
        (appt) =>
          new Date(appt.scheduledAt).getTime() < now.getTime() - 30 * 60 * 1000 ||
          appt.status === 'CANCELLED',
      )
      .sort((a, b) => new Date(b.scheduledAt).getTime() - new Date(a.scheduledAt).getTime());

    let totalBilled = 0;
    let totalPaid = 0;
    let totalOutstanding = 0;

    for (const inv of invoices) {
      const invTotal = Number(inv.total);
      totalBilled += invTotal;
      if (inv.status === 'PAID') {
        totalPaid += invTotal;
      } else if (inv.status === 'PENDING' || inv.status === 'OVERDUE') {
        totalOutstanding += invTotal;
      }
    }

    return {
      organization,
      customer,
      appointments: {
        upcoming: upcomingAppointments,
        past: pastAppointments,
        total: appointments.length,
      },
      invoices: {
        list: invoices,
        metrics: {
          totalBilled: totalBilled.toFixed(2),
          totalPaid: totalPaid.toFixed(2),
          totalOutstanding: totalOutstanding.toFixed(2),
          count: invoices.length,
        },
      },
    };
  }

  /**
   * Reschedules an appointment self-service with strict workspace policy verification.
   */
  public static async rescheduleAppointment(
    organizationId: string,
    customerId: string,
    appointmentId: string,
    input: RescheduleAppointmentInput,
  ) {
    const appointment = await prisma.appointment.findFirst({
      where: {
        id: appointmentId,
        organizationId,
        customerId,
      },
      include: {
        organization: true,
        service: true,
      },
    });

    if (!appointment) {
      throw new NotFoundError('Appointment not found');
    }

    if (appointment.status === 'COMPLETED' || appointment.status === 'CANCELLED') {
      throw new BadRequestError(`Cannot reschedule an appointment marked as ${appointment.status}`);
    }

    const now = new Date();
    const scheduledTime = new Date(appointment.scheduledAt);
    const minNoticeHours = appointment.organization.minNoticeHours || 2;
    const hoursNotice = (scheduledTime.getTime() - now.getTime()) / (1000 * 60 * 60);

    if (hoursNotice < minNoticeHours) {
      throw new BadRequestError(
        `This appointment cannot be rescheduled online because it is within the ${minNoticeHours}-hour minimum notice window. Please contact support directly.`,
      );
    }

    const newStart = new Date(input.newScheduledAt);
    if (newStart.getTime() <= now.getTime()) {
      throw new BadRequestError('New appointment time must be in the future');
    }

    const durationMinutes =
      appointment.durationMinutes || appointment.service?.durationMinutes || 60;
    const newEnd = new Date(newStart.getTime() + durationMinutes * 60 * 1000);

    // Conflict check if a staff member is assigned
    if (appointment.staffMemberId) {
      const conflict = await prisma.appointment.findFirst({
        where: {
          organizationId,
          staffMemberId: appointment.staffMemberId,
          id: { not: appointment.id },
          status: { in: ['CONFIRMED', 'PENDING'] },
          scheduledAt: {
            gte: new Date(newStart.getTime() - durationMinutes * 60 * 1000),
            lte: newEnd,
          },
        },
      });

      if (conflict) {
        throw new BadRequestError(
          'The assigned specialist is not available at the selected time. Please choose another slot.',
        );
      }
    }

    const updated = await prisma.appointment.update({
      where: { id: appointment.id },
      data: {
        scheduledAt: newStart,
        status: 'CONFIRMED',
      },
      include: {
        service: true,
        staffMember: true,
      },
    });

    logger.info(
      {
        event: 'portal.appointment_rescheduled',
        appointmentId: appointment.id,
        newScheduledAt: newStart,
        customerId,
        organizationId,
      },
      'Client rescheduled appointment via portal',
    );

    return updated;
  }

  /**
   * Cancels an appointment self-service with cancellation reason logging and policy enforcement.
   */
  public static async cancelAppointment(
    organizationId: string,
    customerId: string,
    appointmentId: string,
    input: CancelAppointmentInput,
  ) {
    const appointment = await prisma.appointment.findFirst({
      where: {
        id: appointmentId,
        organizationId,
        customerId,
      },
      include: {
        organization: true,
      },
    });

    if (!appointment) {
      throw new NotFoundError('Appointment not found');
    }

    if (appointment.status === 'COMPLETED' || appointment.status === 'CANCELLED') {
      throw new BadRequestError(`Appointment is already marked as ${appointment.status}`);
    }

    const now = new Date();
    const scheduledTime = new Date(appointment.scheduledAt);
    const cancellationHours = appointment.organization.cancellationHours || 24;
    const hoursUntilAppointment = (scheduledTime.getTime() - now.getTime()) / (1000 * 60 * 60);

    const isLateCancellation = hoursUntilAppointment < cancellationHours;
    const cancellationNote = `[Client Portal Cancel] ${input.reason.trim()}${isLateCancellation ? ` (Late Cancellation: within ${cancellationHours}h window)` : ''}`;

    const updated = await prisma.appointment.update({
      where: { id: appointment.id },
      data: {
        status: 'CANCELLED',
        notes: appointment.notes ? `${appointment.notes}\n${cancellationNote}` : cancellationNote,
      },
    });

    logger.info(
      {
        event: 'portal.appointment_cancelled',
        appointmentId: appointment.id,
        customerId,
        organizationId,
        isLateCancellation,
      },
      'Client cancelled appointment via portal',
    );

    return {
      ...updated,
      isLateCancellation,
    };
  }

  /**
   * Updates client contact profile details.
   */
  public static async updateProfile(
    organizationId: string,
    customerId: string,
    input: UpdatePortalProfileInput,
  ) {
    const customer = await prisma.customer.findFirst({
      where: { id: customerId, organizationId },
    });

    if (!customer) {
      throw new NotFoundError('Customer not found');
    }

    const updated = await prisma.customer.update({
      where: { id: customer.id },
      data: {
        ...(input.name ? { name: input.name.trim() } : {}),
        ...(input.phone !== undefined ? { phone: input.phone?.trim() || null } : {}),
        ...(input.company !== undefined ? { company: input.company?.trim() || null } : {}),
      },
    });

    return updated;
  }

  /**
   * Logs out the customer portal session.
   */
  public static async logout(rawSessionToken: string) {
    if (!rawSessionToken) return;
    const sessionHash = hashSessionToken(rawSessionToken);
    await prisma.customerPortalSession.deleteMany({
      where: { sessionHash },
    });
  }
}
