import { prisma } from '../../database/prisma.js';
import { ForbiddenError } from '../../common/errors/app-error.js';
import { SubscriptionPlanItem, SubscriptionUsageMetrics } from './subscription.types.js';
import { getDefaultSubscriptionPlan, findPlanBySlug } from './subscription-plan.registry.js';
import { logger } from '../../common/logging/logger.js';

export type LimitResource = 'members' | 'customers' | 'projects' | 'services';
export type PlanFeature = 'flowRules' | 'customDomain' | 'analytics' | 'recurring' | 'clientPortal';

export class EntitlementService {
  /**
   * Resolves the active subscription plan for an organization.
   * Gracefully falls back to the default Starter plan if no subscription exists
   * or if the subscription table has not been migrated yet.
   */
  public static async getActivePlan(organizationId: string): Promise<SubscriptionPlanItem> {
    try {
      // 1. Try querying the database for active organization subscription
      const sub = await (
        prisma as unknown as {
          organizationSubscription?: {
            findUnique: (args: {
              where: { organizationId: string };
              include: { plan: boolean };
            }) => Promise<{
              status: string;
              planId: string;
              plan?: {
                slug: string;
                name: string;
                tier: string;
                description?: string | null;
                price: unknown;
                currency: string;
                interval: string;
                maxMembers: number;
                maxCustomers: number;
                maxProjects: number;
                maxServices: number;
                hasFlowRules: boolean;
                hasCustomDomain: boolean;
                hasAnalytics: boolean;
                hasRecurring: boolean;
                hasClientPortal: boolean;
              };
            } | null>;
          };
        }
      ).organizationSubscription?.findUnique({
        where: { organizationId },
        include: { plan: true },
      });

      if (sub && sub.status === 'ACTIVE' && sub.plan) {
        const found = findPlanBySlug(sub.plan.slug);
        if (found) return found;

        return {
          id: sub.planId,
          slug: sub.plan.slug,
          name: sub.plan.name,
          tier: sub.plan.tier as unknown as SubscriptionPlanItem['tier'],
          description: sub.plan.description || null,
          price: Number(sub.plan.price) || 0,
          currency: sub.plan.currency,
          interval: sub.plan.interval as unknown as SubscriptionPlanItem['interval'],
          isActive: true,
          limits: {
            maxMembers: sub.plan.maxMembers,
            maxCustomers: sub.plan.maxCustomers,
            maxProjects: sub.plan.maxProjects,
            maxServices: sub.plan.maxServices,
          },
          features: {
            hasFlowRules: sub.plan.hasFlowRules,
            hasCustomDomain: sub.plan.hasCustomDomain,
            hasAnalytics: sub.plan.hasAnalytics,
            hasRecurring: sub.plan.hasRecurring,
            hasClientPortal: sub.plan.hasClientPortal,
          },
        };
      }
    } catch (err) {
      logger.debug(
        { err, organizationId },
        'Failed to read organizationSubscription from database; defaulting to Starter plan',
      );
    }

    // Default safe fallback plan for all organizations
    return getDefaultSubscriptionPlan();
  }

  /**
   * Retrieves live usage counts for an organization from real PostgreSQL records
   */
  public static async getUsageCounts(organizationId: string): Promise<{
    members: number;
    customers: number;
    projects: number;
    services: number;
  }> {
    try {
      const [membersCount, customersCount, projectsCount, servicesCount] = await Promise.all([
        typeof prisma.membership?.count === 'function'
          ? prisma.membership.count({ where: { organizationId } }).catch(() => 0)
          : Promise.resolve(0),
        typeof prisma.customer?.count === 'function'
          ? prisma.customer
              .count({ where: { organizationId, status: { not: 'INACTIVE' } } })
              .catch(() => 0)
          : Promise.resolve(0),
        typeof prisma.project?.count === 'function'
          ? prisma.project
              .count({ where: { organizationId, status: { not: 'CANCELLED' } } })
              .catch(() => 0)
          : Promise.resolve(0),
        typeof prisma.service?.count === 'function'
          ? prisma.service.count({ where: { organizationId, isActive: true } }).catch(() => 0)
          : Promise.resolve(0),
      ]);

      return {
        members: membersCount,
        customers: customersCount,
        projects: projectsCount,
        services: servicesCount,
      };
    } catch {
      return { members: 0, customers: 0, projects: 0, services: 0 };
    }
  }

  /**
   * Generates a complete usage metrics overview against the organization's plan limits
   */
  public static async getUsageOverview(organizationId: string): Promise<SubscriptionUsageMetrics> {
    const [plan, counts] = await Promise.all([
      this.getActivePlan(organizationId),
      this.getUsageCounts(organizationId),
    ]);

    const calculateMetric = (current: number, limit: number) => {
      const percentage = limit > 0 ? Math.min(100, Math.round((current / limit) * 100)) : 0;
      return {
        current,
        limit,
        percentage,
        exceeded: current >= limit,
      };
    };

    return {
      members: calculateMetric(counts.members, plan.limits.maxMembers),
      customers: calculateMetric(counts.customers, plan.limits.maxCustomers),
      projects: calculateMetric(counts.projects, plan.limits.maxProjects),
      services: calculateMetric(counts.services, plan.limits.maxServices),
    };
  }

  /**
   * Checks whether an organization is allowed to create another resource of the given type
   */
  public static async checkLimit(
    organizationId: string,
    resource: LimitResource,
  ): Promise<{
    allowed: boolean;
    currentCount: number;
    limit: number;
  }> {
    const plan = await this.getActivePlan(organizationId);

    let current = 0;
    let limit = 0;

    switch (resource) {
      case 'members':
        current =
          typeof prisma.membership?.count === 'function'
            ? await prisma.membership.count({ where: { organizationId } }).catch(() => 0)
            : 0;
        limit = plan.limits.maxMembers;
        break;
      case 'customers':
        current =
          typeof prisma.customer?.count === 'function'
            ? await prisma.customer
                .count({ where: { organizationId, status: { not: 'INACTIVE' } } })
                .catch(() => 0)
            : 0;
        limit = plan.limits.maxCustomers;
        break;
      case 'projects':
        current =
          typeof prisma.project?.count === 'function'
            ? await prisma.project
                .count({ where: { organizationId, status: { not: 'CANCELLED' } } })
                .catch(() => 0)
            : 0;
        limit = plan.limits.maxProjects;
        break;
      case 'services':
        current =
          typeof prisma.service?.count === 'function'
            ? await prisma.service
                .count({ where: { organizationId, isActive: true } })
                .catch(() => 0)
            : 0;
        limit = plan.limits.maxServices;
        break;
    }

    return {
      allowed: current < limit,
      currentCount: current,
      limit,
    };
  }

  /**
   * Enforces that an organization has not reached its plan limit for a given resource.
   * Throws ForbiddenError if the limit is exceeded.
   */
  public static async enforceLimit(organizationId: string, resource: LimitResource): Promise<void> {
    const check = await this.checkLimit(organizationId, resource);
    if (!check.allowed) {
      const plan = await this.getActivePlan(organizationId);
      throw new ForbiddenError(
        `Your organization has reached the limit of ${check.limit} ${resource} on the ${plan.name} plan. Please upgrade your subscription to add more ${resource}.`,
      );
    }
  }

  /**
   * Checks whether a specific boolean feature is included in the organization's plan
   */
  public static async checkFeature(
    organizationId: string,
    feature: PlanFeature,
  ): Promise<{ allowed: boolean }> {
    const plan = await this.getActivePlan(organizationId);
    let allowed = false;

    switch (feature) {
      case 'flowRules':
        allowed = plan.features.hasFlowRules;
        break;
      case 'customDomain':
        allowed = plan.features.hasCustomDomain;
        break;
      case 'analytics':
        allowed = plan.features.hasAnalytics;
        break;
      case 'recurring':
        allowed = plan.features.hasRecurring;
        break;
      case 'clientPortal':
        allowed = plan.features.hasClientPortal;
        break;
    }

    return { allowed };
  }

  /**
   * Enforces that a feature is included in the organization's plan.
   * Throws ForbiddenError if the feature is not included.
   */
  public static async enforceFeature(organizationId: string, feature: PlanFeature): Promise<void> {
    const check = await this.checkFeature(organizationId, feature);
    if (!check.allowed) {
      const plan = await this.getActivePlan(organizationId);
      throw new ForbiddenError(
        `The feature '${feature}' is not included in the ${plan.name} plan. Please upgrade to Professional or Enterprise to unlock this capability.`,
      );
    }
  }
}
