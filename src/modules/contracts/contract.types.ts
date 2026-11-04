import { z } from 'zod';
import type { ContractStatus } from '@prisma/client';

export const ContractStatusEnum = z.enum([
  'DRAFT',
  'PENDING_SIGNATURE',
  'VIEWED',
  'SIGNED',
  'COUNTERSIGNED',
  'DECLINED',
  'VOIDED',
]);

export interface ListContractsQuery {
  status?: ContractStatus;
  customerId?: string;
  quoteId?: string;
  projectId?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export const createContractSchema = z.object({
  customerId: z.string().uuid({ message: 'Valid customer ID is required' }),
  quoteId: z.string().uuid().optional().nullable(),
  projectId: z.string().uuid().optional().nullable(),
  title: z.string().min(2, { message: 'Title must be at least 2 characters' }).max(200),
  content: z.string().min(10, { message: 'Contract content must be at least 10 characters' }),
  expiresAt: z.string().datetime().optional().nullable(),
});

export type CreateContractInput = z.infer<typeof createContractSchema>;

export const updateContractSchema = z.object({
  customerId: z.string().uuid().optional(),
  quoteId: z.string().uuid().optional().nullable(),
  projectId: z.string().uuid().optional().nullable(),
  title: z.string().min(2).max(200).optional(),
  content: z.string().min(10).optional(),
  expiresAt: z.string().datetime().optional().nullable(),
  status: ContractStatusEnum.optional(),
});

export type UpdateContractInput = z.infer<typeof updateContractSchema>;

export const signContractPublicSchema = z.object({
  signerName: z.string().min(2, { message: 'Signer full name is required' }).max(100),
  signerEmail: z.string().email({ message: 'Valid signer email address is required' }),
  signatureData: z.string().min(10, { message: 'Signature representation is required' }).max(100000),
  signatureType: z.enum(['DRAWN', 'TYPED']).default('DRAWN'),
  clientNotes: z.string().max(1000).optional().nullable(),
  agreedToTerms: z.literal(true, {
    errorMap: () => ({ message: 'You must check the box to confirm legal agreement' }),
  }),
});

export type SignContractPublicInput = z.infer<typeof signContractPublicSchema>;

export const countersignContractSchema = z.object({
  countersignerName: z.string().min(2, { message: 'Countersigner name is required' }).max(100),
  countersignatureData: z.string().min(10, { message: 'Countersignature is required' }).max(100000),
});

export type CountersignContractInput = z.infer<typeof countersignContractSchema>;

export const declineContractSchema = z.object({
  reason: z.string().min(2, { message: 'Decline reason must be at least 2 characters' }).max(500),
});

export type DeclineContractInput = z.infer<typeof declineContractSchema>;

export interface PublicContractStatement {
  id: string;
  contractNumber: string;
  title: string;
  content: string;
  status: ContractStatus;
  issuedAt: string;
  expiresAt: string | null;
  signedAt: string | null;
  signerName: string | null;
  signerEmail: string | null;
  signatureData: string | null;
  signatureType: string | null;
  contentChecksum: string | null;
  countersignedAt: string | null;
  countersignerName: string | null;
  countersignatureData: string | null;
  organization: {
    id: string;
    name: string;
    logoUrl?: string | null;
    brandColor?: string | null;
    contactEmail?: string | null;
    contactPhone?: string | null;
  };
  customer: {
    id: string;
    name: string;
    email: string;
    company?: string | null;
  };
}

