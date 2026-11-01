import { z } from 'zod';
import { UserRole } from '../../common/types/index.js';

export const BlockedTimeTypeEnum = z.enum([
  'VACATION',
  'SICK_LEAVE',
  'BREAK',
  'COMPANY_HOLIDAY',
  'TRAINING',
  'OTHER',
]);

export type BlockedTimeType = z.infer<typeof BlockedTimeTypeEnum>;

// Security helper: strip dangerous HTML tags and control characters to prevent stored XSS
function sanitizeString(str: string): string {
  return str
    .replace(/[<>]/g, '') // Strip angle brackets
    .replace(/[\u0000-\u001F\u007F]/g, '') // Strip ASCII control characters
    .trim();
}

export const createBlockedTimeSchema = z
  .object({
    staffMemberId: z.string().uuid().nullable().optional(),
    title: z
      .string()
      .trim()
      .min(2, 'Title must be at least 2 characters')
      .max(100, 'Title cannot exceed 100 characters')
      .transform(sanitizeString)
      .refine((val) => val.length >= 2, {
        message: 'Title contains invalid characters or is too short',
      }),
    type: BlockedTimeTypeEnum.default('BREAK'),
    startTime: z.string().datetime({ message: 'Valid ISO-8601 start date required' }),
    endTime: z.string().datetime({ message: 'Valid ISO-8601 end date required' }),
    allDay: z.boolean().default(false),
    notes: z
      .string()
      .max(500, 'Notes cannot exceed 500 characters')
      .nullable()
      .optional()
      .transform((val) => (val ? sanitizeString(val) : null)),
  })
  .refine(
    (data) => {
      const start = new Date(data.startTime);
      const end = new Date(data.endTime);
      return end > start;
    },
    {
      message: 'End time must be strictly after start time',
      path: ['endTime'],
    },
  )
  .refine(
    (data) => {
      const start = new Date(data.startTime);
      const end = new Date(data.endTime);
      const durationDays = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
      // Maximum 365 days for a single continuous blocked period to prevent DoS
      return durationDays <= 365;
    },
    {
      message: 'A single blocked period cannot exceed 365 days',
      path: ['endTime'],
    },
  )
  .refine(
    (data) => {
      const start = new Date(data.startTime);
      const pastLimit = new Date();
      pastLimit.setFullYear(pastLimit.getFullYear() - 1);
      // Start date cannot be more than 1 year in the past
      return start >= pastLimit;
    },
    {
      message: 'Start date cannot be older than 1 year in the past',
      path: ['startTime'],
    },
  )
  .refine(
    (data) => {
      const start = new Date(data.startTime);
      const futureLimit = new Date();
      futureLimit.setFullYear(futureLimit.getFullYear() + 3);
      // Start date cannot be more than 3 years in the future
      return start <= futureLimit;
    },
    {
      message: 'Start date cannot be more than 3 years into the future',
      path: ['startTime'],
    },
  );

export const updateBlockedTimeSchema = z
  .object({
    staffMemberId: z.string().uuid().nullable().optional(),
    title: z
      .string()
      .trim()
      .min(2, 'Title must be at least 2 characters')
      .max(100, 'Title cannot exceed 100 characters')
      .transform(sanitizeString)
      .optional(),
    type: BlockedTimeTypeEnum.optional(),
    startTime: z.string().datetime().optional(),
    endTime: z.string().datetime().optional(),
    allDay: z.boolean().optional(),
    notes: z
      .string()
      .max(500, 'Notes cannot exceed 500 characters')
      .nullable()
      .optional()
      .transform((val) => (val ? sanitizeString(val) : null)),
  })
  .refine(
    (data) => {
      if (data.startTime && data.endTime) {
        return new Date(data.endTime) > new Date(data.startTime);
      }
      return true;
    },
    {
      message: 'End time must be strictly after start time',
      path: ['endTime'],
    },
  )
  .refine(
    (data) => {
      if (data.startTime && data.endTime) {
        const start = new Date(data.startTime);
        const end = new Date(data.endTime);
        const durationDays = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
        return durationDays <= 365;
      }
      return true;
    },
    {
      message: 'A single blocked period cannot exceed 365 days',
      path: ['endTime'],
    },
  );

export const listBlockedTimesQuerySchema = z
  .object({
    staffMemberId: z.string().uuid().optional(),
    startDate: z.string().datetime().optional(),
    endDate: z.string().datetime().optional(),
  })
  .refine(
    (data) => {
      if (data.startDate && data.endDate) {
        return new Date(data.endDate) >= new Date(data.startDate);
      }
      return true;
    },
    {
      message: 'End date must be on or after start date',
      path: ['endDate'],
    },
  )
  .refine(
    (data) => {
      if (data.startDate && data.endDate) {
        const diffMs = new Date(data.endDate).getTime() - new Date(data.startDate).getTime();
        const diffDays = diffMs / (1000 * 60 * 60 * 24);
        // Prevent massive query window DoS
        return diffDays <= 366;
      }
      return true;
    },
    {
      message: 'Query date range cannot exceed 366 days',
      path: ['endDate'],
    },
  );

export type CreateBlockedTimeInput = z.infer<typeof createBlockedTimeSchema>;
export type UpdateBlockedTimeInput = z.infer<typeof updateBlockedTimeSchema>;
export type ListBlockedTimesQuery = z.infer<typeof listBlockedTimesQuerySchema>;

export interface ActorContext {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  ip?: string | null;
}

export interface BlockedTimeDto {
  id: string;
  organizationId: string;
  staffMemberId: string | null;
  staffName?: string | null;
  title: string;
  type: BlockedTimeType;
  startTime: string;
  endTime: string;
  allDay: boolean;
  notes: string | null;
  affectedAppointmentsCount?: number;
  createdAt: string;
  updatedAt: string;
}
