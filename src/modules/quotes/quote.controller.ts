import { Request, Response, NextFunction } from 'express';
import { QuoteService } from './quote.service.js';
import { sendSuccess } from '../../common/http/response.js';
import {
  createQuoteSchema,
  updateQuoteSchema,
  acceptQuoteSchema,
  declineQuoteSchema,
  ListQuotesQuery,
  QuoteStatus,
} from './quote.types.js';

export class QuoteController {
  /**
   * GET /api/v1/quotes
   */
  public static async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const { status, customerId, startDate, endDate, search, page, limit } = req.query;

      const query: ListQuotesQuery = {
        status: typeof status === 'string' ? (status as QuoteStatus) : undefined,
        customerId: typeof customerId === 'string' ? customerId : undefined,
        startDate: typeof startDate === 'string' ? startDate : undefined,
        endDate: typeof endDate === 'string' ? endDate : undefined,
        search: typeof search === 'string' ? search : undefined,
        page: typeof page === 'string' ? parseInt(page, 10) : undefined,
        limit: typeof limit === 'string' ? parseInt(limit, 10) : undefined,
      };

      const result = await QuoteService.listQuotes(organizationId, query);
      sendSuccess(res, result);
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/v1/quotes/stats
   */
  public static async getStats(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const stats = await QuoteService.getQuoteStats(organizationId);
      sendSuccess(res, stats);
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/v1/quotes/:id
   */
  public static async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const id = req.params.id as string;
      const quote = await QuoteService.getQuoteById(organizationId, id);
      sendSuccess(res, quote);
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/v1/quotes
   */
  public static async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const userId = req.user!.id;
      const validated = createQuoteSchema.parse(req.body);

      const quote = await QuoteService.createQuote(organizationId, userId, validated);
      sendSuccess(res, quote, 201);
    } catch (err) {
      next(err);
    }
  }

  /**
   * PATCH /api/v1/quotes/:id
   */
  public static async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const id = req.params.id as string;
      const validated = updateQuoteSchema.parse(req.body);

      const quote = await QuoteService.updateQuote(organizationId, id, validated);
      sendSuccess(res, quote);
    } catch (err) {
      next(err);
    }
  }

  /**
   * DELETE /api/v1/quotes/:id
   */
  public static async delete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const id = req.params.id as string;
      await QuoteService.deleteQuote(organizationId, id);
      sendSuccess(res, { message: 'Proposal deleted successfully' });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/v1/quotes/:id/send
   */
  public static async send(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const id = req.params.id as string;
      const result = await QuoteService.sendQuote(organizationId, id);
      sendSuccess(res, result);
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/v1/quotes/:id/convert-invoice
   */
  public static async convertToInvoice(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const userId = req.user!.id;
      const id = req.params.id as string;
      const result = await QuoteService.convertToInvoice(organizationId, userId, id);
      sendSuccess(res, result);
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/v1/public/quotes/:token
   */
  public static async getPublic(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const token = req.params.token as string;
      const quote = await QuoteService.getPublicQuote(token);
      sendSuccess(res, quote);
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/v1/public/quotes/:token/accept
   */
  public static async acceptPublic(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const token = req.params.token as string;
      const validated = acceptQuoteSchema.parse(req.body);
      const ip = req.ip || req.headers['x-forwarded-for']?.toString() || req.socket.remoteAddress;

      const result = await QuoteService.acceptPublicQuote(token, validated, ip);
      sendSuccess(res, result);
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/v1/public/quotes/:token/decline
   */
  public static async declinePublic(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const token = req.params.token as string;
      const validated = declineQuoteSchema.parse(req.body);

      const result = await QuoteService.declinePublicQuote(token, validated);
      sendSuccess(res, result);
    } catch (err) {
      next(err);
    }
  }
}
