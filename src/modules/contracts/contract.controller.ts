import { Request, Response, NextFunction } from 'express';
import { ContractService } from './contract.service.js';
import { sendSuccess } from '../../common/http/response.js';
import {
  createContractSchema,
  updateContractSchema,
  signContractPublicSchema,
  countersignContractSchema,
  declineContractSchema,
  ListContractsQuery,
} from './contract.types.js';
import type { ContractStatus } from '@prisma/client';

export class ContractController {
  /**
   * GET /api/v1/contracts
   */
  public static async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const { status, customerId, quoteId, projectId, search, page, limit } = req.query;

      const query: ListContractsQuery = {
        status: typeof status === 'string' ? (status as ContractStatus) : undefined,
        customerId: typeof customerId === 'string' ? customerId : undefined,
        quoteId: typeof quoteId === 'string' ? quoteId : undefined,
        projectId: typeof projectId === 'string' ? projectId : undefined,
        search: typeof search === 'string' ? search : undefined,
        page: typeof page === 'string' ? parseInt(page, 10) : undefined,
        limit: typeof limit === 'string' ? parseInt(limit, 10) : undefined,
      };

      const result = await ContractService.listContracts(organizationId, query);
      sendSuccess(res, result);
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/v1/contracts/:id
   */
  public static async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const id = req.params.id as string;
      const contract = await ContractService.getContractById(organizationId, id);
      sendSuccess(res, contract);
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/v1/contracts
   */
  public static async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const userId = req.user?.id || 'system';
      const input = createContractSchema.parse(req.body);

      const contract = await ContractService.createContract(organizationId, userId, input);
      sendSuccess(res, contract, 201, 'Contract created successfully');
    } catch (err) {
      next(err);
    }
  }

  /**
   * PATCH /api/v1/contracts/:id
   */
  public static async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const id = req.params.id as string;
      const input = updateContractSchema.parse(req.body);

      const contract = await ContractService.updateContract(organizationId, id, input);
      sendSuccess(res, contract, 200, 'Contract updated successfully');
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/v1/contracts/:id/send
   */
  public static async send(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const id = req.params.id as string;

      const result = await ContractService.sendContract(organizationId, id);
      sendSuccess(res, result, 200, 'Contract dispatched for signature');
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/v1/contracts/:id/countersign
   */
  public static async countersign(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const userId = req.user?.id || 'system';
      const id = req.params.id as string;
      const input = countersignContractSchema.parse(req.body);

      const contract = await ContractService.countersignContract(organizationId, id, userId, input);
      sendSuccess(res, contract, 200, 'Contract countersigned successfully');
    } catch (err) {
      next(err);
    }
  }

  /**
   * DELETE /api/v1/contracts/:id
   */
  public static async delete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const id = req.params.id as string;

      const result = await ContractService.deleteContract(organizationId, id);
      sendSuccess(res, result, 200, 'Draft contract removed');
    } catch (err) {
      next(err);
    }
  }

  // --- Public Unauthenticated Endpoints ---

  /**
   * GET /api/v1/public/contracts/:token
   */
  public static async getPublic(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const token = req.params.token as string;
      const contract = await ContractService.getPublicContractByToken(token);
      sendSuccess(res, contract);
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/v1/public/contracts/:token/sign
   */
  public static async signPublic(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const token = req.params.token as string;
      const input = signContractPublicSchema.parse(req.body);
      const meta = {
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      };

      const result = await ContractService.signContractPublic(token, input, meta);
      sendSuccess(res, result, 200, 'Contract successfully signed and verified');
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/v1/public/contracts/:token/decline
   */
  public static async declinePublic(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const token = req.params.token as string;
      const input = declineContractSchema.parse(req.body);

      const result = await ContractService.declineContractPublic(token, input);
      sendSuccess(res, result, 200, result.message);
    } catch (err) {
      next(err);
    }
  }
}
