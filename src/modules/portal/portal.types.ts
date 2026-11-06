import { z } from 'zod';

export const requestPortalLinkSchema = z.object({
  email: z
    .string()
    .email('Please enter a valid email address')
    .transform((v) => v.toLowerCase().trim()),
  organizationSlug: z.string().min(1, 'Organization slug is required').trim(),
});

export type RequestPortalLinkInput = z.infer<typeof requestPortalLinkSchema>;

export const verifyPortalTokenSchema = z
  .object({
    organizationSlug: z.string().min(1, 'Organization slug is required').trim(),
    token: z.string().min(16).optional(),
    code: z.string().length(6, 'Verification code must be 6 digits').optional(),
  })
  .refine((data) => data.token || data.code, {
    message: 'Either magic token or 6-digit verification code is required',
    path: ['token'],
  });

export type VerifyPortalTokenInput = z.infer<typeof verifyPortalTokenSchema>;

export const rescheduleAppointmentSchema = z.object({
  newScheduledAt: z.string().datetime({ message: 'Valid ISO 8601 datetime required' }),
});

export type RescheduleAppointmentInput = z.infer<typeof rescheduleAppointmentSchema>;

export const cancelAppointmentSchema = z.object({
  reason: z.string().min(3, 'Cancellation reason must be at least 3 characters').max(500),
});

export type CancelAppointmentInput = z.infer<typeof cancelAppointmentSchema>;

export const updatePortalProfileSchema = z.object({
  name: z.string().min(1, 'Name cannot be empty').max(100).optional(),
  phone: z.string().max(20).optional().nullable(),
  company: z.string().max(100).optional().nullable(),
});

export type UpdatePortalProfileInput = z.infer<typeof updatePortalProfileSchema>;

export const signPortalContractSchema = z.object({
  signerName: z.string().min(1, 'Full legal name is required').max(100).trim(),
  signerEmail: z
    .string()
    .email('Valid email address is required')
    .toLowerCase()
    .trim(),
  signatureData: z.string().min(10, 'Signature drawing or representation is required'),
  signatureType: z.enum(['CANVAS', 'TYPED']).default('CANVAS'),
  clientNotes: z.string().max(500).optional().nullable(),
});

export type SignPortalContractInput = z.infer<typeof signPortalContractSchema>;

export const acceptPortalQuoteSchema = z.object({
  signerName: z.string().min(1, 'Signer name is required').max(100).trim(),
  signerEmail: z.string().email('Valid email is required').toLowerCase().trim().optional(),
  signatureData: z.string().optional().nullable(),
  clientNotes: z.string().max(500).optional().nullable(),
});

export type AcceptPortalQuoteInput = z.infer<typeof acceptPortalQuoteSchema>;

export interface PortalContractSummary {
  id: string;
  contractNumber: string;
  title: string;
  content: string;
  status: string;
  issuedAt: string;
  expiresAt: string | null;
  viewedAt: string | null;
  signedAt: string | null;
  signerName: string | null;
  signerEmail: string | null;
  signatureData: string | null;
  signatureType: string | null;
  contentChecksum: string | null;
  countersignedAt: string | null;
  countersignerName: string | null;
  quoteId: string | null;
  projectId: string | null;
}

export interface PortalNotificationSummary {
  id: string;
  type: string;
  title: string;
  message: string;
  actionUrl: string | null;
  isRead: boolean;
  createdAt: string;
}

export interface PortalQuoteSummary {
  id: string;
  quoteNumber: string;
  title: string;
  status: string;
  subtotal: number;
  taxAmount: number;
  discountAmount: number;
  totalAmount: number;
  issuedAt: string;
  expiresAt: string | null;
  acceptedAt: string | null;
  declinedAt: string | null;
  notes: string | null;
  itemsCount: number;
}

export interface PortalProjectSummary {
  id: string;
  name: string;
  description: string | null;
  status: string;
  color: string;
  startDate: string | null;
  targetDate: string | null;
  completedAt: string | null;
  budget: number | null;
  currency: string;
  tasksCount: number;
  completedTasksCount: number;
  progressPercentage: number;
}
