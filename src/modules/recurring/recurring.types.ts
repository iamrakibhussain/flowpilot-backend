import { z } from 'zod';
import type { RecurringFrequency, RecurringStatus } from '@prisma/client';

export const RecurringFrequencyEnum = z.enum([
  'WEEKLY',
  'BI_WEEKLY',
  'MONTHLY',
  'QUARTERLY',
  'ANNUALLY',
]);

export const RecurringStatusEnum = z.enum(['ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED']);

export const recurringItemSchema = z.object({
  description: z.string().min(1, { message: 'Item description is required' }).max(255),
  quantity: z.number().int().min(1, { message: 'Quantity must be at least 1' }).default(1),
  unitPrice: z.number().min(0, { message: 'Unit price cannot be negative' }),
  amount: z.number().min(0).optional(),
});

export type RecurringItem = z.infer<typeof recurringItemSchema>;

export const createRecurringScheduleSchema = z.object({
  customerId: z.string().uuid({ message: 'Valid customer ID is required' }),
  title: z.string().min(2, { message: 'Title must be at least 2 characters' }).max(200),
  frequency: RecurringFrequencyEnum.default('MONTHLY'),
  currency: z.string().min(3).max(3).default('USD'),
  taxRate: z.number().min(0).max(100).default(0),
  items: z.array(recurringItemSchema).min(1, { message: 'At least one line item is required' }),
  isRetainer: z.boolean().default(false),
  retainerHours: z.number().min(0).optional().nullable(),
  overageHourlyRate: z.number().min(0).optional().nullable(),
  startDate: z.string().min(1, { message: 'Start date is required' }),
  endDate: z.string().optional().nullable(),
  maxOccurrences: z.number().int().positive().optional().nullable(),
  autoSendEmail: z.boolean().default(true),
  paymentDueDays: z.number().int().min(0).max(120).default(14),
});

export type CreateRecurringScheduleInput = z.infer<typeof createRecurringScheduleSchema>;

export const updateRecurringScheduleSchema = z.object({
  customerId: z.string().uuid().optional(),
  title: z.string().min(2).max(200).optional(),
  frequency: RecurringFrequencyEnum.optional(),
  currency: z.string().min(3).max(3).optional(),
  taxRate: z.number().min(0).max(100).optional(),
  items: z.array(recurringItemSchema).min(1).optional(),
  isRetainer: z.boolean().optional(),
  retainerHours: z.number().min(0).optional().nullable(),
  overageHourlyRate: z.number().min(0).optional().nullable(),
  startDate: z.string().optional(),
  endDate: z.string().optional().nullable(),
  maxOccurrences: z.number().int().positive().optional().nullable(),
  autoSendEmail: z.boolean().optional(),
  paymentDueDays: z.number().int().min(0).max(120).optional(),
  status: RecurringStatusEnum.optional(),
});

export type UpdateRecurringScheduleInput = z.infer<typeof updateRecurringScheduleSchema>;

export const logRetainerHoursSchema = z.object({
  hours: z.number().positive({ message: 'Logged hours must be greater than zero' }),
  notes: z.string().max(1000).optional().nullable(),
  date: z.string().optional(),
});

export type LogRetainerHoursInput = z.infer<typeof logRetainerHoursSchema>;

export interface ListRecurringSchedulesQuery {
  status?: RecurringStatus;
  customerId?: string;
  frequency?: RecurringFrequency;
  search?: string;
  page?: number;
  limit?: number;
}

export interface RecurringScheduleListItem {
  id: string;
  organizationId: string;
  customerId: string;
  customerName: string;
  customerEmail: string;
  customerCompany: string | null;
  title: string;
  frequency: RecurringFrequency;
  status: RecurringStatus;
  currency: string;
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  total: number;
  items: RecurringItem[];
  isRetainer: boolean;
  retainerHours: number | null;
  overageHourlyRate: number | null;
  startDate: string;
  endDate: string | null;
  nextRunDate: string;
  lastRunDate: string | null;
  totalOccurrences: number;
  maxOccurrences: number | null;
  autoSendEmail: boolean;
  paymentDueDays: number;
  createdAt: string;
  updatedAt: string;
  invoicesCount?: number;
  currentRetainerLog?: {
    cycleStartDate: string;
    cycleEndDate: string;
    hoursAllocated: number;
    hoursLogged: number;
    overageHours: number;
    hoursRemaining: number;
  } | null;
}

export interface ScheduleInvoiceSummary {
  id: string;
  invoiceNumber: string;
  issueDate: string;
  dueDate: string;
  status: string;
  total: number;
  paidAt: string | null;
}

export interface ScheduleRetainerLogSummary {
  id: string;
  cycleStartDate: string;
  cycleEndDate: string;
  hoursAllocated: number;
  hoursLogged: number;
  overageHours: number;
  notes: string | null;
  createdAt: string;
}

export interface RecurringScheduleDetails extends RecurringScheduleListItem {
  invoices: ScheduleInvoiceSummary[];
  allRetainerLogs: ScheduleRetainerLogSummary[];
}

export interface RecurringStatsResponse {
  totalSchedules: number;
  activeSchedules: number;
  pausedSchedules: number;
  completedSchedules: number;
  activeRetainers: number;
  estimatedMRR: number;
  totalGeneratedInvoices: number;
}
