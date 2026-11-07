import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { subscriptionRoutes } from '../../src/modules/subscriptions/subscription.routes.js';
import { errorHandler } from '../../src/common/middleware/error-handler.js';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { prisma } from '../../src/database/prisma.js';
import { EntitlementService } from '../../src/modules/subscriptions/entitlement.service.js';
import { StripeSubscriptionProvider } from '../../src/modules/subscriptions/provider/stripe-subscription.provider.js';
import { Role } from '@prisma/client';
import { env } from '../../src/config/env.js';
import Stripe from 'stripe';

describe('SaaS Platform Subscriptions & Entitlements Integration Suite', () => {
  const orgId = '123e4567-e89b-42d3-a456-426614174000';
  const ownerUserId = 'usr-owner-100';
  const memberUserId = 'usr-member-200';

  function mockSession(role: 'OWNER' | 'ADMIN' | 'MEMBER' = 'OWNER') {
    const isOwner = role === 'OWNER';
    const userId = isOwner ? ownerUserId : memberUserId;
    const email = isOwner ? 'owner@testcorp.internal' : 'member@testcorp.internal';

    vi.spyOn(AuthService, 'validateSession').mockResolvedValue({
      sessionId: 'test-session-id',
      user: {
        id: userId,
        email,
        name: isOwner ? 'Alice Owner' : 'Bob Member',
        memberships: [
          {
            organizationId: orgId,
            organizationName: 'Test Corp',
            role,
          },
        ],
      },
      activeOrganizationId: orgId,
    });
  }

  function createSubscriptionTestApp() {
    const app = express();
    app.use(cookieParser());
    app.use(
      express.json({
        verify: (req: any, _res, buf) => {
          req.rawBody = buf;
        },
      }),
    );

    app.use('/api/v1/subscriptions', subscriptionRoutes);
    app.use(errorHandler);
    return app;
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    mockSession('OWNER');

    if (!env.STRIPE_WEBHOOK_SECRET) {
      (env as any).STRIPE_WEBHOOK_SECRET = 'whsec_test_mock_webhook_secret';
    }

    // Default safe mocks for counts
    vi.spyOn(prisma.membership, 'count').mockResolvedValue(1);
    vi.spyOn(prisma.customer, 'count').mockResolvedValue(10);
    vi.spyOn(prisma.project, 'count').mockResolvedValue(2);
    vi.spyOn(prisma.service, 'count').mockResolvedValue(3);

    // Default membership findFirst
    vi.spyOn(prisma.membership, 'findFirst').mockResolvedValue({
      id: 'mem-1',
      userId: ownerUserId,
      organizationId: orgId,
      role: Role.OWNER,
      organization: { id: orgId, name: 'Test Corp' },
      user: { id: ownerUserId, email: 'owner@testcorp.internal' },
    } as any);
  });

  describe('1. Plan Catalog & Discovery', () => {
    it('GET /api/v1/subscriptions/plans > returns all active SaaS subscription tiers with limits and pricing', async () => {
      const app = createSubscriptionTestApp();
      const res = await request(app)
        .get('/api/v1/subscriptions/plans')
        .set('Cookie', ['flowpilot_session=mock-token']);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(3);

      const starter = res.body.data.find((p: any) => p.slug === 'starter-monthly');
      expect(starter).toBeDefined();
      expect(starter.name).toBe('Starter');
      expect(starter.price).toBe(0);
      expect(starter.limits.maxMembers).toBe(3);
      expect(starter.limits.maxCustomers).toBe(50);

      const pro = res.body.data.find((p: any) => p.slug === 'pro-monthly');
      expect(pro).toBeDefined();
      expect(pro.name).toBe('Professional');
      expect(pro.price).toBe(49);
      expect(pro.features.hasCustomDomain).toBe(true);
    });
  });

  describe('2. Current Subscription & Usage State', () => {
    it('GET /api/v1/subscriptions/current > returns active subscription and live usage overview', async () => {
      vi.spyOn(prisma.membership, 'count').mockResolvedValue(2);
      vi.spyOn(prisma.customer, 'count').mockResolvedValue(15);
      vi.spyOn(prisma.project, 'count').mockResolvedValue(3);
      vi.spyOn(prisma.service, 'count').mockResolvedValue(4);

      const app = createSubscriptionTestApp();
      const res = await request(app)
        .get('/api/v1/subscriptions/current')
        .set('Cookie', ['flowpilot_session=mock-token'])
        .set('X-Organization-Id', orgId);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('ACTIVE');
      expect(res.body.data.isOwner).toBe(true);
      expect(res.body.data.usage.members.current).toBe(2);
      expect(res.body.data.usage.members.limit).toBe(3);
      expect(res.body.data.usage.customers.current).toBe(15);
    });

    it('GET /api/v1/subscriptions/usage > returns resource metrics vs hard plan limits', async () => {
      vi.spyOn(prisma.membership, 'count').mockResolvedValue(3);
      vi.spyOn(prisma.customer, 'count').mockResolvedValue(45);
      vi.spyOn(prisma.project, 'count').mockResolvedValue(2);
      vi.spyOn(prisma.service, 'count').mockResolvedValue(8);

      const app = createSubscriptionTestApp();
      const res = await request(app)
        .get('/api/v1/subscriptions/usage')
        .set('Cookie', ['flowpilot_session=mock-token'])
        .set('X-Organization-Id', orgId);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.members.current).toBe(3);
      expect(res.body.data.members.limit).toBe(3);
      expect(res.body.data.members.exceeded).toBe(true);
      expect(res.body.data.members.percentage).toBe(100);
    });
  });

  describe('3. Checkout & Lifecycle Management (OWNER Privilege Enforcement)', () => {
    it('POST /api/v1/subscriptions/checkout > allows OWNER to initiate Stripe checkout', async () => {
      vi.spyOn(StripeSubscriptionProvider, 'createCustomer').mockResolvedValue('cus_test_123');
      vi.spyOn(StripeSubscriptionProvider, 'createCheckoutSession').mockResolvedValue({
        url: 'https://checkout.stripe.com/pay/cs_test_session_123',
        sessionId: 'cs_test_session_123',
      });

      const app = createSubscriptionTestApp();
      const res = await request(app)
        .post('/api/v1/subscriptions/checkout')
        .set('Cookie', ['flowpilot_session=mock-token'])
        .set('X-Organization-Id', orgId)
        .send({
          planSlug: 'pro-monthly',
          billingInterval: 'MONTHLY',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.checkoutUrl).toBe('https://checkout.stripe.com/pay/cs_test_session_123');
      expect(res.body.data.sessionId).toBe('cs_test_session_123');
    });

    it('POST /api/v1/subscriptions/checkout > rejects non-OWNER with HTTP 403 Forbidden', async () => {
      mockSession('MEMBER');

      const app = createSubscriptionTestApp();
      const res = await request(app)
        .post('/api/v1/subscriptions/checkout')
        .set('Cookie', ['flowpilot_session=mock-token'])
        .set('X-Organization-Id', orgId)
        .send({
          planSlug: 'pro-monthly',
          billingInterval: 'MONTHLY',
        });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it('POST /api/v1/subscriptions/verify-checkout > allows OWNER to verify completed checkout session', async () => {
      vi.spyOn(StripeSubscriptionProvider, 'retrieveCheckoutSession').mockResolvedValue({
        id: 'cs_test_mock_verified',
        payment_status: 'paid',
        status: 'complete',
        client_reference_id: orgId,
        customer: 'cus_test_123',
        subscription: 'sub_test_123',
        metadata: {
          organizationId: orgId,
          planSlug: 'pro-monthly',
          billingInterval: 'MONTHLY',
        },
      } as unknown as Stripe.Checkout.Session);

      const app = createSubscriptionTestApp();
      const res = await request(app)
        .post('/api/v1/subscriptions/verify-checkout')
        .set('Cookie', ['flowpilot_session=mock-token'])
        .set('X-Organization-Id', orgId)
        .send({ sessionId: 'cs_test_mock_verified' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('ACTIVE');
    });

    it('POST /api/v1/subscriptions/verify-checkout > rejects if session belongs to another organization', async () => {
      vi.spyOn(StripeSubscriptionProvider, 'retrieveCheckoutSession').mockResolvedValue({
        id: 'cs_test_other_org',
        payment_status: 'paid',
        status: 'complete',
        client_reference_id: 'other-org-id',
        metadata: {
          organizationId: 'other-org-id',
        },
      } as unknown as Stripe.Checkout.Session);

      const app = createSubscriptionTestApp();
      const res = await request(app)
        .post('/api/v1/subscriptions/verify-checkout')
        .set('Cookie', ['flowpilot_session=mock-token'])
        .set('X-Organization-Id', orgId)
        .send({ sessionId: 'cs_test_other_org' });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });

    it('POST /api/v1/subscriptions/change-plan > allows OWNER to switch plan', async () => {
      const app = createSubscriptionTestApp();
      const res = await request(app)
        .post('/api/v1/subscriptions/change-plan')
        .set('Cookie', ['flowpilot_session=mock-token'])
        .set('X-Organization-Id', orgId)
        .send({
          planSlug: 'pro-annually',
          billingInterval: 'ANNUALLY',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('POST /api/v1/subscriptions/cancel > allows OWNER to schedule cancellation', async () => {
      const app = createSubscriptionTestApp();
      const res = await request(app)
        .post('/api/v1/subscriptions/cancel')
        .set('Cookie', ['flowpilot_session=mock-token'])
        .set('X-Organization-Id', orgId)
        .send({ immediately: false });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('POST /api/v1/subscriptions/resume > allows OWNER to reactivate subscription', async () => {
      const app = createSubscriptionTestApp();
      const res = await request(app)
        .post('/api/v1/subscriptions/resume')
        .set('Cookie', ['flowpilot_session=mock-token'])
        .set('X-Organization-Id', orgId)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('POST /api/v1/subscriptions/portal > allows OWNER to access Stripe billing portal with flowType', async () => {
      const portalSpy = vi
        .spyOn(StripeSubscriptionProvider, 'createCustomerPortalSession')
        .mockResolvedValue('https://billing.stripe.com/p/session_test_456');

      const app = createSubscriptionTestApp();
      const res = await request(app)
        .post('/api/v1/subscriptions/portal')
        .set('Cookie', ['flowpilot_session=mock-token'])
        .set('X-Organization-Id', orgId)
        .send({ flowType: 'payment_method_update' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.portalUrl).toBe('https://billing.stripe.com/p/session_test_456');
      expect(portalSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          flowType: 'payment_method_update',
        }),
      );
    });

    it('GET /api/v1/subscriptions/billing-history > rejects MEMBER with HTTP 403 Forbidden', async () => {
      mockSession('MEMBER');

      const app = createSubscriptionTestApp();
      const res = await request(app)
        .get('/api/v1/subscriptions/billing-history')
        .set('Cookie', ['flowpilot_session=mock-token'])
        .set('X-Organization-Id', orgId);

      expect(res.status).toBe(403);
    });
  });

  describe('4. Webhook Reliability, Signature Verification & Idempotency', () => {
    it('POST /api/v1/subscriptions/webhook > rejects missing signature with HTTP 400', async () => {
      const app = createSubscriptionTestApp();
      const res = await request(app)
        .post('/api/v1/subscriptions/webhook')
        .send({ type: 'checkout.session.completed' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('POST /api/v1/subscriptions/webhook > rejects invalid signature with HTTP 400', async () => {
      vi.spyOn(StripeSubscriptionProvider, 'constructWebhookEvent').mockImplementation(() => {
        throw new Error('Signature verification failed');
      });

      const app = createSubscriptionTestApp();
      const res = await request(app)
        .post('/api/v1/subscriptions/webhook')
        .set('stripe-signature', 't=123,v1=invalid_signature')
        .send({ type: 'checkout.session.completed' });

      expect(res.status).toBe(400);
    });

    it('POST /api/v1/subscriptions/webhook > processes valid checkout.session.completed event', async () => {
      const freshEventId = `evt_test_checkout_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      vi.spyOn(StripeSubscriptionProvider, 'constructWebhookEvent').mockReturnValue({
        id: freshEventId,
        type: 'checkout.session.completed',
        data: {
          object: {
            client_reference_id: orgId,
            customer: 'cus_test_123',
            subscription: 'sub_test_123',
            metadata: {
              organizationId: orgId,
              planSlug: 'pro-monthly',
            },
          },
        },
      } as any);

      const app = createSubscriptionTestApp();
      const res = await request(app)
        .post('/api/v1/subscriptions/webhook')
        .set('stripe-signature', 't=123,v1=valid_mock_signature')
        .send({ type: 'checkout.session.completed' });

      expect(res.status).toBe(200);
      expect(res.body.received).toBe(true);
      expect(res.body.status).toBe('processed');
    });

    it('POST /api/v1/subscriptions/webhook > ignores duplicate webhook events with duplicate_ignored', async () => {
      vi.spyOn(StripeSubscriptionProvider, 'constructWebhookEvent').mockReturnValue({
        id: 'evt_test_duplicate_123',
        type: 'checkout.session.completed',
        data: { object: {} },
      } as any);

      // Mock subscriptionWebhookEvent.findUnique to simulate already-processed event
      (prisma as any).subscriptionWebhookEvent = {
        findUnique: vi.fn().mockResolvedValue({ id: 'we-1', eventId: 'evt_test_duplicate_123' }),
      };

      const app = createSubscriptionTestApp();
      const res = await request(app)
        .post('/api/v1/subscriptions/webhook')
        .set('stripe-signature', 't=123,v1=valid_mock_signature')
        .send({ type: 'checkout.session.completed' });

      expect(res.status).toBe(200);
      expect(res.body.received).toBe(true);
      expect(res.body.status).toBe('duplicate_ignored');
    });

    it('POST /api/v1/subscriptions/webhook > processes customer.subscription.updated event', async () => {
      vi.spyOn(StripeSubscriptionProvider, 'constructWebhookEvent').mockReturnValue({
        id: 'evt_test_sub_updated_123',
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: 'sub_test_123',
            customer: 'cus_test_123',
            status: 'past_due',
            cancel_at_period_end: false,
            current_period_start: 1700000000,
            current_period_end: 1702592000,
            metadata: { organizationId: orgId },
          },
        },
      } as any);

      const app = createSubscriptionTestApp();
      const res = await request(app)
        .post('/api/v1/subscriptions/webhook')
        .set('stripe-signature', 't=123,v1=valid_mock_signature')
        .send({ type: 'customer.subscription.updated' });

      expect(res.status).toBe(200);
      expect(res.body.received).toBe(true);
      expect(res.body.status).toBe('processed');
    });

    it('POST /api/v1/subscriptions/webhook > processes customer.subscription.deleted event', async () => {
      vi.spyOn(StripeSubscriptionProvider, 'constructWebhookEvent').mockReturnValue({
        id: 'evt_test_sub_deleted_123',
        type: 'customer.subscription.deleted',
        data: {
          object: {
            id: 'sub_test_123',
            metadata: { organizationId: orgId },
          },
        },
      } as any);

      const app = createSubscriptionTestApp();
      const res = await request(app)
        .post('/api/v1/subscriptions/webhook')
        .set('stripe-signature', 't=123,v1=valid_mock_signature')
        .send({ type: 'customer.subscription.deleted' });

      expect(res.status).toBe(200);
      expect(res.body.received).toBe(true);
      expect(res.body.status).toBe('processed');
    });

    it('POST /api/v1/subscriptions/webhook > processes invoice.payment_succeeded and persists billing record', async () => {
      vi.spyOn(StripeSubscriptionProvider, 'constructWebhookEvent').mockReturnValue({
        id: 'evt_test_inv_paid_123',
        type: 'invoice.payment_succeeded',
        data: {
          object: {
            id: 'in_test_123',
            subscription: 'sub_test_123',
            customer: 'cus_test_123',
            amount_paid: 4900,
            currency: 'usd',
            status: 'paid',
            payment_intent: 'pi_test_123',
            invoice_pdf: 'https://stripe.com/invoice.pdf',
            status_transitions: { paid_at: 1700000000 },
            period_start: 1700000000,
            period_end: 1702592000,
            metadata: { organizationId: orgId },
          },
        },
      } as any);

      const app = createSubscriptionTestApp();
      const res = await request(app)
        .post('/api/v1/subscriptions/webhook')
        .set('stripe-signature', 't=123,v1=valid_mock_signature')
        .send({ type: 'invoice.payment_succeeded' });

      expect(res.status).toBe(200);
      expect(res.body.received).toBe(true);
      expect(res.body.status).toBe('processed');
    });

    it('POST /api/v1/subscriptions/webhook > processes invoice.payment_failed and sets status to PAST_DUE', async () => {
      vi.spyOn(StripeSubscriptionProvider, 'constructWebhookEvent').mockReturnValue({
        id: 'evt_test_inv_failed_123',
        type: 'invoice.payment_failed',
        data: {
          object: {
            id: 'in_test_failed_123',
            subscription: 'sub_test_123',
            customer: 'cus_test_123',
            amount_due: 4900,
          },
        },
      } as any);

      const app = createSubscriptionTestApp();
      const res = await request(app)
        .post('/api/v1/subscriptions/webhook')
        .set('stripe-signature', 't=123,v1=valid_mock_signature')
        .send({ type: 'invoice.payment_failed' });

      expect(res.status).toBe(200);
      expect(res.body.received).toBe(true);
      expect(res.body.status).toBe('processed');
    });
  });

  describe('5. Plan Entitlements & Hard-Limit Enforcement', () => {
    it('allows resource creation when within plan limits', async () => {
      vi.spyOn(prisma.membership, 'count').mockResolvedValue(1); // 1 < 3

      await expect(EntitlementService.enforceLimit(orgId, 'members')).resolves.not.toThrow();
    });

    it('blocks resource creation with ForbiddenError when hard limit is reached', async () => {
      vi.spyOn(prisma.membership, 'count').mockResolvedValue(3); // 3 >= 3 (Starter limit)

      await expect(EntitlementService.enforceLimit(orgId, 'members')).rejects.toThrow(
        /limit of 3 members on the Starter plan/,
      );
    });

    it('blocks customer creation with ForbiddenError when customer limit is reached', async () => {
      vi.spyOn(prisma.customer, 'count').mockResolvedValue(50); // 50 >= 50 (Starter limit)

      await expect(EntitlementService.enforceLimit(orgId, 'customers')).rejects.toThrow(
        /limit of 50 customers/,
      );
    });

    it('enforces feature entitlements: allows included feature and blocks unincluded feature', async () => {
      // Starter includes flowRules, analytics, recurring, clientPortal, but NOT customDomain
      await expect(EntitlementService.enforceFeature(orgId, 'flowRules')).resolves.not.toThrow();

      await expect(EntitlementService.enforceFeature(orgId, 'customDomain')).rejects.toThrow(
        /feature 'customDomain' is not included/,
      );
    });
  });
});
