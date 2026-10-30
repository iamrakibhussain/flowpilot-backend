import { prisma } from '../../database/prisma.js';
import { NotFoundError, ConflictError, BadRequestError } from '../../common/errors/app-error.js';
import {
  UpdateOrganizationSettingsInput,
  OrganizationSettingsDTO,
  WorkspaceAuditLogDTO,
} from './organization.types.js';

export interface AuditActorContext {
  id: string;
  name: string;
  ip?: string;
}

export class OrganizationSettingsService {
  public static async getSettings(organizationId: string): Promise<OrganizationSettingsDTO> {
    if (!organizationId) {
      throw new BadRequestError('Organization ID is required');
    }

    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
    });

    if (!org) {
      throw new NotFoundError('Organization not found');
    }

    return this.mapToDTO(org);
  }

  public static async updateSettings(
    organizationId: string,
    input: UpdateOrganizationSettingsInput,
    actor?: AuditActorContext,
  ): Promise<OrganizationSettingsDTO> {
    if (!organizationId) {
      throw new BadRequestError('Organization ID is required');
    }

    const currentOrg = await prisma.organization.findUnique({
      where: { id: organizationId },
    });

    if (!currentOrg) {
      throw new NotFoundError('Organization not found');
    }

    // Slug uniqueness check if attempting to change slug
    if (input.slug && input.slug.toLowerCase().trim() !== currentOrg.slug.toLowerCase()) {
      const normalizedSlug = input.slug.toLowerCase().trim();
      const existing = await prisma.organization.findUnique({
        where: { slug: normalizedSlug },
      });

      if (existing && existing.id !== organizationId) {
        throw new ConflictError(
          `The booking URL slug '${normalizedSlug}' is already taken by another organization`,
        );
      }
    }

    // Custom domain uniqueness check
    if (
      input.customDomain &&
      input.customDomain.toLowerCase().trim() !== (currentOrg.customDomain || '').toLowerCase()
    ) {
      const normalizedDomain = input.customDomain.toLowerCase().trim();
      const existingDomain = await prisma.organization.findUnique({
        where: { customDomain: normalizedDomain },
      });

      if (existingDomain && existingDomain.id !== organizationId) {
        throw new ConflictError(
          `The custom domain '${normalizedDomain}' is already claimed by another organization`,
        );
      }
    }

    const updated = await prisma.organization.update({
      where: { id: organizationId },
      data: {
        ...(input.name !== undefined && { name: input.name.trim() }),
        ...(input.slug !== undefined && { slug: input.slug.toLowerCase().trim() }),
        ...(input.logoUrl !== undefined && { logoUrl: input.logoUrl }),
        ...(input.tagline !== undefined && { tagline: input.tagline }),
        ...(input.brandColor !== undefined && {
          brandColor: input.brandColor ? input.brandColor.toLowerCase() : '#2563eb',
        }),
        ...(input.customDomain !== undefined && {
          customDomain: input.customDomain ? input.customDomain.toLowerCase().trim() : null,
        }),
        ...(input.contactEmail !== undefined && {
          contactEmail: input.contactEmail ? input.contactEmail.trim().toLowerCase() : null,
        }),
        ...(input.contactPhone !== undefined && { contactPhone: input.contactPhone }),
        ...(input.address !== undefined && { address: input.address }),
        ...(input.bookingEnabled !== undefined && { bookingEnabled: input.bookingEnabled }),
        ...(input.bookingTitle !== undefined && { bookingTitle: input.bookingTitle }),
        ...(input.bookingNotice !== undefined && { bookingNotice: input.bookingNotice }),
        ...(input.currency !== undefined && { currency: input.currency }),
        ...(input.timezone !== undefined && { timezone: input.timezone }),
        ...(input.taxId !== undefined && { taxId: input.taxId }),
        ...(input.defaultTaxRate !== undefined && { defaultTaxRate: input.defaultTaxRate }),
        ...(input.defaultPaymentTerms !== undefined && {
          defaultPaymentTerms: input.defaultPaymentTerms,
        }),
        ...(input.invoiceFooter !== undefined && { invoiceFooter: input.invoiceFooter }),
        ...(input.bankName !== undefined && { bankName: input.bankName }),
        ...(input.bankAccount !== undefined && { bankAccount: input.bankAccount }),
        ...(input.bankRouting !== undefined && { bankRouting: input.bankRouting }),
        ...(input.bankSwift !== undefined && { bankSwift: input.bankSwift }),
        ...(input.minNoticeHours !== undefined && { minNoticeHours: input.minNoticeHours }),
        ...(input.maxHorizonDays !== undefined && { maxHorizonDays: input.maxHorizonDays }),
        ...(input.cancellationHours !== undefined && {
          cancellationHours: input.cancellationHours,
        }),
        ...(input.autoConfirmBookings !== undefined && {
          autoConfirmBookings: input.autoConfirmBookings,
        }),
      },
    });

    // Record audit trail entry
    if (actor) {
      try {
        const changedFields = Object.keys(input)
          .filter((k) => (input as Record<string, unknown>)[k] !== undefined)
          .join(', ');

        if (changedFields) {
          await prisma.workspaceAuditLog.create({
            data: {
              organizationId,
              userId: actor.id,
              userName: actor.name,
              action: 'UPDATED_SETTINGS',
              category: 'SETTINGS',
              details: `Updated workspace configuration: ${changedFields}`,
              ipAddress: actor.ip || null,
            },
          });
        }
      } catch {
        // Log error silently without failing the main transaction
      }
    }

    return this.mapToDTO(updated);
  }

  public static async getAuditLogs(
    organizationId: string,
    limit = 20,
  ): Promise<WorkspaceAuditLogDTO[]> {
    if (!organizationId) {
      throw new BadRequestError('Organization ID is required');
    }

    const logs = await prisma.workspaceAuditLog.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 50),
    });

    return logs.map((l) => ({
      id: l.id,
      organizationId: l.organizationId,
      userId: l.userId,
      userName: l.userName,
      action: l.action,
      category: l.category,
      details: l.details,
      ipAddress: l.ipAddress,
      createdAt: l.createdAt.toISOString(),
    }));
  }

  public static async checkSlugAvailability(
    organizationId: string,
    rawSlug: string,
  ): Promise<{ available: boolean; slug: string }> {
    const slug = rawSlug.toLowerCase().trim();
    if (!slug) {
      throw new BadRequestError('Slug cannot be empty');
    }

    const existing = await prisma.organization.findUnique({
      where: { slug },
      select: { id: true },
    });

    const available = !existing || existing.id === organizationId;
    return { available, slug };
  }

  private static mapToDTO(org: {
    id: string;
    name: string;
    slug: string;
    status: string;
    logoUrl: string | null;
    tagline: string | null;
    brandColor?: string | null;
    customDomain?: string | null;
    contactEmail: string | null;
    contactPhone: string | null;
    address: string | null;
    bookingEnabled: boolean;
    bookingTitle: string | null;
    bookingNotice: string | null;
    currency: string;
    timezone: string;
    taxId: string | null;
    defaultTaxRate: number;
    defaultPaymentTerms: string;
    invoiceFooter: string | null;
    bankName: string | null;
    bankAccount: string | null;
    bankRouting: string | null;
    bankSwift: string | null;
    minNoticeHours: number;
    maxHorizonDays: number;
    cancellationHours: number;
    autoConfirmBookings: boolean;
    createdAt: Date;
    updatedAt: Date;
  }): OrganizationSettingsDTO {
    return {
      id: org.id,
      name: org.name,
      slug: org.slug,
      status: org.status,
      logoUrl: org.logoUrl,
      tagline: org.tagline,
      brandColor: org.brandColor || '#2563eb',
      customDomain: org.customDomain || null,
      contactEmail: org.contactEmail,
      contactPhone: org.contactPhone,
      address: org.address,
      bookingEnabled: org.bookingEnabled,
      bookingTitle: org.bookingTitle,
      bookingNotice: org.bookingNotice,
      currency: org.currency,
      timezone: org.timezone,
      taxId: org.taxId,
      defaultTaxRate: org.defaultTaxRate,
      defaultPaymentTerms: org.defaultPaymentTerms,
      invoiceFooter: org.invoiceFooter,
      bankName: org.bankName,
      bankAccount: org.bankAccount,
      bankRouting: org.bankRouting,
      bankSwift: org.bankSwift,
      minNoticeHours: org.minNoticeHours,
      maxHorizonDays: org.maxHorizonDays,
      cancellationHours: org.cancellationHours,
      autoConfirmBookings: org.autoConfirmBookings,
      createdAt: org.createdAt.toISOString(),
      updatedAt: org.updatedAt.toISOString(),
    };
  }
}
