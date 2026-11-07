import { z } from 'zod';
import { SubscriptionStatus, SubscriptionBillingInterval, SubscriptionTier } from '@prisma/client';

export { SubscriptionStatus, SubscriptionBillingInterval, SubscriptionTier };

export interface SubscriptionPlanItem {
  id: string;
  slug: string;
  name: string;
  tier: SubscriptionTier;
  description: string | null;
  price: number;
  currency: string;
  interval: SubscriptionBillingInterval;
  stripePriceId?: string | null;
  stripeProductId?: string | null;
  isActive: boolean;
  limits: {
    maxMembers: number;
    maxCustomers: number;
    maxProjects: number;
    maxServices: number;
  };
  features: {
    hasFlowRules: boolean;
    hasCustomDomain: boolean;
    hasAnalytics: boolean;
    hasRecurring: boolean;
    hasClientPortal: boolean;
  };
}

export interface SubscriptionUsageMetrics {
  members: {
    current: number;
    limit: number;
    percentage: number;
    exceeded: boolean;
  };
  customers: {
    current: number;
    limit: number;
    percentage: number;
    exceeded: boolean;
  };
  projects: {
    current: number;
    limit: number;
    percentage: number;
    exceeded: boolean;
  };
  services: {
    current: number;
    limit: number;
    percentage: number;
    exceeded: boolean;
  };
}

export interface OrganizationSubscriptionResponse {
  id: string;
  organizationId: string;
  status: SubscriptionStatus;
  billingInterval: SubscriptionBillingInterval;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  trialEndsAt: string | null;
  canceledAt: string | null;
  cancelAtPeriodEnd: boolean;
  plan: SubscriptionPlanItem;
  usage: SubscriptionUsageMetrics;
  isOwner: boolean;
}

export interface SubscriptionBillingHistoryItem {
  id: string;
  amount: number;
  currency: string;
  status: string;
  stripeInvoiceId: string | null;
  invoicePdfUrl: string | null;
  paidAt: string | null;
  billingPeriodStart: string | null;
  billingPeriodEnd: string | null;
  createdAt: string;
}

export const CreateCheckoutSessionSchema = z.object({
  planSlug: z.string().min(1, 'Plan slug is required'),
  billingInterval: z.enum(['MONTHLY', 'ANNUALLY']).default('MONTHLY'),
  successUrl: z.string().url().optional(),
  cancelUrl: z.string().url().optional(),
});

export type CreateCheckoutSessionInput = z.infer<typeof CreateCheckoutSessionSchema>;

export const ChangePlanSchema = z.object({
  planSlug: z.string().min(1, 'Plan slug is required'),
  billingInterval: z.enum(['MONTHLY', 'ANNUALLY']).default('MONTHLY'),
});

export type ChangePlanInput = z.infer<typeof ChangePlanSchema>;

export const CancelSubscriptionSchema = z.object({
  immediately: z.boolean().default(false),
});

export type CancelSubscriptionInput = z.infer<typeof CancelSubscriptionSchema>;

export const CreateCustomerPortalSessionSchema = z.object({
  returnUrl: z.string().url().optional(),
  flowType: z.enum(['payment_method_update', 'invoices', 'default']).default('default'),
});

export type CreateCustomerPortalSessionInput = z.infer<typeof CreateCustomerPortalSessionSchema>;
