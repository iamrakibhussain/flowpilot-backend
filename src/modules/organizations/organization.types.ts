import { z } from 'zod';

export const organizationRoleSchema = z.enum(['OWNER', 'ADMIN', 'MEMBER', 'BILLING']);
export type OrganizationRole = z.infer<typeof organizationRoleSchema>;

export const createOrganizationSchema = z.object({
  name: z.string().min(2, 'Organization name must be at least 2 characters').max(100),
  slug: z
    .string()
    .min(2)
    .max(50)
    .regex(/^[a-z0-9-]+$/, 'Slug must only contain lowercase alphanumeric characters and hyphens'),
});

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;

export const checkSlugSchema = z.object({
  slug: z
    .string()
    .min(2, 'Slug must be at least 2 characters')
    .max(50, 'Slug cannot exceed 50 characters')
    .regex(/^[a-z0-9-]+$/, 'Slug can only contain lowercase letters, numbers, and hyphens'),
});

export type CheckSlugInput = z.infer<typeof checkSlugSchema>;

export const updateOrganizationSettingsSchema = z.object({
  name: z.string().min(2, 'Organization name must be at least 2 characters').max(100).optional(),
  slug: z
    .string()
    .min(2, 'Slug must be at least 2 characters')
    .max(50, 'Slug cannot exceed 50 characters')
    .regex(/^[a-z0-9-]+$/, 'Slug can only contain lowercase letters, numbers, and hyphens')
    .optional(),
  logoUrl: z.string().max(200000, 'Logo URL or data payload too large').nullable().optional(),
  tagline: z.string().max(200).nullable().optional(),
  contactEmail: z.union([z.string().email(), z.literal(''), z.null()]).optional(),
  contactPhone: z.string().max(30).nullable().optional(),
  address: z.string().max(300).nullable().optional(),
  bookingEnabled: z.boolean().optional(),
  bookingTitle: z.string().max(150).nullable().optional(),
  bookingNotice: z.string().max(1000).nullable().optional(),
  currency: z
    .string()
    .min(3)
    .max(3)
    .transform((val) => val.toUpperCase())
    .optional(),
  timezone: z.string().min(2).max(100).optional(),
  taxId: z.string().max(50).nullable().optional(),
  defaultTaxRate: z.number().min(0).max(100).optional(),
  defaultPaymentTerms: z.enum(['DUE_ON_RECEIPT', 'NET_7', 'NET_15', 'NET_30', 'NET_60']).optional(),
  invoiceFooter: z.string().max(1000).nullable().optional(),
  bankName: z.string().max(100).nullable().optional(),
  bankAccount: z.string().max(50).nullable().optional(),
  bankRouting: z.string().max(50).nullable().optional(),
  bankSwift: z.string().max(50).nullable().optional(),
  minNoticeHours: z.number().int().min(0).max(168).optional(),
  maxHorizonDays: z.number().int().min(1).max(365).optional(),
  cancellationHours: z.number().int().min(0).max(168).optional(),
  autoConfirmBookings: z.boolean().optional(),
});

export type UpdateOrganizationSettingsInput = z.infer<typeof updateOrganizationSettingsSchema>;

export interface OrganizationSettingsDTO {
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
  createdAt: string;
  updatedAt: string;
}
