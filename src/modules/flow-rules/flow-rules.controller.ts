import { Request, Response, NextFunction } from 'express';
import { FlowRulesService } from './flow-rules.service.js';
import { sendSuccess } from '../../common/http/response.js';
import {
  createFlowRuleSchema,
  updateFlowRuleSchema,
  listFlowRulesQuerySchema,
  testFlowRuleSchema,
} from './flow-rules.validation.js';

export class FlowRulesController {
  public static async createRule(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const validated = createFlowRuleSchema.parse(req.body);

      const rule = await FlowRulesService.createRule(organizationId, validated);
      sendSuccess(res, rule, 201);
    } catch (err) {
      next(err);
    }
  }

  public static async listRules(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const query = listFlowRulesQuerySchema.parse(req.query);

      const result = await FlowRulesService.listRules(organizationId, query);
      sendSuccess(res, result);
    } catch (err) {
      next(err);
    }
  }

  public static async getRuleById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const id = req.params.id as string;

      const rule = await FlowRulesService.getRuleById(organizationId, id);
      sendSuccess(res, rule);
    } catch (err) {
      next(err);
    }
  }

  public static async updateRule(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const id = req.params.id as string;
      const validated = updateFlowRuleSchema.parse(req.body);

      const updated = await FlowRulesService.updateRule(organizationId, id, validated);
      sendSuccess(res, updated);
    } catch (err) {
      next(err);
    }
  }

  public static async toggleRule(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const id = req.params.id as string;

      const updated = await FlowRulesService.toggleRule(organizationId, id);
      sendSuccess(res, updated);
    } catch (err) {
      next(err);
    }
  }

  public static async deleteRule(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const id = req.params.id as string;

      await FlowRulesService.deleteRule(organizationId, id);
      sendSuccess(res, { message: 'Automation rule deleted successfully' });
    } catch (err) {
      next(err);
    }
  }

  public static async getStats(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;

      const stats = await FlowRulesService.getStats(organizationId);
      sendSuccess(res, stats);
    } catch (err) {
      next(err);
    }
  }

  public static async getExecutions(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const ruleId =
        (req.params.id as string | undefined) || (req.query.ruleId as string | undefined);
      const page = parseInt(req.query.page as string, 10) || 1;
      const limit = parseInt(req.query.limit as string, 10) || 20;

      const executions = await FlowRulesService.getExecutions(organizationId, ruleId, page, limit);
      sendSuccess(res, executions);
    } catch (err) {
      next(err);
    }
  }

  public static async testRule(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const id = req.params.id as string;
      const sample = testFlowRuleSchema.parse(req.body);

      const rule = await FlowRulesService.getRuleById(organizationId, id);

      const entityId = sample.entityId || sample.sampleEntityId || crypto.randomUUID();
      const customerId = sample.customerId || sample.sampleCustomerId;
      const amount = sample.amount ?? sample.sampleAmount ?? 1500;
      const title = sample.title || `Test Run for ${rule.title}`;

      const count = await FlowRulesService.dispatch(organizationId, rule.trigger, {
        entityId,
        customerId,
        amount,
        title,
        metadata: { isTestRun: true },
      });

      sendSuccess(res, {
        simulated: true,
        ruleId: rule.id,
        matched: true,
        evaluationDetails: {
          ruleTitle: rule.title,
          trigger: rule.trigger,
          action: rule.action,
          conditionsEvaluated: rule.conditions,
          simulatedPayload: { entityId, customerId, amount, title },
        },
        simulatedActionLogs: {
          executedCount: count,
          message: `Test run completed. Triggered ${count} automated action(s).`,
        },
      });
    } catch (err) {
      next(err);
    }
  }
}
