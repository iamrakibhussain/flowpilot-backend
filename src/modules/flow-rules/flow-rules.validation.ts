import { z } from 'zod';
import { FlowRuleTrigger, FlowRuleAction } from '@prisma/client';

export const createFlowRuleSchema = z.object({
  title: z
    .string({ required_error: 'Rule title is required' })
    .trim()
    .min(2, 'Title must be at least 2 characters')
    .max(120, 'Title cannot exceed 120 characters'),
  description: z.string().trim().max(500, 'Description cannot exceed 500 characters').optional(),
  trigger: z.nativeEnum(FlowRuleTrigger, {
    errorMap: () => ({ message: 'Invalid trigger event selected' }),
  }),
  action: z.nativeEnum(FlowRuleAction, {
    errorMap: () => ({ message: 'Invalid action type selected' }),
  }),
  conditions: z.record(z.unknown()).optional().default({}),
  actionConfig: z.record(z.unknown()).optional().default({}),
  isActive: z.boolean().optional().default(true),
});

export const updateFlowRuleSchema = z.object({
  title: z
    .string()
    .trim()
    .min(2, 'Title must be at least 2 characters')
    .max(120, 'Title cannot exceed 120 characters')
    .optional(),
  description: z.string().trim().max(500).optional().nullable(),
  trigger: z.nativeEnum(FlowRuleTrigger).optional(),
  action: z.nativeEnum(FlowRuleAction).optional(),
  conditions: z.record(z.unknown()).optional(),
  actionConfig: z.record(z.unknown()).optional(),
  isActive: z.boolean().optional(),
});

export const listFlowRulesQuerySchema = z.object({
  trigger: z.nativeEnum(FlowRuleTrigger).optional(),
  action: z.nativeEnum(FlowRuleAction).optional(),
  isActive: z
    .string()
    .optional()
    .transform((val) => {
      if (val === 'true') return true;
      if (val === 'false') return false;
      return undefined;
    }),
  search: z.string().trim().optional(),
  page: z
    .string()
    .optional()
    .transform((val) => (val ? Math.max(1, parseInt(val, 10)) : 1)),
  limit: z
    .string()
    .optional()
    .transform((val) => (val ? Math.min(100, Math.max(1, parseInt(val, 10))) : 20)),
});

export const testFlowRuleSchema = z.object({
  sampleEntityId: z.string().optional(),
  entityId: z.string().optional(),
  sampleAmount: z.number().min(0).optional(),
  amount: z.number().min(0).optional(),
  sampleCustomerId: z.string().optional(),
  customerId: z.string().optional(),
  title: z.string().optional(),
});

export type CreateFlowRuleInputType = z.infer<typeof createFlowRuleSchema>;
export type UpdateFlowRuleInputType = z.infer<typeof updateFlowRuleSchema>;
export type ListFlowRulesQueryType = z.infer<typeof listFlowRulesQuerySchema>;
export type TestFlowRuleInputType = z.infer<typeof testFlowRuleSchema>;
