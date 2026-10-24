import { Request, Response, NextFunction } from 'express';
import { InvoiceService } from './invoice.service.js';
import { sendSuccess } from '../../common/http/response.js';
import { BadRequestError } from '../../common/errors/app-error.js';
import { InvoiceStatus } from '@prisma/client';
import {
  ListInvoicesQuery,
  CreateInvoiceInput,
  UpdateInvoiceInput,
  RecordPaymentInput,
} from './invoice.types.js';

export class InvoiceController {
  /**
   * GET /api/v1/invoices
   */
  public static async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const { status, customerId, startDate, endDate, search, page, limit } = req.query;

      const query: ListInvoicesQuery = {
        status:
          typeof status === 'string' &&
          Object.values(InvoiceStatus).includes(status as InvoiceStatus)
            ? (status as InvoiceStatus)
            : undefined,
        customerId: typeof customerId === 'string' ? customerId : undefined,
        startDate: typeof startDate === 'string' ? startDate : undefined,
        endDate: typeof endDate === 'string' ? endDate : undefined,
        search: typeof search === 'string' ? search : undefined,
        page: typeof page === 'string' ? parseInt(page, 10) : undefined,
        limit: typeof limit === 'string' ? parseInt(limit, 10) : undefined,
      };

      const result = await InvoiceService.listInvoices(organizationId, query);
      sendSuccess(res, result);
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/v1/invoices/stats
   */
  public static async getStats(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const stats = await InvoiceService.getInvoiceStats(organizationId);
      sendSuccess(res, stats);
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/v1/invoices/:id
   */
  public static async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const id = req.params.id;
      if (!id) {
        throw new BadRequestError('Invoice ID is required');
      }

      const invoice = await InvoiceService.getInvoiceById(organizationId, id);
      sendSuccess(res, invoice);
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/v1/invoices
   */
  public static async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const body = req.body as CreateInvoiceInput;

      if (!body.dueDate) {
        throw new BadRequestError('Due date is required');
      }
      if (!body.items || !Array.isArray(body.items) || body.items.length === 0) {
        throw new BadRequestError('At least one line item is required');
      }

      const created = await InvoiceService.createInvoice(organizationId, body);
      sendSuccess(res, created, 201);
    } catch (err) {
      next(err);
    }
  }

  /**
   * PATCH /api/v1/invoices/:id
   */
  public static async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const id = req.params.id;
      if (!id) {
        throw new BadRequestError('Invoice ID is required');
      }

      const updated = await InvoiceService.updateInvoice(
        organizationId,
        id,
        req.body as UpdateInvoiceInput,
      );
      sendSuccess(res, updated);
    } catch (err) {
      next(err);
    }
  }

  /**
   * PATCH /api/v1/invoices/:id/status
   */
  public static async updateStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const id = req.params.id;
      const { status } = req.body;

      if (!id) {
        throw new BadRequestError('Invoice ID is required');
      }
      if (!status || !Object.values(InvoiceStatus).includes(status)) {
        throw new BadRequestError(`Invalid invoice status: ${status}`);
      }

      const updated = await InvoiceService.updateStatus(
        organizationId,
        id,
        status as InvoiceStatus,
      );
      sendSuccess(res, updated);
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/v1/invoices/:id/record-payment
   */
  public static async recordPayment(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const id = req.params.id;
      if (!id) {
        throw new BadRequestError('Invoice ID is required');
      }

      const updated = await InvoiceService.recordPayment(
        organizationId,
        id,
        req.body as RecordPaymentInput,
      );
      sendSuccess(res, updated);
    } catch (err) {
      next(err);
    }
  }

  /**
   * DELETE /api/v1/invoices/:id
   */
  public static async delete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const id = req.params.id;
      if (!id) {
        throw new BadRequestError('Invoice ID is required');
      }

      await InvoiceService.deleteInvoice(organizationId, id);
      sendSuccess(res, { success: true, message: 'Invoice removed successfully' });
    } catch (err) {
      next(err);
    }
  }
}
