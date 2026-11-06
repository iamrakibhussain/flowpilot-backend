import { FlowRuleTrigger, FlowRuleAction } from '@prisma/client';

export { FlowRuleTrigger, FlowRuleAction };

export interface FlowRuleConditions {
  minAmount?: number;
  maxAmount?: number;
  templateId?: string;
  serviceId?: string;
  statusEquals?: string;
  [key: string]: unknown;
}

export interface FlowRuleActionConfig {
  projectTitleTemplate?: string; // e.g. "Project: {{entityTitle}}"
  depositPercent?: number; // e.g. 50
  paymentDueDays?: number; // e.g. 14
  emailSubjectTemplate?: string;
  emailBodyTemplate?: string;
  notificationMessage?: string;
  assigneeId?: string;
  [key: string]: unknown;
}

export interface CreateFlowRuleInput {
  title: string;
  description?: string;
  trigger: FlowRuleTrigger;
  action: FlowRuleAction;
  conditions?: FlowRuleConditions;
  actionConfig?: FlowRuleActionConfig;
  isActive?: boolean;
}

export interface UpdateFlowRuleInput {
  title?: string;
  description?: string | null;
  trigger?: FlowRuleTrigger;
  action?: FlowRuleAction;
  conditions?: FlowRuleConditions;
  actionConfig?: FlowRuleActionConfig;
  isActive?: boolean;
}

export interface FlowRuleListItem {
  id: string;
  organizationId: string;
  title: string;
  description: string | null;
  trigger: FlowRuleTrigger;
  action: FlowRuleAction;
  isActive: boolean;
  conditions: FlowRuleConditions;
  actionConfig: FlowRuleActionConfig;
  lastTriggeredAt: string | null;
  executionCount: number;
  createdAt: string;
  updatedAt: string;
  latestExecution?: {
    status: string;
    executedAt: string;
    durationMs: number;
  } | null;
}

export interface FlowRuleExecutionItem {
  id: string;
  ruleId: string;
  ruleTitle?: string;
  organizationId: string;
  status: 'SUCCESS' | 'FAILED' | 'SKIPPED';
  triggerEvent: string;
  entityId: string;
  executionDurationMs: number;
  errorMessage: string | null;
  logs: Record<string, unknown> | null;
  executedAt: string;
}

export interface FlowRuleStatsResponse {
  totalRules: number;
  activeRules: number;
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  successRate: number;
  estimatedHoursSaved: number;
}

export interface EventDispatchPayload {
  entityId: string;
  customerId?: string;
  title?: string;
  amount?: number;
  metadata?: Record<string, unknown>;
}
