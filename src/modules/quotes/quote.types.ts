import { z } from 'zod';

export type QuoteStatus = 'DRAFT' | 'SENT' | 'VIEWED' | 'ACCEPTED' | 'DECLINED' | 'EXPIRED';

export const QuoteStatusEnum = z.enum([
  'DRAFT',
  'SENT',
  'VIEWED',
  'ACCEPTED',
  'DECLINED',
  'EXPIRED',
]);

export interface ListQuotesQuery {
  status?: QuoteStatus;
  customerId?: string;
  startDate?: string;
  endDate?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export interface QuoteItemInput {
  serviceId?: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
  sortOrder?: number;
}

export interface CreateQuoteInput {
  customerId?: string;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  customerCompany?: string;
  title?: string;
  introduction?: string | null;
  items: QuoteItemInput[];
  taxRate?: number;
  discountType?: 'FIXED' | 'PERCENT';
  discountAmount?: number;
  expiresAt?: string | null;
  terms?: string | null;
  notes?: string | null;
  status?: QuoteStatus;
}

export interface UpdateQuoteInput {
  customerId?: string;
  title?: string;
  introduction?: string | null;
  items?: QuoteItemInput[];
  taxRate?: number;
  discountType?: 'FIXED' | 'PERCENT';
  discountAmount?: number;
  expiresAt?: string | null;
  terms?: string | null;
  notes?: string | null;
  status?: QuoteStatus;
}

export interface QuoteItemDto {
  id: string;
  serviceId: string | null;
  serviceName?: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  sortOrder: number;
}

export interface QuoteListItem {
  id: string;
  organizationId: string;
  customerId: string;
  customerName: string;
  customerEmail: string;
  customerCompany: string | null;
  customerPhone: string | null;
  quoteNumber: string;
  title: string;
  status: QuoteStatus;
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  discountType: string;
  discountAmount: number;
  totalAmount: number;
  issuedAt: string;
  expiresAt: string | null;
  viewedAt: string | null;
  acceptedAt: string | null;
  declinedAt: string | null;
  signerName: string | null;
  signerEmail: string | null;
  convertedInvoiceId: string | null;
  convertedInvoiceNumber?: string | null;
  itemsCount: number;
  items: QuoteItemDto[];
  publicToken?: string | null;
  isExpired: boolean;
}

export interface QuoteDetailResponse extends QuoteListItem {
  introduction: string | null;
  terms: string | null;
  notes: string | null;
  signatureData: string | null;
  clientNotes: string | null;
  signerIp: string | null;
  organization: {
    id: string;
    name: string;
    slug: string;
    brandColor: string | null;
    logoUrl?: string | null;
    contactEmail: string | null;
    contactPhone: string | null;
    address: string | null;
    currency: string;
  };
}

export interface QuoteStatsResponse {
  totalEstimatedValue: number;
  acceptedValue: number;
  pendingReviewValue: number;
  acceptanceRate: number;
  counts: {
    total: number;
    draft: number;
    sent: number;
    viewed: number;
    accepted: number;
    declined: number;
    expired: number;
  };
}

export interface AcceptQuoteInput {
  signerName: string;
  signerEmail?: string | null;
  signatureData: string; // Base64 or typed name
  clientNotes?: string | null;
}

export interface DeclineQuoteInput {
  reason?: string | null;
}

// Zod validation schemas
export const quoteItemSchema = z.object({
  serviceId: z
    .string()
    .uuid()
    .nullable()
    .optional()
    .or(z.literal(''))
    .transform((val) => (val && val.length > 0 ? val : null)),
  description: z.string().trim().min(1, 'Item description is required').max(300),
  quantity: z.coerce.number().int().min(1, 'Quantity must be at least 1').max(10000).default(1),
  unitPrice: z.coerce.number().min(0, 'Unit price cannot be negative'),
  sortOrder: z.coerce.number().int().optional().default(0),
});

export const createQuoteSchema = z.object({
  customerId: z
    .string()
    .uuid()
    .nullable()
    .optional()
    .or(z.literal(''))
    .transform((val) => (val && val.length > 0 ? val : undefined)),
  customerName: z
    .string()
    .trim()
    .min(1, 'Customer name is required')
    .nullable()
    .optional()
    .or(z.literal(''))
    .transform((val) => (val && val.length > 0 ? val : undefined)),
  customerEmail: z
    .string()
    .email('Invalid email address')
    .nullable()
    .optional()
    .or(z.literal(''))
    .transform((val) => (val && val.length > 0 ? val : undefined)),
  customerPhone: z
    .string()
    .trim()
    .max(30)
    .nullable()
    .optional()
    .or(z.literal(''))
    .transform((val) => (val && val.length > 0 ? val : undefined)),
  customerCompany: z
    .string()
    .trim()
    .max(100)
    .nullable()
    .optional()
    .or(z.literal(''))
    .transform((val) => (val && val.length > 0 ? val : undefined)),
  title: z
    .string()
    .trim()
    .min(2, 'Title must be at least 2 characters')
    .max(200)
    .default('Service Proposal & Estimate'),
  introduction: z
    .string()
    .trim()
    .max(2000)
    .nullable()
    .optional()
    .or(z.literal(''))
    .transform((val) => (val && val.length > 0 ? val : null)),
  items: z.array(quoteItemSchema).min(1, 'At least one item is required'),
  taxRate: z.coerce.number().min(0).max(100).default(0),
  discountType: z.enum(['FIXED', 'PERCENT']).default('FIXED'),
  discountAmount: z.coerce.number().min(0).default(0),
  expiresAt: z
    .string()
    .datetime()
    .nullable()
    .optional()
    .or(z.literal(''))
    .transform((val) => (val && val.length > 0 ? val : null)),
  terms: z
    .string()
    .trim()
    .max(3000)
    .nullable()
    .optional()
    .or(z.literal(''))
    .transform((val) => (val && val.length > 0 ? val : null)),
  notes: z
    .string()
    .trim()
    .max(2000)
    .nullable()
    .optional()
    .or(z.literal(''))
    .transform((val) => (val && val.length > 0 ? val : null)),
  status: QuoteStatusEnum.default('DRAFT'),
});

export const updateQuoteSchema = z.object({
  customerId: z
    .string()
    .uuid()
    .nullable()
    .optional()
    .or(z.literal(''))
    .transform((val) => (val && val.length > 0 ? val : undefined)),
  title: z.string().trim().min(2).max(200).optional(),
  introduction: z
    .string()
    .trim()
    .max(2000)
    .nullable()
    .optional()
    .or(z.literal(''))
    .transform((val) => (val && val.length > 0 ? val : null)),
  items: z.array(quoteItemSchema).min(1).optional(),
  taxRate: z.coerce.number().min(0).max(100).optional(),
  discountType: z.enum(['FIXED', 'PERCENT']).optional(),
  discountAmount: z.coerce.number().min(0).optional(),
  expiresAt: z
    .string()
    .datetime()
    .nullable()
    .optional()
    .or(z.literal(''))
    .transform((val) => (val && val.length > 0 ? val : null)),
  terms: z
    .string()
    .trim()
    .max(3000)
    .nullable()
    .optional()
    .or(z.literal(''))
    .transform((val) => (val && val.length > 0 ? val : null)),
  notes: z
    .string()
    .trim()
    .max(2000)
    .nullable()
    .optional()
    .or(z.literal(''))
    .transform((val) => (val && val.length > 0 ? val : null)),
  status: QuoteStatusEnum.optional(),
});

export const acceptQuoteSchema = z.object({
  signerName: z.string().trim().min(2, 'Signer name is required').max(100),
  signerEmail: z.string().email('Valid email is required').optional().nullable(),
  signatureData: z.string().min(5, 'Digital signature is required'),
  clientNotes: z.string().trim().max(1000).optional().nullable(),
});

export const declineQuoteSchema = z.object({
  reason: z.string().trim().max(1000).optional().nullable(),
});
