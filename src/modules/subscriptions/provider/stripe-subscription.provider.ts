import Stripe from 'stripe';
import { env } from '../../../config/env.js';
import { logger } from '../../../common/logging/logger.js';
import { BadRequestError } from '../../../common/errors/app-error.js';

export interface CreateCustomerParams {
  organizationId: string;
  organizationName: string;
  email: string;
}

export interface CreateCheckoutSessionParams {
  customerId?: string;
  customerEmail?: string;
  organizationId: string;
  organizationName: string;
  planSlug: string;
  priceId?: string | null;
  billingInterval: string;
  successUrl: string;
  cancelUrl: string;
  planPrice?: number;
  planName?: string;
  planDescription?: string | null;
}

export interface CreatePortalSessionParams {
  customerId: string;
  returnUrl: string;
  flowType?: 'payment_method_update' | 'invoices' | 'default';
}

export class StripeSubscriptionProvider {
  private static stripeClient: Stripe | null = null;

  private static getClient(): Stripe | null {
    if (!this.stripeClient && env.STRIPE_SECRET_KEY) {
      this.stripeClient = new Stripe(env.STRIPE_SECRET_KEY, {
        apiVersion: '2025-02-24.acacia' as Stripe.LatestApiVersion,
        typescript: true,
      });
    }
    return this.stripeClient;
  }

  /**
   * Create or fetch a Stripe customer for an organization
   */
  public static async createCustomer(params: CreateCustomerParams): Promise<string> {
    const client = this.getClient();
    if (!client) {
      if (env.NODE_ENV === 'production') {
        throw new BadRequestError('Stripe payment provider is not configured in production');
      }
      // Mock provider fallback
      const mockCustomerId = `cus_mock_${params.organizationId.replace(/-/g, '').slice(0, 14)}`;
      logger.info(
        { organizationId: params.organizationId, mockCustomerId },
        'Stripe provider running in mock mode: generated mock customer ID',
      );
      return mockCustomerId;
    }

    try {
      // 1. Check if customer for this organization already exists in Stripe
      try {
        const search = await client.customers.search({
          query: `metadata['organizationId']:'${params.organizationId}'`,
          limit: 1,
        });
        if (search.data && search.data.length > 0 && search.data[0]?.id) {
          return search.data[0].id;
        }
      } catch {
        // Fall back to creating if search is unavailable
      }

      const customer = await client.customers.create({
        name: params.organizationName,
        email: params.email,
        metadata: {
          organizationId: params.organizationId,
          source: 'FlowPilot SaaS Subscription',
        },
      });
      return customer.id;
    } catch (err) {
      logger.error(
        { err, organizationId: params.organizationId },
        'Failed to create Stripe customer',
      );
      throw new BadRequestError('Failed to initialize billing account with payment provider');
    }
  }

  /**
   * Create a checkout session for starting or upgrading a subscription
   */
  public static async createCheckoutSession(
    params: CreateCheckoutSessionParams,
  ): Promise<{ url: string; sessionId: string }> {
    const client = this.getClient();

    if (!client) {
      if (env.NODE_ENV === 'production') {
        throw new BadRequestError('Stripe payment provider is not configured in production');
      }

      // Mock / Dev fallback (only allowed when Stripe client is unconfigured in development/test)
      const mockSessionId = `cs_mock_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      const separator = params.successUrl.includes('?') ? '&' : '?';
      const mockUrl = `${params.successUrl}${separator}mock_checkout=success&session_id=${mockSessionId}&plan=${params.planSlug}`;

      logger.info(
        { organizationId: params.organizationId, planSlug: params.planSlug, mockSessionId },
        'Stripe provider running in mock mode: generated mock checkout session',
      );

      return {
        url: mockUrl,
        sessionId: mockSessionId,
      };
    }

    // Determine line item:
    // If a valid Stripe-generated Price ID is supplied (starts with price_1), use it.
    // Otherwise, generate a valid Stripe subscription using approved server-side plan price_data.
    let lineItem: Stripe.Checkout.SessionCreateParams.LineItem;
    const isRealStripePriceId =
      typeof params.priceId === 'string' && params.priceId.startsWith('price_1');

    if (isRealStripePriceId) {
      lineItem = {
        price: params.priceId as string,
        quantity: 1,
      };
    } else {
      const unitAmount = Math.round((params.planPrice ?? 0) * 100);
      if (unitAmount <= 0) {
        throw new BadRequestError(
          `Cannot create checkout session for free plan '${params.planSlug}'`,
        );
      }
      lineItem = {
        price_data: {
          currency: 'usd',
          unit_amount: unitAmount,
          recurring: {
            interval: params.billingInterval === 'ANNUALLY' ? 'year' : 'month',
          },
          product_data: {
            name: `FlowPilot ${params.planName || 'Professional'} Plan`,
            description: params.planDescription || undefined,
          },
        },
        quantity: 1,
      };
    }

    try {
      const session = await client.checkout.sessions.create({
        mode: 'subscription',
        customer: params.customerId,
        customer_email: params.customerId ? undefined : params.customerEmail,
        client_reference_id: params.organizationId,
        line_items: [lineItem],
        success_url: params.successUrl,
        cancel_url: params.cancelUrl,
        metadata: {
          organizationId: params.organizationId,
          planSlug: params.planSlug,
          billingInterval: params.billingInterval,
        },
        subscription_data: {
          metadata: {
            organizationId: params.organizationId,
            planSlug: params.planSlug,
          },
        },
        allow_promotion_codes: true,
      });

      return {
        url: session.url || params.successUrl,
        sessionId: session.id,
      };
    } catch (err: unknown) {
      logger.error(
        { err, organizationId: params.organizationId, planSlug: params.planSlug },
        'Failed to create Stripe checkout session',
      );
      throw new BadRequestError('Failed to initiate subscription checkout with payment provider');
    }
  }

  /**
   * Create a Stripe Billing Customer Portal session
   */
  public static async createCustomerPortalSession(
    params: CreatePortalSessionParams,
  ): Promise<string> {
    const client = this.getClient();
    if (!client) {
      if (env.NODE_ENV === 'production') {
        throw new BadRequestError('Stripe billing portal is not configured in production');
      }
      return `${params.returnUrl}${params.returnUrl.includes('?') ? '&' : '?'}portal_mock=true`;
    }

    if (params.customerId.startsWith('cus_mock_')) {
      if (env.NODE_ENV === 'production') {
        throw new BadRequestError(
          'Mock customer cannot access Stripe billing portal in production',
        );
      }
      return `${params.returnUrl}${params.returnUrl.includes('?') ? '&' : '?'}portal_mock=true`;
    }

    try {
      const createParams: Stripe.BillingPortal.SessionCreateParams = {
        customer: params.customerId,
        return_url: params.returnUrl,
      };

      if (params.flowType === 'payment_method_update') {
        createParams.flow_data = {
          type: 'payment_method_update',
        };
      }

      const session = await client.billingPortal.sessions.create(createParams);
      return session.url;
    } catch (err) {
      logger.error(
        { err, customerId: params.customerId },
        'Failed to create customer portal session',
      );
      throw new BadRequestError('Failed to access payment provider billing portal');
    }
  }

  /**
   * Retrieve an existing Stripe checkout session to verify payment completion
   */
  public static async retrieveCheckoutSession(
    sessionId: string,
  ): Promise<Stripe.Checkout.Session | null> {
    const client = this.getClient();
    if (!client) {
      return null;
    }
    try {
      return await client.checkout.sessions.retrieve(sessionId);
    } catch (err) {
      logger.error({ err, sessionId }, 'Failed to retrieve Stripe checkout session');
      return null;
    }
  }

  /**
   * Cancel or schedule cancellation for a Stripe subscription
   */
  public static async cancelSubscription(params: {
    subscriptionId: string;
    immediately?: boolean;
  }): Promise<void> {
    const client = this.getClient();
    if (!client) {
      if (env.NODE_ENV === 'production') {
        throw new BadRequestError('Stripe payment provider is not configured in production');
      }
      return;
    }

    if (params.subscriptionId.startsWith('sub_mock_')) {
      if (env.NODE_ENV === 'production') {
        throw new BadRequestError('Mock subscription cannot be processed in production');
      }
      logger.info(
        { subscriptionId: params.subscriptionId },
        'Mock subscription cancellation processed',
      );
      return;
    }

    try {
      if (params.immediately) {
        await client.subscriptions.cancel(params.subscriptionId);
      } else {
        await client.subscriptions.update(params.subscriptionId, {
          cancel_at_period_end: true,
        });
      }
    } catch (err) {
      logger.error(
        { err, subscriptionId: params.subscriptionId },
        'Failed to cancel Stripe subscription',
      );
      throw new BadRequestError(
        'Failed to update subscription cancellation status with payment provider',
      );
    }
  }

  /**
   * Resume / Reactivate a canceled subscription that was scheduled to end at period end
   */
  public static async resumeSubscription(subscriptionId: string): Promise<void> {
    const client = this.getClient();
    if (!client) {
      if (env.NODE_ENV === 'production') {
        throw new BadRequestError('Stripe payment provider is not configured in production');
      }
      return;
    }

    if (subscriptionId.startsWith('sub_mock_')) {
      if (env.NODE_ENV === 'production') {
        throw new BadRequestError('Mock subscription cannot be processed in production');
      }
      return;
    }

    try {
      await client.subscriptions.update(subscriptionId, {
        cancel_at_period_end: false,
      });
    } catch (err) {
      logger.error({ err, subscriptionId }, 'Failed to resume Stripe subscription');
      throw new BadRequestError('Failed to resume subscription with payment provider');
    }
  }

  /**
   * Verify official Stripe Webhook signature using preserved raw body buffer
   */
  public static constructWebhookEvent(
    rawBody: Buffer,
    signature: string,
    webhookSecret: string,
  ): Stripe.Event {
    const client =
      this.getClient() ||
      new Stripe('sk_test_placeholder', {
        apiVersion: '2025-02-24.acacia' as Stripe.LatestApiVersion,
      });
    return client.webhooks.constructEvent(rawBody, signature, webhookSecret);
  }
}
