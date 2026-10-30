import { prisma } from '../../database/prisma.js';
import { NotFoundError, ConflictError, BadRequestError } from '../../common/errors/app-error.js';
import { UpdateOrganizationSettingsInput, OrganizationSettingsDTO } from './organization.types.js';

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

    const updated = await prisma.organization.update({
      where: { id: organizationId },
      data: {
        ...(input.name !== undefined && { name: input.name.trim() }),
        ...(input.slug !== undefined && { slug: input.slug.toLowerCase().trim() }),
        ...(input.logoUrl !== undefined && { logoUrl: input.logoUrl }),
        ...(input.tagline !== undefined && { tagline: input.tagline }),
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

    return this.mapToDTO(updated);
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
