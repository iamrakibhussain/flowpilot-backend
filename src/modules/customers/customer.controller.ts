import { Request, Response, NextFunction } from 'express';
import { CustomerService } from './customer.service.js';
import { sendSuccess } from '../../common/http/response.js';
import { BadRequestError } from '../../common/errors/app-error.js';
import { CustomerStatus } from '@prisma/client';
import { ListCustomersQuery } from './customer.types.js';

export class CustomerController {
  /**
   * GET /api/v1/customers
   */
  public static async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const { search, status, tag, page, limit, sortBy, sortOrder } = req.query;

      const query: ListCustomersQuery = {
        search: typeof search === 'string' ? search : undefined,
        status:
          typeof status === 'string' &&
          Object.values(CustomerStatus).includes(status as CustomerStatus)
            ? (status as CustomerStatus)
            : undefined,
        tag: typeof tag === 'string' ? tag : undefined,
        page: page ? Number(page) : 1,
        limit: limit ? Number(limit) : 20,
        sortBy: sortBy === 'name' || sortBy === 'email' || sortBy === 'ltv' ? sortBy : 'createdAt',
        sortOrder: sortOrder === 'asc' ? 'asc' : 'desc',
      };

      const result = await CustomerService.listCustomers(organizationId, query);
      sendSuccess(res, result);
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/v1/customers/:id
   */
  public static async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const customerId = req.params.id;
      if (!customerId) {
        throw new BadRequestError('Customer ID is required');
      }

      const customer = await CustomerService.getCustomerById(organizationId, customerId);
      sendSuccess(res, customer);
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/v1/customers
   */
  public static async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const { name, email, phone, company, status, notes, tags, address } = req.body;

      const customer = await CustomerService.createCustomer(organizationId, {
        name,
        email,
        phone,
        company,
        status,
        notes,
        tags: Array.isArray(tags) ? tags : undefined,
        address: typeof address === 'string' ? address : undefined,
      });

      sendSuccess(res, customer, 201);
    } catch (err) {
      next(err);
    }
  }

  /**
   * PATCH /api/v1/customers/:id
   */
  public static async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const customerId = req.params.id;
      if (!customerId) {
        throw new BadRequestError('Customer ID is required');
      }
      const { name, email, phone, company, status, notes, tags, address } = req.body;

      const customer = await CustomerService.updateCustomer(organizationId, customerId, {
        name,
        email,
        phone,
        company,
        status,
        notes,
        tags: Array.isArray(tags) ? tags : undefined,
        address: typeof address === 'string' ? address : undefined,
      });

      sendSuccess(res, customer);
    } catch (err) {
      next(err);
    }
  }

  /**
   * DELETE /api/v1/customers/:id
   */
  public static async archive(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const customerId = req.params.id;
      if (!customerId) {
        throw new BadRequestError('Customer ID is required');
      }

      const result = await CustomerService.archiveCustomer(organizationId, customerId);
      sendSuccess(res, result);
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/v1/customers/:id/reactivate
   */
  public static async reactivate(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const customerId = req.params.id;
      if (!customerId) {
        throw new BadRequestError('Customer ID is required');
      }

      const result = await CustomerService.reactivateCustomer(organizationId, customerId);
      sendSuccess(res, result);
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/v1/customers/:id/notes
   */
  public static async addNote(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const customerId = req.params.id;
      if (!customerId) {
        throw new BadRequestError('Customer ID is required');
      }
      const { content } = req.body;
      const authorName = req.user?.name ?? 'Team Specialist';

      const notes = await CustomerService.addNote(organizationId, customerId, content, authorName);
      sendSuccess(res, { notes }, 201);
    } catch (err) {
      next(err);
    }
  }
}
