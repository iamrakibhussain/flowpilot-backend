import crypto from 'node:crypto';
import {
  Prisma,
  FlowRuleTrigger,
  FlowRuleAction,
  ProjectStatus,
  TaskPriority,
  InvoiceStatus,
  NotificationType,
  FlowRule,
  FlowRuleExecution,
} from '@prisma/client';
import { prisma } from '../../database/prisma.js';
import { NotFoundError } from '../../common/errors/app-error.js';
import { logger } from '../../common/logging/logger.js';
import { InvoiceService } from '../invoices/invoice.service.js';
import { EmailService } from '../../common/email/email.service.js';
import {
  CreateFlowRuleInput,
  UpdateFlowRuleInput,
  FlowRuleListItem,
  FlowRuleExecutionItem,
  FlowRuleStatsResponse,
  EventDispatchPayload,
  FlowRuleConditions,
  FlowRuleActionConfig,
} from './flow-rules.types.js';
import { ListFlowRulesQueryType } from './flow-rules.validation.js';

type FlowRuleWithRelations = FlowRule & {
  runs?: FlowRuleExecution[];
};

export class FlowRulesService {
  /**
   * Format Prisma entity into standardized client response
   */
  private static formatRule(rule: FlowRuleWithRelations): FlowRuleListItem {
    const latestRun = rule.runs && rule.runs.length > 0 ? rule.runs[0] : null;

    return {
      id: rule.id,
      organizationId: rule.organizationId,
      title: rule.title,
      description: rule.description,
      trigger: rule.trigger,
      action: rule.action,
      isActive: rule.isActive,
      conditions: (rule.conditionsJson as FlowRuleConditions) || {},
      actionConfig: (rule.actionConfigJson as FlowRuleActionConfig) || {},
      lastTriggeredAt: rule.lastTriggeredAt ? rule.lastTriggeredAt.toISOString() : null,
      executionCount: rule.executionCount,
      createdAt: rule.createdAt.toISOString(),
      updatedAt: rule.updatedAt.toISOString(),
      latestExecution: latestRun
        ? {
            status: latestRun.status,
            executedAt: latestRun.executedAt.toISOString(),
            durationMs: latestRun.executionDurationMs,
          }
        : null,
    };
  }

  /**
   * Format Execution entity into client response
   */
  private static formatExecution(
    exec: FlowRuleExecution & { rule?: { title: string } },
  ): FlowRuleExecutionItem {
    return {
      id: exec.id,
      ruleId: exec.ruleId,
      ruleTitle: exec.rule?.title,
      organizationId: exec.organizationId,
      status: exec.status as 'SUCCESS' | 'FAILED' | 'SKIPPED',
      triggerEvent: exec.triggerEvent,
      entityId: exec.entityId,
      executionDurationMs: exec.executionDurationMs,
      errorMessage: exec.errorMessage,
      logs: (exec.logsJson as Record<string, unknown>) || null,
      executedAt: exec.executedAt.toISOString(),
    };
  }

  /**
   * Create a new FlowRule for an organization
   */
  public static async createRule(
    organizationId: string,
    input: CreateFlowRuleInput,
  ): Promise<FlowRuleListItem> {
    const rule = await prisma.flowRule.create({
      data: {
        organizationId,
        title: input.title.trim(),
        description: input.description?.trim() || null,
        trigger: input.trigger,
        action: input.action,
        isActive: input.isActive ?? true,
        conditionsJson: (input.conditions as Prisma.InputJsonValue) || {},
        actionConfigJson: (input.actionConfig as Prisma.InputJsonValue) || {},
      },
    });

    return this.formatRule(rule);
  }

  /**
   * List all FlowRules for an organization with filtering & pagination
   */
  public static async listRules(
    organizationId: string,
    query: ListFlowRulesQueryType,
  ): Promise<{
    rules: FlowRuleListItem[];
    total: number;
    page: number;
    limit: number;
  }> {
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const skip = (page - 1) * limit;

    const where: Prisma.FlowRuleWhereInput = {
      organizationId,
    };

    if (query.trigger) {
      where.trigger = query.trigger;
    }
    if (query.action) {
      where.action = query.action;
    }
    if (query.isActive !== undefined) {
      where.isActive = query.isActive;
    }
    if (query.search && query.search.trim().length > 0) {
      const search = query.search.trim();
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [total, records] = await Promise.all([
      prisma.flowRule.count({ where }),
      prisma.flowRule.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
        include: {
          runs: {
            orderBy: { executedAt: 'desc' },
            take: 1,
          },
        },
      }),
    ]);

    return {
      rules: records.map((r) => this.formatRule(r)),
      total,
      page,
      limit,
    };
  }

  /**
   * Fetch a single FlowRule by ID with recent execution runs
   */
  public static async getRuleById(
    organizationId: string,
    id: string,
  ): Promise<FlowRuleListItem & { recentExecutions: FlowRuleExecutionItem[] }> {
    const rule = await prisma.flowRule.findFirst({
      where: { id, organizationId },
      include: {
        runs: {
          orderBy: { executedAt: 'desc' },
          take: 15,
        },
      },
    });

    if (!rule) {
      throw new NotFoundError('Automation rule not found');
    }

    const formatted = this.formatRule(rule);
    return {
      ...formatted,
      recentExecutions: (rule.runs || []).map((run) => this.formatExecution(run)),
    };
  }

  /**
   * Update an existing FlowRule
   */
  public static async updateRule(
    organizationId: string,
    id: string,
    input: UpdateFlowRuleInput,
  ): Promise<FlowRuleListItem> {
    const existing = await prisma.flowRule.findFirst({
      where: { id, organizationId },
    });

    if (!existing) {
      throw new NotFoundError('Automation rule not found');
    }

    const data: Prisma.FlowRuleUpdateInput = {};
    if (input.title !== undefined) data.title = input.title.trim();
    if (input.description !== undefined) data.description = input.description?.trim() || null;
    if (input.trigger !== undefined) data.trigger = input.trigger;
    if (input.action !== undefined) data.action = input.action;
    if (input.isActive !== undefined) data.isActive = input.isActive;
    if (input.conditions !== undefined)
      data.conditionsJson = input.conditions as Prisma.InputJsonValue;
    if (input.actionConfig !== undefined)
      data.actionConfigJson = input.actionConfig as Prisma.InputJsonValue;

    const updated = await prisma.flowRule.update({
      where: { id },
      data,
      include: {
        runs: {
          orderBy: { executedAt: 'desc' },
          take: 1,
        },
      },
    });

    return this.formatRule(updated);
  }

  /**
   * Toggle a FlowRule's active state
   */
  public static async toggleRule(organizationId: string, id: string): Promise<FlowRuleListItem> {
    const existing = await prisma.flowRule.findFirst({
      where: { id, organizationId },
    });

    if (!existing) {
      throw new NotFoundError('Automation rule not found');
    }

    const updated = await prisma.flowRule.update({
      where: { id },
      data: { isActive: !existing.isActive },
      include: {
        runs: {
          orderBy: { executedAt: 'desc' },
          take: 1,
        },
      },
    });

    return this.formatRule(updated);
  }

  /**
   * Delete a FlowRule
   */
  public static async deleteRule(organizationId: string, id: string): Promise<void> {
    const existing = await prisma.flowRule.findFirst({
      where: { id, organizationId },
    });

    if (!existing) {
      throw new NotFoundError('Automation rule not found');
    }

    await prisma.flowRule.delete({
      where: { id },
    });
  }

  /**
   * Fetch aggregate automation statistics for an organization
   */
  public static async getStats(organizationId: string): Promise<FlowRuleStatsResponse> {
    const [totalRules, activeRules, executions] = await Promise.all([
      prisma.flowRule.count({ where: { organizationId } }),
      prisma.flowRule.count({ where: { organizationId, isActive: true } }),
      prisma.flowRuleExecution.findMany({
        where: { organizationId },
        select: { status: true },
      }),
    ]);

    const totalExecutions = executions.length;
    const successfulExecutions = executions.filter((e) => e.status === 'SUCCESS').length;
    const failedExecutions = executions.filter((e) => e.status === 'FAILED').length;
    const successRate =
      totalExecutions > 0 ? Math.round((successfulExecutions / totalExecutions) * 100) : 100;

    // Approximately 15 minutes (0.25 hrs) saved per autonomous workflow execution
    const estimatedHoursSaved = Math.round(successfulExecutions * 0.25 * 10) / 10;

    return {
      totalRules,
      activeRules,
      totalExecutions,
      successfulExecutions,
      failedExecutions,
      successRate,
      estimatedHoursSaved,
    };
  }

  /**
   * Get execution runs history across rules
   */
  public static async getExecutions(
    organizationId: string,
    ruleId?: string,
    page = 1,
    limit = 20,
  ): Promise<{
    executions: FlowRuleExecutionItem[];
    total: number;
    page: number;
    limit: number;
  }> {
    const skip = (Math.max(1, page) - 1) * Math.min(100, Math.max(1, limit));
    const take = Math.min(100, Math.max(1, limit));

    const where: Prisma.FlowRuleExecutionWhereInput = {
      organizationId,
    };
    if (ruleId) {
      where.ruleId = ruleId;
    }

    const [total, records] = await Promise.all([
      prisma.flowRuleExecution.count({ where }),
      prisma.flowRuleExecution.findMany({
        where,
        skip,
        take,
        orderBy: { executedAt: 'desc' },
        include: {
          rule: {
            select: { title: true },
          },
        },
      }),
    ]);

    return {
      executions: records.map((r) => this.formatExecution(r)),
      total,
      page,
      limit: take,
    };
  }

  /**
   * Central Event Dispatcher:
   * Evaluates rules for the given event, checks conditions, executes actions, and writes execution logs.
   * Fully non-blocking and safe: failures in automated actions are captured in execution logs
   * without interrupting or rolling back the parent business operation.
   */
  public static async dispatch(
    organizationId: string,
    trigger: FlowRuleTrigger,
    payload: EventDispatchPayload,
  ): Promise<number> {
    try {
      const activeRules = await prisma.flowRule.findMany({
        where: {
          organizationId,
          trigger,
          isActive: true,
        },
      });

      if (activeRules.length === 0) {
        return 0;
      }

      logger.info(
        { count: activeRules.length, trigger, entityId: payload.entityId, organizationId },
        'FlowRules event dispatcher: evaluating rules for incoming event',
      );

      let executedCount = 0;

      for (const rule of activeRules) {
        const startTime = Date.now();
        const conditions = (rule.conditionsJson as FlowRuleConditions) || {};
        const actionConfig = (rule.actionConfigJson as FlowRuleActionConfig) || {};

        // 1. Condition Evaluation
        let matches = true;

        if (conditions.minAmount != null && payload.amount != null) {
          if (payload.amount < Number(conditions.minAmount)) {
            matches = false;
          }
        }

        if (conditions.maxAmount != null && payload.amount != null) {
          if (payload.amount > Number(conditions.maxAmount)) {
            matches = false;
          }
        }

        if (conditions.templateId && payload.metadata?.templateId) {
          if (conditions.templateId !== payload.metadata.templateId) {
            matches = false;
          }
        }

        if (!matches) {
          await prisma.flowRuleExecution.create({
            data: {
              organizationId,
              ruleId: rule.id,
              status: 'SKIPPED',
              triggerEvent: trigger,
              entityId: payload.entityId,
              executionDurationMs: Date.now() - startTime,
              logsJson: {
                reason: 'Conditions criteria not met',
                payload: payload as unknown as Prisma.InputJsonValue,
              },
            },
          });
          continue;
        }

        // 2. Action Execution with safe try-catch
        try {
          const actionLogs: Record<string, unknown> = {};

          switch (rule.action) {
            case FlowRuleAction.CREATE_PROJECT: {
              const projectName = actionConfig.projectTitleTemplate
                ? actionConfig.projectTitleTemplate.replace(
                    /\{\{entityTitle\}\}/g,
                    payload.title || 'Client Project',
                  )
                : `Project: ${payload.title || 'Automated Delivery'}`;

              const createdProject = await prisma.project.create({
                data: {
                  organizationId,
                  customerId: payload.customerId || null,
                  name: projectName,
                  description: `Autonomous project launched via FlowRule "${rule.title}" from trigger ${trigger} (Ref: ${payload.entityId})`,
                  status: ProjectStatus.PLANNING,
                  startDate: new Date(),
                  targetDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days default
                  tasks: {
                    create: [
                      {
                        organizationId,
                        title: 'Kickoff & Client Onboarding',
                        description:
                          'Review signed requirements, establish milestones, and initialize delivery.',
                        status: 'TODO',
                        priority: TaskPriority.HIGH,
                        sortOrder: 0,
                      },
                    ],
                  },
                },
              });

              actionLogs.createdProjectId = createdProject.id;
              actionLogs.projectName = createdProject.name;
              break;
            }

            case FlowRuleAction.CREATE_INVOICE: {
              const depositPercent = Number(actionConfig.depositPercent) || 50;
              const baseAmount = Number(payload.amount) || 1000;
              const invoiceTotal = Math.round(baseAmount * (depositPercent / 100) * 100) / 100;

              const invoiceNumber = await InvoiceService.generateInvoiceNumber(organizationId);
              const dueDays = Number(actionConfig.paymentDueDays) || 14;
              const dueDate = new Date(Date.now() + dueDays * 24 * 60 * 60 * 1000);
              const paymentToken = crypto.randomBytes(32).toString('hex');
              const paymentTokenExpiry = new Date(dueDate.getTime() + 30 * 24 * 60 * 60 * 1000);

              const createdInvoice = await prisma.invoice.create({
                data: {
                  organizationId,
                  customerId: payload.customerId || '',
                  invoiceNumber,
                  issueDate: new Date(),
                  dueDate,
                  status: InvoiceStatus.PENDING,
                  subtotal: new Prisma.Decimal(invoiceTotal),
                  tax: new Prisma.Decimal(0),
                  total: new Prisma.Decimal(invoiceTotal),
                  paymentToken,
                  paymentTokenExpiry,
                  notes: `Autonomous deposit invoice generated via FlowRule "${rule.title}" (${depositPercent}% deposit for ${payload.title || 'services'}).`,
                  items: {
                    create: [
                      {
                        description: `Initial Deposit (${depositPercent}%) - ${payload.title || 'Services'}`,
                        quantity: 1,
                        unitPrice: new Prisma.Decimal(invoiceTotal),
                        amount: new Prisma.Decimal(invoiceTotal),
                      },
                    ],
                  },
                },
              });

              actionLogs.createdInvoiceId = createdInvoice.id;
              actionLogs.invoiceNumber = createdInvoice.invoiceNumber;
              actionLogs.depositAmount = invoiceTotal;
              break;
            }

            case FlowRuleAction.CREATE_NOTIFICATION: {
              const notificationTitle = `Autonomous Alert: ${rule.title}`;
              const message =
                actionConfig.notificationMessage ||
                `Event "${trigger}" triggered automation rule "${rule.title}" for ${payload.title || 'record'}.`;

              const notification = await prisma.notification.create({
                data: {
                  organizationId,
                  userId: null, // Broadcast to all workspace members
                  type: NotificationType.SYSTEM,
                  title: notificationTitle,
                  message,
                  actionUrl: `/dashboard`,
                  metadata: {
                    ruleId: rule.id,
                    trigger,
                    entityId: payload.entityId,
                  },
                },
              });

              actionLogs.createdNotificationId = notification.id;
              break;
            }

            case FlowRuleAction.SEND_EMAIL: {
              const customerEmail =
                (payload.metadata?.customerEmail as string) ||
                (payload.metadata?.signerEmail as string);

              if (customerEmail) {
                const subject =
                  actionConfig.emailSubjectTemplate ||
                  `Update regarding your project: ${payload.title || 'FlowPilot'}`;
                const body =
                  actionConfig.emailBodyTemplate ||
                  `Hello,\n\nWe have automatically processed the next step for "${payload.title}". Thank you for partnering with us!\n\nBest regards,\nYour Operations Team`;

                await EmailService.sendFlowRuleCustomEmail({
                  to: customerEmail,
                  subject,
                  body,
                });
                actionLogs.dispatchedToEmail = customerEmail;
              } else {
                actionLogs.skippedEmail = 'No recipient customer email found in event payload';
              }
              break;
            }

            default:
              actionLogs.unhandledAction = rule.action;
              break;
          }

          const durationMs = Date.now() - startTime;

          // 3. Record Successful Execution
          await prisma.$transaction([
            prisma.flowRuleExecution.create({
              data: {
                organizationId,
                ruleId: rule.id,
                status: 'SUCCESS',
                triggerEvent: trigger,
                entityId: payload.entityId,
                executionDurationMs: durationMs,
                logsJson: actionLogs as Prisma.InputJsonValue,
              },
            }),
            prisma.flowRule.update({
              where: { id: rule.id },
              data: {
                executionCount: { increment: 1 },
                lastTriggeredAt: new Date(),
              },
            }),
          ]);

          executedCount += 1;
        } catch (actionErr) {
          const durationMs = Date.now() - startTime;
          const errorMessage = actionErr instanceof Error ? actionErr.message : String(actionErr);

          logger.error(
            { err: actionErr, ruleId: rule.id, trigger, entityId: payload.entityId },
            'FlowRule action execution encountered failure',
          );

          await prisma.flowRuleExecution.create({
            data: {
              organizationId,
              ruleId: rule.id,
              status: 'FAILED',
              triggerEvent: trigger,
              entityId: payload.entityId,
              executionDurationMs: durationMs,
              errorMessage,
            },
          });
        }
      }

      return executedCount;
    } catch (dispatchErr) {
      logger.error(
        { err: dispatchErr, trigger, organizationId },
        'Unhandled error in FlowRulesService.dispatch',
      );
      return 0;
    }
  }
}
