import {
  SubscriptionPlanItem,
  SubscriptionBillingInterval,
  SubscriptionTier,
} from './subscription.types.js';

export const STANDARD_SUBSCRIPTION_PLANS: SubscriptionPlanItem[] = [
  // 1. STARTER TIER
  {
    id: 'plan_starter_monthly',
    slug: 'starter-monthly',
    name: 'Starter',
    tier: SubscriptionTier.STARTER,
    description:
      'Essential business operations foundation for solo practitioners and micro-studios.',
    price: 0,
    currency: 'USD',
    interval: SubscriptionBillingInterval.MONTHLY,
    stripePriceId: null,
    stripeProductId: null,
    isActive: true,
    limits: {
      maxMembers: 3,
      maxCustomers: 50,
      maxProjects: 5,
      maxServices: 10,
    },
    features: {
      hasFlowRules: true,
      hasCustomDomain: false,
      hasAnalytics: true,
      hasRecurring: true,
      hasClientPortal: true,
    },
  },
  {
    id: 'plan_starter_annually',
    slug: 'starter-annually',
    name: 'Starter',
    tier: SubscriptionTier.STARTER,
    description:
      'Essential business operations foundation for solo practitioners and micro-studios.',
    price: 0,
    currency: 'USD',
    interval: SubscriptionBillingInterval.ANNUALLY,
    stripePriceId: null,
    stripeProductId: null,
    isActive: true,
    limits: {
      maxMembers: 3,
      maxCustomers: 50,
      maxProjects: 5,
      maxServices: 10,
    },
    features: {
      hasFlowRules: true,
      hasCustomDomain: false,
      hasAnalytics: true,
      hasRecurring: true,
      hasClientPortal: true,
    },
  },

  // 2. PROFESSIONAL TIER
  {
    id: 'plan_pro_monthly',
    slug: 'pro-monthly',
    name: 'Professional',
    tier: SubscriptionTier.PRO,
    description:
      'Advanced automations, custom domains, and scalable capacity for growing agencies.',
    price: 49,
    currency: 'USD',
    interval: SubscriptionBillingInterval.MONTHLY,
    stripePriceId: process.env.STRIPE_PRICE_PRO_MONTHLY || 'price_flowpilot_pro_monthly',
    stripeProductId: process.env.STRIPE_PRODUCT_PRO || 'prod_flowpilot_pro',
    isActive: true,
    limits: {
      maxMembers: 10,
      maxCustomers: 500,
      maxProjects: 25,
      maxServices: 50,
    },
    features: {
      hasFlowRules: true,
      hasCustomDomain: true,
      hasAnalytics: true,
      hasRecurring: true,
      hasClientPortal: true,
    },
  },
  {
    id: 'plan_pro_annually',
    slug: 'pro-annually',
    name: 'Professional',
    tier: SubscriptionTier.PRO,
    description:
      'Advanced automations, custom domains, and scalable capacity for growing agencies (20% discount).',
    price: 39 * 12, // $468 billed annually ($39/mo)
    currency: 'USD',
    interval: SubscriptionBillingInterval.ANNUALLY,
    stripePriceId: process.env.STRIPE_PRICE_PRO_ANNUALLY || 'price_flowpilot_pro_annually',
    stripeProductId: process.env.STRIPE_PRODUCT_PRO || 'prod_flowpilot_pro',
    isActive: true,
    limits: {
      maxMembers: 10,
      maxCustomers: 500,
      maxProjects: 25,
      maxServices: 50,
    },
    features: {
      hasFlowRules: true,
      hasCustomDomain: true,
      hasAnalytics: true,
      hasRecurring: true,
      hasClientPortal: true,
    },
  },

  // 3. ENTERPRISE TIER
  {
    id: 'plan_enterprise_monthly',
    slug: 'enterprise-monthly',
    name: 'Enterprise',
    tier: SubscriptionTier.ENTERPRISE,
    description:
      'Unlimited capacity, highest priority support, and multi-team operational infrastructure.',
    price: 149,
    currency: 'USD',
    interval: SubscriptionBillingInterval.MONTHLY,
    stripePriceId:
      process.env.STRIPE_PRICE_ENTERPRISE_MONTHLY || 'price_flowpilot_enterprise_monthly',
    stripeProductId: process.env.STRIPE_PRODUCT_ENTERPRISE || 'prod_flowpilot_enterprise',
    isActive: true,
    limits: {
      maxMembers: 999,
      maxCustomers: 50000,
      maxProjects: 1000,
      maxServices: 500,
    },
    features: {
      hasFlowRules: true,
      hasCustomDomain: true,
      hasAnalytics: true,
      hasRecurring: true,
      hasClientPortal: true,
    },
  },
  {
    id: 'plan_enterprise_annually',
    slug: 'enterprise-annually',
    name: 'Enterprise',
    tier: SubscriptionTier.ENTERPRISE,
    description:
      'Unlimited capacity, highest priority support, and multi-team operational infrastructure (20% discount).',
    price: 119 * 12, // $1428 billed annually ($119/mo)
    currency: 'USD',
    interval: SubscriptionBillingInterval.ANNUALLY,
    stripePriceId:
      process.env.STRIPE_PRICE_ENTERPRISE_ANNUALLY || 'price_flowpilot_enterprise_annually',
    stripeProductId: process.env.STRIPE_PRODUCT_ENTERPRISE || 'prod_flowpilot_enterprise',
    isActive: true,
    limits: {
      maxMembers: 999,
      maxCustomers: 50000,
      maxProjects: 1000,
      maxServices: 500,
    },
    features: {
      hasFlowRules: true,
      hasCustomDomain: true,
      hasAnalytics: true,
      hasRecurring: true,
      hasClientPortal: true,
    },
  },
];

/**
 * Returns default plan for any organization that does not have an active subscription yet
 */
export function getDefaultSubscriptionPlan(): SubscriptionPlanItem {
  return STANDARD_SUBSCRIPTION_PLANS[0]!; // starter-monthly
}

/**
 * Look up a plan by its unique slug
 */
export function findPlanBySlug(slug: string): SubscriptionPlanItem | undefined {
  return STANDARD_SUBSCRIPTION_PLANS.find((p) => p.slug === slug);
}

/**
 * Look up a plan by its tier and interval
 */
export function findPlanByTierAndInterval(
  tier: SubscriptionTier,
  interval: SubscriptionBillingInterval,
): SubscriptionPlanItem | undefined {
  return STANDARD_SUBSCRIPTION_PLANS.find((p) => p.tier === tier && p.interval === interval);
}
