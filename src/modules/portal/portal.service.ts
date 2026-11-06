import crypto from 'node:crypto';
import { Prisma, ContractStatus } from '@prisma/client';
import { prisma } from '../../database/prisma.js';
import { generateSessionToken, hashSessionToken } from '../auth/crypto.js';
import { EmailService } from '../../common/email/email.service.js';
import { NotificationService } from '../notifications/notification.service.js';
import {
  BadRequestError,
  NotFoundError,
  UnauthorizedError,
} from '../../common/errors/app-error.js';
import { logger } from '../../common/logging/logger.js';
import { FlowRulesService } from '../flow-rules/flow-rules.service.js';
import { FlowRuleTrigger } from '../flow-rules/flow-rules.types.js';
import { PublicBookingService } from '../public-booking/public-booking.service.js';
import { QuoteService } from '../quotes/quote.service.js';
import type {
  RequestPortalLinkInput,
  VerifyPortalTokenInput,
  RescheduleAppointmentInput,
  CancelAppointmentInput,
  UpdatePortalProfileInput,
  PortalQuoteSummary,
  PortalProjectSummary,
  PortalContractSummary,
  PortalNotificationSummary,
  SignPortalContractInput,
  AcceptPortalQuoteInput,
} from './portal.types.js';

interface RawQuoteItem {
  id: string;
  description: string;
  quantity: number;
  unitPrice: Prisma.Decimal | number;
  amount: Prisma.Decimal | number;
}

interface RawQuoteForPortal {
  id: string;
  organizationId: string;
  customerId: string;
  quoteNumber: string;
  title: string;
  status: string;
  subtotal: Prisma.Decimal | number;
  taxAmount: Prisma.Decimal | number;
  discountAmount: Prisma.Decimal | number;
  totalAmount: Prisma.Decimal | number;
  issuedAt: Date;
  expiresAt: Date | null;
  acceptedAt: Date | null;
  declinedAt: Date | null;
  notes: string | null;
  items: RawQuoteItem[];
}

const prismaQuotes = prisma as unknown as {
  quote: {
    findMany: (args: unknown) => Promise<RawQuoteForPortal[]>;
    findFirst: (args: unknown) => Promise<RawQuoteForPortal | null>;
  };
  quoteToken: {
    create: (args: {
      data: {
        quoteId: string;
        tokenHash: string;
        expiresAt: Date;
      };
    }) => Promise<{ id: string; tokenHash: string }>;
  };
};

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

    const customer = await prisma.customer.findFirst({
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
    const [organization, customer, appointments, invoices, quotes, projects, contracts] =
      await Promise.all([
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
        prismaQuotes.quote.findMany({
          where: {
            organizationId,
            customerId,
          },
          include: {
            items: true,
          },
          orderBy: {
            createdAt: 'desc',
          },
        }),
        prisma.project.findMany({
          where: {
            organizationId,
            customerId,
          },
          include: {
            tasks: {
              select: {
                id: true,
                title: true,
                status: true,
                priority: true,
                dueDate: true,
              },
            },
          },
          orderBy: {
            createdAt: 'desc',
          },
        }),
        prisma.contract.findMany({
          where: {
            organizationId,
            customerId,
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

    // Ensure every invoice has a valid cryptographic payment token for instant 1-click portal settlement
    const invoicesWithTokens = await Promise.all(
      invoices.map(async (inv) => {
        if (!inv.paymentToken) {
          const generatedToken = `tok_${crypto.randomBytes(16).toString('hex')}`;
          const expiry = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
          await prisma.invoice.update({
            where: { id: inv.id },
            data: { paymentToken: generatedToken, paymentTokenExpiry: expiry },
          });
          return { ...inv, paymentToken: generatedToken, paymentTokenExpiry: expiry };
        }
        return inv;
      }),
    );

    for (const inv of invoicesWithTokens) {
      const invTotal = Number(inv.total);
      totalBilled += invTotal;
      if (inv.status === 'PAID') {
        totalPaid += invTotal;
      } else if (inv.status === 'PENDING' || inv.status === 'OVERDUE') {
        totalOutstanding += invTotal;
      }
    }

    let totalQuoteValue = 0;
    let pendingQuotesCount = 0;
    let acceptedQuotesCount = 0;

    const formattedQuotes: PortalQuoteSummary[] = (quotes || []).map((q) => {
      const totalNum = Number(q.totalAmount);
      totalQuoteValue += totalNum;
      if (q.status === 'SENT' || q.status === 'DRAFT') {
        pendingQuotesCount++;
      } else if (q.status === 'ACCEPTED') {
        acceptedQuotesCount++;
      }

      return {
        id: q.id,
        quoteNumber: q.quoteNumber,
        title: q.title,
        status: q.status,
        subtotal: Number(q.subtotal),
        taxAmount: Number(q.taxAmount),
        discountAmount: Number(q.discountAmount),
        totalAmount: totalNum,
        issuedAt: q.issuedAt.toISOString(),
        expiresAt: q.expiresAt ? q.expiresAt.toISOString() : null,
        acceptedAt: q.acceptedAt ? q.acceptedAt.toISOString() : null,
        declinedAt: q.declinedAt ? q.declinedAt.toISOString() : null,
        notes: q.notes,
        itemsCount: q.items?.length || 0,
      };
    });

    const formattedProjects: PortalProjectSummary[] = (projects || []).map((p) => {
      const totalTasks = p.tasks.length;
      const completedTasks = p.tasks.filter((t) => t.status === 'DONE').length;
      const progressPercentage =
        totalTasks > 0
          ? Math.round((completedTasks / totalTasks) * 100)
          : p.status === 'COMPLETED'
            ? 100
            : 0;

      return {
        id: p.id,
        name: p.name,
        description: p.description,
        status: p.status,
        color: p.color || '#3b82f6',
        startDate: p.startDate ? p.startDate.toISOString() : null,
        targetDate: p.targetDate ? p.targetDate.toISOString() : null,
        completedAt: p.completedAt ? p.completedAt.toISOString() : null,
        budget: p.budget ? Number(p.budget) : null,
        currency: p.currency,
        tasksCount: totalTasks,
        completedTasksCount: completedTasks,
        progressPercentage,
      };
    });

    let pendingContractsCount = 0;
    let signedContractsCount = 0;

    const formattedContracts: PortalContractSummary[] = (contracts || []).map((c) => {
      if (c.status === 'PENDING_SIGNATURE' || c.status === 'VIEWED' || c.status === 'DRAFT') {
        pendingContractsCount++;
      } else if (c.status === 'SIGNED' || c.status === 'COUNTERSIGNED') {
        signedContractsCount++;
      }

      return {
        id: c.id,
        contractNumber: c.contractNumber,
        title: c.title,
        content: c.content,
        status: c.status,
        issuedAt: c.issuedAt.toISOString(),
        expiresAt: c.expiresAt ? c.expiresAt.toISOString() : null,
        viewedAt: c.viewedAt ? c.viewedAt.toISOString() : null,
        signedAt: c.signedAt ? c.signedAt.toISOString() : null,
        signerName: c.signerName,
        signerEmail: c.signerEmail,
        signatureData: c.signatureData,
        signatureType: c.signatureType,
        contentChecksum: c.contentChecksum,
        countersignedAt: c.countersignedAt ? c.countersignedAt.toISOString() : null,
        countersignerName: c.countersignerName,
        quoteId: c.quoteId,
        projectId: c.projectId,
      };
    });

    return {
      organization,
      customer,
      appointments: {
        upcoming: upcomingAppointments,
        past: pastAppointments,
        total: appointments.length,
      },
      invoices: {
        list: invoicesWithTokens,
        metrics: {
          totalBilled: totalBilled.toFixed(2),
          totalPaid: totalPaid.toFixed(2),
          totalOutstanding: totalOutstanding.toFixed(2),
          count: invoicesWithTokens.length,
        },
      },
      quotes: {
        list: formattedQuotes,
        metrics: {
          totalProposals: formattedQuotes.length,
          pendingCount: pendingQuotesCount,
          acceptedCount: acceptedQuotesCount,
          totalValue: totalQuoteValue.toFixed(2),
        },
      },
      projects: {
        list: formattedProjects,
        metrics: {
          totalProjects: formattedProjects.length,
          activeCount: formattedProjects.filter(
            (p) => p.status === 'ACTIVE' || p.status === 'PLANNING',
          ).length,
          completedCount: formattedProjects.filter((p) => p.status === 'COMPLETED').length,
        },
      },
      contracts: {
        list: formattedContracts,
        metrics: {
          totalContracts: formattedContracts.length,
          pendingCount: pendingContractsCount,
          signedCount: signedContractsCount,
        },
      },
    };
  }

  /**
   * Issues a cryptographic token for an authenticated customer to view/sign a specific proposal.
   */
  public static async getQuoteAccessToken(
    organizationId: string,
    customerId: string,
    quoteId: string,
  ): Promise<{ token: string; url: string }> {
    const quote = await prismaQuotes.quote.findFirst({
      where: {
        id: quoteId,
        organizationId,
        customerId,
      },
    });

    if (!quote) {
      throw new NotFoundError('Proposal not found');
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const tokenExpiry = quote.expiresAt || new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

    await prismaQuotes.quoteToken.create({
      data: {
        quoteId: quote.id,
        tokenHash,
        expiresAt: tokenExpiry,
      },
    });

    return {
      token: rawToken,
      url: `/quote/${rawToken}`,
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

    const updated = await prisma.$transaction(async (tx) => {
      // Conflict check if a staff member is assigned
      if (appointment.staffMemberId) {
        await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(hashtext('flowpilot_apt_' || ${organizationId}::text), hashtext(${appointment.staffMemberId}::text))
        `;

        const activeAppointments = await tx.appointment.findMany({
          where: {
            organizationId,
            staffMemberId: appointment.staffMemberId,
            id: { not: appointment.id },
            status: { in: ['CONFIRMED', 'PENDING'] },
          },
          select: {
            id: true,
            scheduledAt: true,
            durationMinutes: true,
          },
        });

        const appointmentStartTime = newStart.getTime();
        const appointmentEndTime = newEnd.getTime();
        const hasConflict = activeAppointments.some((apt) => {
          const existingStart = new Date(apt.scheduledAt).getTime();
          const existingEnd = existingStart + apt.durationMinutes * 60 * 1000;
          return appointmentStartTime < existingEnd && appointmentEndTime > existingStart;
        });

        if (hasConflict) {
          throw new BadRequestError(
            'The assigned specialist is not available at the selected time. Please choose another slot.',
          );
        }
      }

      return tx.appointment.update({
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

    NotificationService.createNotification({
      organizationId,
      type: 'BOOKING_RESCHEDULED',
      title: `Booking Rescheduled: ${updated.service?.name || 'Appointment'}`,
      message: `Client rescheduled appointment to ${newStart.toLocaleDateString()} at ${newStart.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`,
      actionUrl: `/dashboard/calendar?appointmentId=${appointment.id}`,
      metadata: { appointmentId: appointment.id, customerId },
    }).catch(() => {});

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
        service: true,
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

    NotificationService.createNotification({
      organizationId,
      type: 'BOOKING_CANCELLED',
      title: `Booking Cancelled: ${appointment.service?.name || appointment.title || 'Appointment'}`,
      message: `Client cancelled appointment. Reason: ${input.reason.trim()}${isLateCancellation ? ' (Late cancellation)' : ''}.`,
      actionUrl: `/dashboard/calendar?appointmentId=${appointment.id}`,
      metadata: { appointmentId: appointment.id, customerId, isLateCancellation },
    }).catch(() => {});

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

  /**
   * List contracts belonging to the authenticated customer.
   */
  public static async listContracts(organizationId: string, customerId: string) {
    const contracts = await prisma.contract.findMany({
      where: {
        organizationId,
        customerId,
      },
      orderBy: { createdAt: 'desc' },
    });

    return contracts.map((c) => ({
      id: c.id,
      contractNumber: c.contractNumber,
      title: c.title,
      content: c.content,
      status: c.status,
      issuedAt: c.issuedAt.toISOString(),
      expiresAt: c.expiresAt ? c.expiresAt.toISOString() : null,
      viewedAt: c.viewedAt ? c.viewedAt.toISOString() : null,
      signedAt: c.signedAt ? c.signedAt.toISOString() : null,
      signerName: c.signerName,
      signerEmail: c.signerEmail,
      signatureData: c.signatureData,
      signatureType: c.signatureType,
      contentChecksum: c.contentChecksum,
      countersignedAt: c.countersignedAt ? c.countersignedAt.toISOString() : null,
      countersignerName: c.countersignerName,
      quoteId: c.quoteId,
      projectId: c.projectId,
    }));
  }

  /**
   * Get single contract with clauses and mark as VIEWED if pending.
   */
  public static async getContractById(
    organizationId: string,
    customerId: string,
    contractId: string,
  ) {
    const contract = await prisma.contract.findFirst({
      where: {
        id: contractId,
        organizationId,
        customerId,
      },
      include: {
        organization: {
          select: {
            id: true,
            name: true,
            logoUrl: true,
            brandColor: true,
            contactEmail: true,
            contactPhone: true,
            address: true,
          },
        },
        customer: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            company: true,
          },
        },
      },
    });

    if (!contract) {
      throw new NotFoundError('Contract not found');
    }

    // Auto-update to VIEWED if currently PENDING_SIGNATURE or DRAFT
    if (contract.status === 'PENDING_SIGNATURE' && !contract.viewedAt) {
      await prisma.contract.update({
        where: { id: contract.id },
        data: {
          status: 'VIEWED',
          viewedAt: new Date(),
        },
      });
      contract.status = ContractStatus.VIEWED;
    }

    return contract;
  }

  /**
   * Executes in-portal digital signature ceremony for an authenticated customer.
   */
  public static async signContract(
    organizationId: string,
    customerId: string,
    contractId: string,
    input: SignPortalContractInput,
    meta: { ipAddress?: string; userAgent?: string } = {},
  ) {
    const contract = await prisma.contract.findFirst({
      where: {
        id: contractId,
        organizationId,
        customerId,
      },
      include: {
        customer: true,
        organization: true,
      },
    });

    if (!contract) {
      throw new NotFoundError('Contract not found');
    }

    if (contract.status === 'SIGNED' || contract.status === 'COUNTERSIGNED') {
      throw new BadRequestError('This contract has already been signed');
    }

    if (contract.status === 'VOIDED' || contract.status === 'DECLINED') {
      throw new BadRequestError('This contract is no longer active');
    }

    if (contract.expiresAt && new Date() > contract.expiresAt) {
      throw new BadRequestError('This contract has expired');
    }

    // Compute cryptographic SHA-256 hash
    const contentChecksum = crypto
      .createHash('sha256')
      .update(contract.content + '|' + input.signerEmail + '|' + input.signerName)
      .digest('hex');

    const signed = await prisma.contract.update({
      where: { id: contract.id },
      data: {
        status: 'SIGNED',
        signedAt: new Date(),
        signerName: input.signerName.trim(),
        signerEmail: input.signerEmail.trim().toLowerCase(),
        signerIp: meta.ipAddress || 'Client Portal Session',
        signerUserAgent: meta.userAgent || 'Web Browser',
        signatureData: input.signatureData,
        signatureType: input.signatureType,
        contentChecksum,
        clientNotes: input.clientNotes ?? null,
      },
    });

    // In-app alert for staff
    NotificationService.createNotification({
      organizationId,
      type: 'CONTRACT_SIGNED',
      title: `Contract Signed: ${contract.contractNumber}`,
      message: `${contract.title} was signed by ${input.signerName} (${input.signerEmail}) in Client Portal.`,
      actionUrl: `/dashboard/contracts?contractId=${contract.id}`,
      metadata: {
        contractId: contract.id,
        customerId,
        checksum: contentChecksum,
      },
    }).catch((err) => {
      logger.error({ err }, 'Failed to create contract signed notification');
    });

    // Autonomous FlowRules Trigger (non-blocking)
    FlowRulesService.dispatch(organizationId, FlowRuleTrigger.CONTRACT_SIGNED, {
      entityId: contract.id,
      customerId,
      title: contract.title,
      metadata: {
        signerEmail: input.signerEmail,
        signerName: input.signerName,
      },
    }).catch((err) => {
      logger.error({ err }, 'FlowRules: failed dispatching CONTRACT_SIGNED');
    });

    logger.info(
      {
        contractId: contract.id,
        customerId,
        checksum: contentChecksum,
      },
      'Contract signed via client portal',
    );

    return {
      success: true,
      contractId: signed.id,
      status: signed.status,
      signedAt: signed.signedAt,
      contentChecksum,
    };
  }

  /**
   * Accepts a proposal/quote in client portal and automatically prepares or converts to deposit invoice.
   */
  public static async acceptQuote(
    organizationId: string,
    customerId: string,
    quoteId: string,
    input: AcceptPortalQuoteInput,
    meta: { ipAddress?: string } = {},
  ) {
    const quote = await prismaQuotes.quote.findFirst({
      where: {
        id: quoteId,
        organizationId,
        customerId,
      },
      include: {
        customer: true,
        organization: true,
        items: true,
      },
    });

    if (!quote) {
      throw new NotFoundError('Proposal not found');
    }

    if (quote.status === 'ACCEPTED') {
      throw new BadRequestError('This proposal has already been accepted');
    }

    if (quote.status === 'DECLINED') {
      throw new BadRequestError('This proposal has been declined');
    }

    if (quote.expiresAt && new Date() > new Date(quote.expiresAt)) {
      throw new BadRequestError('This proposal has expired');
    }

    const customer = await prisma.customer.findUnique({
      where: { id: customerId },
      select: { email: true },
    });

    const now = new Date();
    await (
      prisma as unknown as { quote: { update: (args: unknown) => Promise<unknown> } }
    ).quote.update({
      where: { id: quote.id },
      data: {
        status: 'ACCEPTED',
        acceptedAt: now,
        signerName: input.signerName.trim(),
        signerEmail: input.signerEmail?.trim().toLowerCase() || customer?.email || '',
        signatureData: input.signatureData || null,
        signerIp: meta.ipAddress || 'Client Portal',
        clientNotes: input.clientNotes || null,
      },
    });

    // Auto convert to formal invoice for payment collection
    let convertedInvoiceId: string | undefined;
    let paymentToken: string | undefined;

    try {
      const converted = await QuoteService.convertToInvoice(organizationId, 'system', quote.id);
      convertedInvoiceId = converted.invoiceId;

      const inv = await prisma.invoice.findUnique({
        where: { id: converted.invoiceId },
        select: { paymentToken: true },
      });
      paymentToken = inv?.paymentToken || undefined;
    } catch (conversionErr) {
      logger.warn({ conversionErr }, 'Portal auto-invoice generation skipped or already existed');
    }

    // In-app alert for staff
    NotificationService.createNotification({
      organizationId,
      type: 'QUOTE_ACCEPTED',
      title: `Proposal ${quote.quoteNumber} Accepted!`,
      message: `${input.signerName} accepted proposal "${quote.title}" in Client Portal.`,
      actionUrl: `/dashboard/quotes`,
      metadata: { quoteId: quote.id, customerId, autoInvoiceId: convertedInvoiceId },
    }).catch(() => {});

    // Autonomous FlowRules Trigger (non-blocking)
    FlowRulesService.dispatch(organizationId, FlowRuleTrigger.QUOTE_ACCEPTED, {
      entityId: quote.id,
      customerId,
      title: quote.title,
      amount: Number(quote.totalAmount),
      metadata: {
        quoteNumber: quote.quoteNumber,
        signerName: input.signerName,
        convertedInvoiceId,
      },
    }).catch(() => {});

    return {
      success: true,
      quoteNumber: quote.quoteNumber,
      acceptedAt: now.toISOString(),
      convertedInvoiceId,
      paymentToken,
    };
  }

  /**
   * Fetches real available slots for rescheduling an appointment.
   */
  public static async getAvailableSlotsForReschedule(
    organizationId: string,
    customerId: string,
    appointmentId: string,
    dateStr: string,
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

    if (!appointment || !appointment.serviceId) {
      return [];
    }

    return PublicBookingService.getAvailableSlots(
      appointment.organization.slug,
      appointment.serviceId,
      dateStr,
      appointment.staffMemberId || undefined,
    );
  }

  /**
   * Retrieves client notification feed and unread counter.
   */
  public static async getNotifications(organizationId: string, customerId: string) {
    const notifications = await prisma.notification.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    const clientNotifications = notifications.filter((n) => {
      const meta = n.metadata as Record<string, unknown> | null;
      return meta?.customerId === customerId;
    });

    const unreadCount = clientNotifications.filter((n) => !n.isRead).length;

    const formatted: PortalNotificationSummary[] = clientNotifications.map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      message: n.message,
      actionUrl: n.actionUrl,
      isRead: n.isRead,
      createdAt: n.createdAt.toISOString(),
    }));

    return {
      notifications: formatted,
      unreadCount,
    };
  }

  /**
   * Mark a specific notification as read.
   */
  public static async markNotificationRead(
    organizationId: string,
    customerId: string,
    notificationId: string,
  ) {
    const notification = await prisma.notification.findFirst({
      where: { id: notificationId, organizationId },
    });

    if (!notification) {
      throw new NotFoundError('Notification not found');
    }

    const meta = notification.metadata as Record<string, unknown> | null;
    if (meta?.customerId !== customerId) {
      throw new UnauthorizedError('Unauthorized access to this notification');
    }

    const updated = await prisma.notification.update({
      where: { id: notificationId },
      data: { isRead: true, readAt: new Date() },
    });

    return updated;
  }

  /**
   * Mark all client notifications as read.
   */
  public static async markAllNotificationsRead(organizationId: string, customerId: string) {
    const notifications = await prisma.notification.findMany({
      where: { organizationId, isRead: false },
      take: 100,
    });

    const targetIds = notifications
      .filter((n) => {
        const meta = n.metadata as Record<string, unknown> | null;
        return meta?.customerId === customerId;
      })
      .map((n) => n.id);

    if (targetIds.length > 0) {
      await prisma.notification.updateMany({
        where: { id: { in: targetIds } },
        data: { isRead: true, readAt: new Date() },
      });
    }

    return { success: true, count: targetIds.length };
  }
}
