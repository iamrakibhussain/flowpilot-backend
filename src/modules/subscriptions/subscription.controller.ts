import { Request, Response, NextFunction } from 'express';
import { SubscriptionService } from './subscription.service.js';
import { EntitlementService } from './entitlement.service.js';
import {
  CreateCheckoutSessionSchema,
  ChangePlanSchema,
  CancelSubscriptionSchema,
  CreateCustomerPortalSessionSchema,
} from './subscription.types.js';
import { BadRequestError, UnauthorizedError } from '../../common/errors/app-error.js';
import { sendSuccess } from '../../common/http/response.js';

export class SubscriptionController {
  /**
   * GET /api/v1/subscriptions/plans
   * Available to all authenticated users
   */
  public static async getPlans(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const plans = await SubscriptionService.getPlans();
      sendSuccess(res, plans);
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/v1/subscriptions/current
   * Tenant-scoped: returns active plan, subscription state, and real-time usage
   */
  public static async getCurrentSubscription(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const organizationId = req.tenant?.organizationId;
      const currentUserId = req.user?.id;

      if (!organizationId || !currentUserId) {
        throw new UnauthorizedError('Organization and user context required');
      }

      const subscription = await SubscriptionService.getCurrentSubscription(
        organizationId,
        currentUserId,
      );
      sendSuccess(res, subscription);
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/v1/subscriptions/usage
   * Tenant-scoped: returns resource counts vs hard plan limits
   */
  public static async getUsage(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant?.organizationId;
      if (!organizationId) {
        throw new UnauthorizedError('Organization context required');
      }

      const usage = await EntitlementService.getUsageOverview(organizationId);
      sendSuccess(res, usage);
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/v1/subscriptions/checkout
   * Tenant-scoped: OWNER only — initiate Stripe Checkout session
   */
  public static async createCheckoutSession(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const organizationId = req.tenant?.organizationId;
      const currentUserId = req.user?.id;

      if (!organizationId || !currentUserId) {
        throw new UnauthorizedError('Organization and user context required');
      }

      const parsed = CreateCheckoutSessionSchema.safeParse(req.body);
      if (!parsed.success) {
        const errorMsg = parsed.error.errors
          .map((e) => `${e.path.join('.')}: ${e.message}`)
          .join(', ');
        throw new BadRequestError(`Invalid checkout request: ${errorMsg}`);
      }

      const result = await SubscriptionService.createCheckoutSession(
        organizationId,
        currentUserId,
        parsed.data,
      );

      sendSuccess(res, result);
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/v1/subscriptions/portal
   * Tenant-scoped: OWNER only — access Stripe billing portal
   */
  public static async createPortalSession(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const organizationId = req.tenant?.organizationId;
      const currentUserId = req.user?.id;

      if (!organizationId || !currentUserId) {
        throw new UnauthorizedError('Organization and user context required');
      }

      const parsed = CreateCustomerPortalSessionSchema.safeParse(req.body || {});
      const returnUrl = parsed.success ? parsed.data.returnUrl : undefined;
      const flowType = parsed.success ? parsed.data.flowType : undefined;

      const result = await SubscriptionService.createCustomerPortalSession(
        organizationId,
        currentUserId,
        returnUrl,
        flowType,
      );

      sendSuccess(res, result);
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/v1/subscriptions/change-plan
   * Tenant-scoped: OWNER only — upgrade or downgrade subscription
   */
  public static async changePlan(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant?.organizationId;
      const currentUserId = req.user?.id;

      if (!organizationId || !currentUserId) {
        throw new UnauthorizedError('Organization and user context required');
      }

      const parsed = ChangePlanSchema.safeParse(req.body);
      if (!parsed.success) {
        const errorMsg = parsed.error.errors
          .map((e) => `${e.path.join('.')}: ${e.message}`)
          .join(', ');
        throw new BadRequestError(`Invalid plan change request: ${errorMsg}`);
      }

      const updated = await SubscriptionService.changePlan(
        organizationId,
        currentUserId,
        parsed.data,
      );

      sendSuccess(res, updated);
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/v1/subscriptions/cancel
   * Tenant-scoped: OWNER only — cancel subscription
   */
  public static async cancelSubscription(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const organizationId = req.tenant?.organizationId;
      const currentUserId = req.user?.id;

      if (!organizationId || !currentUserId) {
        throw new UnauthorizedError('Organization and user context required');
      }

      const parsed = CancelSubscriptionSchema.safeParse(req.body);
      const input = parsed.success ? parsed.data : { immediately: false };

      const updated = await SubscriptionService.cancelSubscription(
        organizationId,
        currentUserId,
        input,
      );

      sendSuccess(res, updated);
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/v1/subscriptions/resume
   * Tenant-scoped: OWNER only — resume canceled subscription before period end
   */
  public static async resumeSubscription(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const organizationId = req.tenant?.organizationId;
      const currentUserId = req.user?.id;

      if (!organizationId || !currentUserId) {
        throw new UnauthorizedError('Organization and user context required');
      }

      const updated = await SubscriptionService.resumeSubscription(organizationId, currentUserId);

      sendSuccess(res, updated);
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/v1/subscriptions/billing-history
   * Tenant-scoped: OWNER or ADMIN — past invoice and billing receipts
   */
  public static async getBillingHistory(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const organizationId = req.tenant?.organizationId;
      const currentUserId = req.user?.id;

      if (!organizationId || !currentUserId) {
        throw new UnauthorizedError('Organization and user context required');
      }

      const history = await SubscriptionService.getBillingHistory(organizationId, currentUserId);

      sendSuccess(res, history);
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/v1/subscriptions/webhook
   * Public webhook endpoint for Stripe events
   */
  public static async handleWebhook(
    req: Request & { rawBody?: Buffer },
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const signature = req.headers['stripe-signature'] as string | undefined;
      const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body));

      const result = await SubscriptionService.handleWebhook(rawBody, signature);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }
}
