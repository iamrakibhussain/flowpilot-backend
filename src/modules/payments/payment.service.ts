import { randomUUID } from 'crypto';
import Stripe from 'stripe';
import { prisma } from '../../database/prisma.js';
import { NotFoundError, BadRequestError } from '../../common/errors/app-error.js';
import { InvoiceStatus, TransactionStatus, Prisma } from '@prisma/client';
import { logger } from '../../common/logging/logger.js';
import {
  PublicInvoiceResponse,
  CreateCheckoutSessionInput,
  CheckoutSessionResponse,
  UpdatePaymentSettingsInput,
  PaymentTransactionItem,
  ListTransactionsQuery,
} from './payment.types.js';

export class PaymentService {
  /**
   * Resolve Stripe SDK instance strictly for an organization's configured API key
   */
  private static getStripeClient(apiKey?: string | null): Stripe | null {
    if (!apiKey) return null;
    return new Stripe(apiKey);
  }

  /**
   * Generate or retrieve high-entropy cryptographic payment token for an invoice
   */
  public static async generateOrGetPaymentToken(
    invoiceId: string,
    organizationId: string,
  ): Promise<{ token: string; paymentUrl: string }> {
    const invoice = await prisma.invoice.findFirst({
      where: { id: invoiceId, organizationId },
      select: { id: true, paymentToken: true, paymentTokenExpiry: true },
    });

    if (!invoice) {
      throw new NotFoundError(`Invoice with ID ${invoiceId} not found`);
    }

    const frontendBase = process.env.FRONTEND_URL || 'http://localhost:3000';

    if (invoice.paymentToken) {
      return {
        token: invoice.paymentToken,
        paymentUrl: `${frontendBase}/pay/${invoice.paymentToken}`,
      };
    }

    const token = `tok_${randomUUID().replace(/-/g, '')}`;
    const expiry = new Date();
    expiry.setDate(expiry.getDate() + 90); // 90-day active validity

    await prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        paymentToken: token,
        paymentTokenExpiry: expiry,
      },
    });

    return {
      token,
      paymentUrl: `${frontendBase}/pay/${token}`,
    };
  }

  /**
   * Fetch sanitized, client-safe public invoice statement for `/pay/[token]`
   */
  public static async getPublicInvoiceByToken(token: string): Promise<PublicInvoiceResponse> {
    const invoice = await prisma.invoice.findFirst({
      where: { paymentToken: token },
      include: {
        customer: true,
        items: true,
        organization: {
          include: {
            paymentSettings: true,
          },
        },
      },
    });

    if (!invoice) {
      throw new NotFoundError('Invoice statement link not found or has been revoked');
    }

    if (invoice.paymentTokenExpiry && new Date() > invoice.paymentTokenExpiry) {
      throw new BadRequestError(
        'This payment link has expired. Please contact the business for an updated invoice link.',
      );
    }

    const settings = invoice.organization.paymentSettings;
    const isStripeConfigured = Boolean(settings?.stripeSecretKey && settings?.stripePublishableKey);

    return {
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      issueDate: invoice.issueDate.toISOString(),
      dueDate: invoice.dueDate.toISOString(),
      status: invoice.status,
      subtotal: Number(invoice.subtotal),
      tax: Number(invoice.tax),
      total: Number(invoice.total),
      paidAt: invoice.paidAt ? invoice.paidAt.toISOString() : null,
      notes: invoice.notes,
      items: invoice.items.map((it) => ({
        id: it.id,
        description: it.description,
        quantity: it.quantity,
        unitPrice: Number(it.unitPrice),
        amount: Number(it.amount),
      })),
      customer: {
        name: invoice.customer.name,
        email: invoice.customer.email,
        company: invoice.customer.company || null,
      },
      organization: {
        id: invoice.organization.id,
        name: invoice.organization.name,
        currency: settings?.defaultCurrency || 'USD',
      },
      paymentSettings: {
        isStripeConnected: isStripeConfigured,
        publishableKey: settings?.stripePublishableKey || undefined,
        isTestMode:
          settings?.isTestMode ?? settings?.stripeSecretKey?.startsWith('sk_test_') ?? true,
        defaultCurrency: settings?.defaultCurrency || 'USD',
        acceptedMethods: isStripeConfigured
          ? ['card', 'apple_pay', 'google_pay']
          : ['bank_transfer'],
      },
    };
  }

  /**
   * Initialize a Stripe Checkout or Sandbox Test Checkout Session
   */
  public static async createCheckoutSession(
    token: string,
    _input: CreateCheckoutSessionInput = {},
  ): Promise<CheckoutSessionResponse> {
    const invoice = await prisma.invoice.findFirst({
      where: { paymentToken: token },
      include: {
        customer: true,
        items: true,
        organization: {
          include: {
            paymentSettings: true,
          },
        },
      },
    });

    if (!invoice) {
      throw new NotFoundError('Invoice statement not found');
    }

    if (invoice.status === InvoiceStatus.PAID) {
      throw new BadRequestError('This invoice has already been fully paid and settled.');
    }

    if (invoice.status === InvoiceStatus.CANCELLED) {
      throw new BadRequestError('This invoice has been voided or cancelled.');
    }

    if (invoice.paymentTokenExpiry && new Date() > invoice.paymentTokenExpiry) {
      throw new BadRequestError(
        'This payment link has expired. Please request a new invoice link.',
      );
    }

    if (Number(invoice.total) <= 0) {
      throw new BadRequestError(
        'Cannot process checkout for an invoice with zero or negative balance.',
      );
    }

    const frontendBase = process.env.FRONTEND_URL || 'http://localhost:3000';
    const settings = invoice.organization.paymentSettings;
    if (!settings?.stripeSecretKey || !settings?.stripePublishableKey) {
      throw new BadRequestError(
        'Online card payment is currently not enabled by this merchant. Please contact the business directly for payment arrangements.',
      );
    }

    const stripe = this.getStripeClient(settings.stripeSecretKey);
    if (!stripe) {
      throw new BadRequestError(
        'Invalid Stripe configuration. Please verify your Stripe API keys in Settings.',
      );
    }

    const currency = (settings?.defaultCurrency || 'USD').toLowerCase();
    const amountInCents = Math.round(Number(invoice.total) * 100);

    try {
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        customer_email: invoice.customer.email?.includes('@') ? invoice.customer.email : undefined,
        client_reference_id: invoice.id,
        line_items: [
          {
            price_data: {
              currency,
              product_data: {
                name: `Invoice #${invoice.invoiceNumber} - ${invoice.organization.name}`,
                description: `Services rendered for ${invoice.customer.name}`,
              },
              unit_amount: amountInCents,
            },
            quantity: 1,
          },
        ],
        metadata: {
          organizationId: invoice.organizationId,
          invoiceId: invoice.id,
          customerId: invoice.customerId,
          token,
        },
        success_url: `${frontendBase}/pay/${token}?status=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${frontendBase}/pay/${token}?status=cancelled`,
      });

      // Record gateway session in invoice
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          gatewaySessionId: session.id,
          gatewayProvider: 'STRIPE',
        },
      });

      return {
        sessionId: session.id,
        checkoutUrl: session.url || undefined,
        mode: 'STRIPE',
        amount: Number(invoice.total),
        currency: currency.toUpperCase(),
        invoiceNumber: invoice.invoiceNumber,
      };
    } catch (err: unknown) {
      logger.error({ err }, 'Stripe Checkout Session creation failed');
      const msg = err instanceof Error ? err.message : 'Gateway connection error';
      throw new BadRequestError(
        `Unable to initiate payment session: ${msg}. Please verify Stripe keys.`,
      );
    }
  }

  /**
   * Verify and reconcile a Stripe Checkout session upon customer redirect
   */
  public static async verifyCheckoutSession(
    token: string,
    sessionId?: string,
  ): Promise<{ success: boolean; alreadyPaid?: boolean; reconciled?: boolean; message?: string }> {
    const invoice = await prisma.invoice.findFirst({
      where: { paymentToken: token },
      include: {
        customer: true,
        organization: {
          include: { paymentSettings: true },
        },
      },
    });

    if (!invoice) {
      throw new NotFoundError('Invoice statement not found');
    }

    if (invoice.status === InvoiceStatus.PAID) {
      return {
        success: true,
        alreadyPaid: true,
        message: 'Invoice is already settled in full.',
      };
    }

    const sid = sessionId || invoice.gatewaySessionId;
    if (!sid) {
      throw new BadRequestError('No checkout session associated with this invoice to verify.');
    }

    const settings = invoice.organization.paymentSettings;
    const stripeKey = settings?.stripeSecretKey || process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) {
      throw new BadRequestError('Payment provider credentials are not configured.');
    }

    const stripe = this.getStripeClient(stripeKey);
    if (!stripe) {
      throw new BadRequestError('Failed to initialize Stripe client.');
    }

    try {
      const session = await stripe.checkout.sessions.retrieve(sid);
      if (session.payment_status === 'paid' || session.status === 'complete') {
        const amountTotal = session.amount_total
          ? session.amount_total / 100
          : Number(invoice.total);
        const paymentIntentId =
          typeof session.payment_intent === 'string'
            ? session.payment_intent
            : session.payment_intent?.id || null;

        await prisma.$transaction([
          prisma.invoice.update({
            where: { id: invoice.id },
            data: {
              status: InvoiceStatus.PAID,
              paidAt: new Date(),
              gatewayProvider: 'STRIPE',
              gatewayPaymentIntent: paymentIntentId,
              netAmount: amountTotal,
            },
          }),
          prisma.paymentTransaction.create({
            data: {
              organizationId: invoice.organizationId,
              invoiceId: invoice.id,
              customerId: invoice.customerId,
              amount: amountTotal,
              currency: (session.currency || 'USD').toUpperCase(),
              status: TransactionStatus.SUCCESS,
              provider: 'STRIPE',
              gatewayReference: paymentIntentId || session.id,
              paymentMethod: 'stripe_checkout',
              paidAt: new Date(),
            },
          }),
        ]);

        logger.info(
          { invoiceId: invoice.id, sessionId: session.id },
          'Invoice verified and marked as PAID via checkout session reconciliation',
        );

        return {
          success: true,
          reconciled: true,
          message: 'Payment verified and invoice settled successfully.',
        };
      }

      return {
        success: false,
        message: `Stripe checkout session status is ${session.payment_status}.`,
      };
    } catch (err: unknown) {
      logger.error({ err, sid }, 'Error retrieving Stripe checkout session during verification');
      throw new BadRequestError(
        err instanceof Error ? err.message : 'Could not verify checkout session with Stripe.',
      );
    }
  }

  /**
   * Settle an invoice in Sandbox Test Mode (Client portal 1-tap checkout simulation)
   */
  public static async settleSandboxPayment(
    token: string,
    paymentMethod: string = 'card_visa',
  ): Promise<{ success: boolean; invoiceNumber: string; transactionId: string }> {
    const invoice = await prisma.invoice.findFirst({
      where: { paymentToken: token },
      include: {
        customer: true,
        organization: {
          include: { paymentSettings: true },
        },
      },
    });

    if (!invoice) {
      throw new NotFoundError('Invoice statement not found');
    }

    const settings = invoice.organization.paymentSettings;
    if (!settings?.stripeSecretKey || !settings.isTestMode) {
      throw new BadRequestError(
        'Direct sandbox simulation is disabled. The merchant must configure Stripe Test Mode keys in Settings to test payments.',
      );
    }

    if (invoice.status === InvoiceStatus.PAID) {
      return {
        success: true,
        invoiceNumber: invoice.invoiceNumber,
        transactionId: 'already_paid',
      };
    }

    if (invoice.status === InvoiceStatus.CANCELLED) {
      throw new BadRequestError('This invoice has been voided or cancelled and cannot be settled.');
    }

    if (invoice.paymentTokenExpiry && new Date() > invoice.paymentTokenExpiry) {
      throw new BadRequestError('This payment link has expired.');
    }

    if (Number(invoice.total) <= 0) {
      throw new BadRequestError('Cannot settle an invoice with zero or negative balance.');
    }

    const transactionRef = `ch_test_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const eventId = `evt_mock_${randomUUID().replace(/-/g, '').slice(0, 16)}`;

    const [updatedInvoice, transaction] = await prisma.$transaction([
      prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          status: InvoiceStatus.PAID,
          paidAt: new Date(),
          gatewayProvider: 'FLOWPILOT_SANDBOX',
          gatewayPaymentIntent: transactionRef,
          gatewayFee: 0,
          netAmount: invoice.total,
        },
      }),
      prisma.paymentTransaction.create({
        data: {
          organizationId: invoice.organizationId,
          invoiceId: invoice.id,
          customerId: invoice.customerId,
          amount: invoice.total,
          currency: 'USD',
          status: TransactionStatus.SUCCESS,
          provider: 'FLOWPILOT_SANDBOX',
          gatewayReference: transactionRef,
          gatewayEventId: eventId,
          paymentMethod,
          paidAt: new Date(),
        },
      }),
    ]);

    logger.info(
      { invoiceId: updatedInvoice.id, invoiceNumber: updatedInvoice.invoiceNumber },
      'Invoice settled successfully via sandbox payment checkout',
    );

    return {
      success: true,
      invoiceNumber: updatedInvoice.invoiceNumber,
      transactionId: transaction.id,
    };
  }

  /**
   * Process incoming Stripe Webhook with HMAC signature verification and idempotency guard
   */
  public static async handleStripeWebhook(
    payload: string | Buffer,
    signature: string,
    webhookSecret?: string,
  ): Promise<{ received: boolean; processed: boolean; reason?: string }> {
    const stripe = this.getStripeClient() || new Stripe('sk_test_mock_for_verify');

    let event: Stripe.Event | null = null;
    const directSecret = webhookSecret || process.env.STRIPE_WEBHOOK_SECRET;

    if (directSecret) {
      try {
        event = stripe.webhooks.constructEvent(payload, signature, directSecret);
      } catch {
        // Will try tenant-specific secrets below
      }
    }

    if (!event) {
      // Check database for tenant-configured webhook secrets
      const orgSettings = await prisma.organizationPaymentSettings.findMany({
        where: { stripeWebhookSecret: { not: null } },
        select: { stripeWebhookSecret: true, organizationId: true },
      });

      for (const org of orgSettings) {
        if (!org.stripeWebhookSecret) continue;
        try {
          event = stripe.webhooks.constructEvent(payload, signature, org.stripeWebhookSecret);
          if (event) break;
        } catch {
          // Signature did not match this org secret, try next
        }
      }
    }

    if (!event) {
      logger.error('Stripe webhook signature verification failed for all configured secrets');
      throw new BadRequestError('Webhook signature verification failed: invalid signature');
    }

    // Idempotency check: Ignore already processed webhook events
    const existingTx = await prisma.paymentTransaction.findUnique({
      where: { gatewayEventId: event.id },
    });

    if (existingTx) {
      logger.info(
        { eventId: event.id },
        'Stripe webhook event already processed (idempotent skip)',
      );
      return { received: true, processed: true, reason: 'idempotent_duplicate' };
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      const invoiceId = session.metadata?.invoiceId || session.client_reference_id;
      const organizationId = session.metadata?.organizationId;
      const customerId = session.metadata?.customerId;

      if (!invoiceId) {
        logger.warn({ session: session.id }, 'Stripe checkout session missing invoiceId metadata');
        return { received: true, processed: false, reason: 'missing_metadata' };
      }

      const invoice = await prisma.invoice.findUnique({
        where: { id: invoiceId },
      });

      if (!invoice) {
        logger.error({ invoiceId }, 'Webhook invoice target not found');
        return { received: true, processed: false, reason: 'invoice_not_found' };
      }

      const amountTotal = session.amount_total ? session.amount_total / 100 : Number(invoice.total);
      const paymentIntentId =
        typeof session.payment_intent === 'string'
          ? session.payment_intent
          : session.payment_intent?.id || null;

      await prisma.$transaction([
        prisma.invoice.update({
          where: { id: invoiceId },
          data: {
            status: InvoiceStatus.PAID,
            paidAt: invoice.paidAt || new Date(),
            gatewayProvider: 'STRIPE',
            gatewayPaymentIntent: paymentIntentId,
            netAmount: amountTotal,
          },
        }),
        prisma.paymentTransaction.create({
          data: {
            organizationId: organizationId || invoice.organizationId,
            invoiceId,
            customerId: customerId || invoice.customerId,
            amount: amountTotal,
            currency: (session.currency || 'USD').toUpperCase(),
            status: TransactionStatus.SUCCESS,
            provider: 'STRIPE',
            gatewayReference: paymentIntentId || session.id,
            gatewayEventId: event.id,
            paymentMethod: 'stripe_checkout',
            paidAt: new Date(),
          },
        }),
      ]);

      logger.info(
        { invoiceId, invoiceNumber: invoice.invoiceNumber, eventId: event.id },
        'Invoice successfully settled via Stripe Webhook',
      );

      return { received: true, processed: true };
    }

    return { received: true, processed: false, reason: `unhandled_event_${event.type}` };
  }

  /**
   * Fetch organization payment configuration
   */
  public static async getPaymentSettings(organizationId: string) {
    let settings = await prisma.organizationPaymentSettings.findUnique({
      where: { organizationId },
    });

    if (!settings) {
      settings = await prisma.organizationPaymentSettings.create({
        data: {
          organizationId,
          defaultCurrency: 'USD',
          isTestMode: true,
        },
      });
    }

    // Mask secret keys for security
    return {
      id: settings.id,
      organizationId: settings.organizationId,
      stripeAccountId: settings.stripeAccountId,
      stripeConnected: settings.stripeConnected,
      stripeChargesEnabled: settings.stripeChargesEnabled,
      stripePublishableKey: settings.stripePublishableKey || '',
      hasSecretKey: Boolean(settings.stripeSecretKey),
      hasWebhookSecret: Boolean(settings.stripeWebhookSecret),
      isTestMode: settings.isTestMode,
      defaultCurrency: settings.defaultCurrency,
      allowPartialPayments: settings.allowPartialPayments,
      createdAt: settings.createdAt.toISOString(),
      updatedAt: settings.updatedAt.toISOString(),
    };
  }

  /**
   * Update organization payment configuration
   */
  public static async updatePaymentSettings(
    organizationId: string,
    input: UpdatePaymentSettingsInput,
  ) {
    const data: Prisma.OrganizationPaymentSettingsUpdateInput = {};

    if (input.stripeAccountId !== undefined) data.stripeAccountId = input.stripeAccountId;
    if (input.stripePublishableKey !== undefined)
      data.stripePublishableKey = input.stripePublishableKey;
    if (input.stripeSecretKey !== undefined && input.stripeSecretKey.trim().length > 0) {
      data.stripeSecretKey = input.stripeSecretKey.trim();
      data.stripeConnected = true;
      data.stripeChargesEnabled = true;
    }
    if (input.stripeWebhookSecret !== undefined && input.stripeWebhookSecret.trim().length > 0) {
      data.stripeWebhookSecret = input.stripeWebhookSecret.trim();
    }
    if (input.isTestMode !== undefined) data.isTestMode = input.isTestMode;
    if (input.defaultCurrency !== undefined)
      data.defaultCurrency = input.defaultCurrency.toUpperCase();
    if (input.allowPartialPayments !== undefined)
      data.allowPartialPayments = input.allowPartialPayments;

    const updated = await prisma.organizationPaymentSettings.upsert({
      where: { organizationId },
      create: {
        organizationId,
        stripePublishableKey: input.stripePublishableKey,
        stripeSecretKey: input.stripeSecretKey,
        stripeWebhookSecret: input.stripeWebhookSecret,
        stripeConnected: Boolean(input.stripeSecretKey),
        stripeChargesEnabled: Boolean(input.stripeSecretKey),
        isTestMode: input.isTestMode ?? true,
        defaultCurrency: input.defaultCurrency?.toUpperCase() || 'USD',
        allowPartialPayments: input.allowPartialPayments ?? false,
      },
      update: data,
    });

    return {
      id: updated.id,
      organizationId: updated.organizationId,
      stripeAccountId: updated.stripeAccountId,
      stripeConnected: updated.stripeConnected,
      stripeChargesEnabled: updated.stripeChargesEnabled,
      stripePublishableKey: updated.stripePublishableKey || '',
      hasSecretKey: Boolean(updated.stripeSecretKey),
      hasWebhookSecret: Boolean(updated.stripeWebhookSecret),
      isTestMode: updated.isTestMode,
      defaultCurrency: updated.defaultCurrency,
      allowPartialPayments: updated.allowPartialPayments,
    };
  }

  /**
   * List multi-tenant payment transaction ledger
   */
  public static async listTransactions(
    organizationId: string,
    query: ListTransactionsQuery,
  ): Promise<{
    transactions: PaymentTransactionItem[];
    total: number;
    page: number;
    limit: number;
  }> {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const skip = (page - 1) * limit;

    const where: Prisma.PaymentTransactionWhereInput = {
      organizationId,
    };

    if (query.status) where.status = query.status;
    if (query.invoiceId) where.invoiceId = query.invoiceId;
    if (query.customerId) where.customerId = query.customerId;

    const [transactions, total] = await Promise.all([
      prisma.paymentTransaction.findMany({
        where,
        include: {
          customer: { select: { name: true } },
          invoice: { select: { invoiceNumber: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.paymentTransaction.count({ where }),
    ]);

    return {
      transactions: transactions.map((tx) => ({
        id: tx.id,
        organizationId: tx.organizationId,
        invoiceId: tx.invoiceId,
        invoiceNumber: tx.invoice.invoiceNumber,
        customerId: tx.customerId,
        customerName: tx.customer.name,
        amount: Number(tx.amount),
        currency: tx.currency,
        status: tx.status,
        provider: tx.provider,
        gatewayReference: tx.gatewayReference,
        paymentMethod: tx.paymentMethod,
        failureReason: tx.failureReason,
        paidAt: tx.paidAt ? tx.paidAt.toISOString() : null,
        createdAt: tx.createdAt.toISOString(),
      })),
      total,
      page,
      limit,
    };
  }
}
