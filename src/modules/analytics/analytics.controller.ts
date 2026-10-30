import { Request, Response, NextFunction } from 'express';
import { AnalyticsService } from './analytics.service.js';
import { sendSuccess } from '../../common/http/response.js';

export class AnalyticsController {
  public static async getOverview(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const timeframe = typeof req.query.timeframe === 'string' ? req.query.timeframe : undefined;

      const data = await AnalyticsService.getOverview(organizationId, timeframe);
      sendSuccess(res, data);
    } catch (err) {
      next(err);
    }
  }

  public static async getCashflow(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const timeframe = typeof req.query.timeframe === 'string' ? req.query.timeframe : undefined;

      const data = await AnalyticsService.getCashflow(organizationId, timeframe);
      sendSuccess(res, data);
    } catch (err) {
      next(err);
    }
  }

  public static async getServices(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const timeframe = typeof req.query.timeframe === 'string' ? req.query.timeframe : undefined;

      const data = await AnalyticsService.getServiceProfitability(organizationId, timeframe);
      sendSuccess(res, data);
    } catch (err) {
      next(err);
    }
  }

  public static async getStaff(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const timeframe = typeof req.query.timeframe === 'string' ? req.query.timeframe : undefined;

      const data = await AnalyticsService.getStaffProductivity(organizationId, timeframe);
      sendSuccess(res, data);
    } catch (err) {
      next(err);
    }
  }

  public static async getCustomers(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const timeframe = typeof req.query.timeframe === 'string' ? req.query.timeframe : undefined;

      const data = await AnalyticsService.getCustomerIntelligence(organizationId, timeframe);
      sendSuccess(res, data);
    } catch (err) {
      next(err);
    }
  }

  public static async exportCsv(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const timeframe = typeof req.query.timeframe === 'string' ? req.query.timeframe : undefined;

      const csvData = await AnalyticsService.exportCsv(organizationId, timeframe);

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="flowpilot-analytics-${timeframe || '30d'}.csv"`,
      );
      res.status(200).send(csvData);
    } catch (err) {
      next(err);
    }
  }
}
