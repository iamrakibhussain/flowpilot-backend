import { Request, Response, NextFunction } from 'express';
import { PaymentService } from './payment.service.js';
import { sendSuccess } from '../../common/http/response.js';
import { BadRequestError } from '../../common/errors/app-error.js';
import { TransactionStatus } from '@prisma/client';
import { ListTransactionsQuery, UpdatePaymentSettingsInput } from './payment.types.js';

export class PaymentController {
  /**
   * GET /api/v1/payments/public/invoice/:token
   * Public endpoint for customer hosted checkout portal
   */
  public static async getPublicInvoice(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { token } = req.params;
      if (!token) {
        throw new BadRequestError('Payment token is required');
      }

      const invoice = await PaymentService.getPublicInvoiceByToken(token);
      sendSuccess(res, invoice);
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/v1/payments/public/checkout/:token
   * Initiate Stripe or Sandbox Checkout session
   */
  public static async createCheckoutSession(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { token } = req.params;
      if (!token) {
        throw new BadRequestError('Payment token is required');
      }

      const session = await PaymentService.createCheckoutSession(token, req.body || {});
      sendSuccess(res, session);
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/v1/payments/public/sandbox-pay/:token
   * Instant sandbox payment settlement simulation
   */
  public static async settleSandbox(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const { token } = req.params;
      if (!token) {
        throw new BadRequestError('Payment token is required');
      }

      const paymentMethod = req.body?.paymentMethod || 'card_visa';
      const result = await PaymentService.settleSandboxPayment(token, paymentMethod);
      sendSuccess(res, result);
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/v1/payments/invoices/:id/token
   * Generate or retrieve payment token (Authenticated Tenant)
   */
  public static async generateInvoiceToken(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const { id } = req.params;
      if (!id) {
        throw new BadRequestError('Invoice ID is required');
      }

      const result = await PaymentService.generateOrGetPaymentToken(id, organizationId);
      sendSuccess(res, result);
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/v1/payments/settings
   * Get organization payment configuration (Authenticated Tenant)
   */
  public static async getSettings(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const settings = await PaymentService.getPaymentSettings(organizationId);
      sendSuccess(res, settings);
    } catch (err) {
      next(err);
    }
  }

  /**
   * PATCH /api/v1/payments/settings
   * Update organization payment configuration (Authenticated Tenant)
   */
  public static async updateSettings(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const input: UpdatePaymentSettingsInput = req.body || {};
      const settings = await PaymentService.updatePaymentSettings(organizationId, input);
      sendSuccess(res, settings, 200, 'Payment settings successfully updated');
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/v1/payments/transactions
   * Transaction history ledger (Authenticated Tenant)
   */
  public static async listTransactions(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const { status, invoiceId, customerId, page, limit } = req.query;

      const query: ListTransactionsQuery = {
        status:
          typeof status === 'string' &&
          Object.values(TransactionStatus).includes(status as TransactionStatus)
            ? (status as TransactionStatus)
            : undefined,
        invoiceId: typeof invoiceId === 'string' ? invoiceId : undefined,
        customerId: typeof customerId === 'string' ? customerId : undefined,
        page: typeof page === 'string' ? parseInt(page, 10) : 1,
        limit: typeof limit === 'string' ? parseInt(limit, 10) : 20,
      };

      const result = await PaymentService.listTransactions(organizationId, query);
      const currentPage = Number(query.page) || 1;
      const currentLimit = Number(query.limit) || 20;

      sendSuccess(res, result.transactions, 200, undefined, {
        page: currentPage,
        limit: currentLimit,
        total: result.total,
        totalPages: Math.ceil(result.total / currentLimit),
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/v1/payments/webhook
   * Stripe Webhook Receiver
   */
  public static async handleWebhook(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const signature = req.headers['stripe-signature'] as string;
      if (!signature) {
        throw new BadRequestError('Missing Stripe signature header');
      }

      const rawPayload = (req as Request & { rawBody?: Buffer }).rawBody || req.body;
      const result = await PaymentService.handleStripeWebhook(rawPayload, signature);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  }
}
