import { z } from 'zod';

export type ProjectStatus = 'PLANNING' | 'ACTIVE' | 'ON_HOLD' | 'COMPLETED' | 'CANCELLED';
export type TaskStatus = 'BACKLOG' | 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'DONE';
export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';

export const ProjectStatusEnum = z.enum([
  'PLANNING',
  'ACTIVE',
  'ON_HOLD',
  'COMPLETED',
  'CANCELLED',
]);

export const TaskStatusEnum = z.enum(['BACKLOG', 'TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE']);

export const TaskPriorityEnum = z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']);

export interface ListProjectsQuery {
  status?: ProjectStatus;
  customerId?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export interface TaskChecklistDto {
  id: string;
  taskId: string;
  title: string;
  isCompleted: boolean;
  sortOrder: number;
  createdAt: string;
}

export interface ProjectTaskDto {
  id: string;
  organizationId: string;
  projectId: string;
  assigneeId: string | null;
  assigneeName?: string | null;
  assigneeEmail?: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  sortOrder: number;
  checklistsCount: number;
  completedChecklistsCount: number;
  checklists: TaskChecklistDto[];
  createdAt: string;
  updatedAt: string;
}

export interface ProjectListItem {
  id: string;
  organizationId: string;
  customerId: string | null;
  customerName?: string | null;
  customerCompany?: string | null;
  quoteId: string | null;
  quoteNumber?: string | null;
  createdById: string | null;
  name: string;
  description: string | null;
  status: ProjectStatus;
  color: string;
  startDate: string | null;
  targetDate: string | null;
  completedAt: string | null;
  budget: number | null;
  currency: string;
  totalTasks: number;
  completedTasks: number;
  progressPercentage: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectDetailResponse extends ProjectListItem {
  tasks: ProjectTaskDto[];
  tasksByStatus: Record<TaskStatus, ProjectTaskDto[]>;
}

export interface ProjectStatsResponse {
  totalProjects: number;
  activeProjects: number;
  planningProjects: number;
  completedProjects: number;
  onHoldProjects: number;
  overdueTasksCount: number;
  totalTasksCount: number;
  completedTasksCount: number;
  overallCompletionRate: number;
}

export const createChecklistItemSchema = z.object({
  title: z.string().trim().min(1, 'Checklist item title is required').max(200),
});

export const updateChecklistItemSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  isCompleted: z.boolean().optional(),
});

export const createTaskSchema = z.object({
  title: z.string().trim().min(2, 'Task title must be at least 2 characters').max(200),
  description: z
    .string()
    .trim()
    .max(3000)
    .nullable()
    .optional()
    .or(z.literal(''))
    .transform((val) => (val && val.length > 0 ? val : null)),
  status: TaskStatusEnum.default('TODO'),
  priority: TaskPriorityEnum.default('MEDIUM'),
  assigneeId: z
    .string()
    .uuid()
    .nullable()
    .optional()
    .or(z.literal(''))
    .transform((val) => (val && val.length > 0 ? val : null)),
  dueDate: z
    .string()
    .datetime()
    .nullable()
    .optional()
    .or(z.literal(''))
    .transform((val) => (val && val.length > 0 ? val : null)),
  sortOrder: z.coerce.number().optional().default(0),
});

export const updateTaskSchema = z.object({
  title: z.string().trim().min(2).max(200).optional(),
  description: z
    .string()
    .trim()
    .max(3000)
    .nullable()
    .optional()
    .or(z.literal(''))
    .transform((val) => (val && val.length > 0 ? val : null)),
  status: TaskStatusEnum.optional(),
  priority: TaskPriorityEnum.optional(),
  assigneeId: z
    .string()
    .uuid()
    .nullable()
    .optional()
    .or(z.literal(''))
    .transform((val) => (val && val.length > 0 ? val : null)),
  dueDate: z
    .string()
    .datetime()
    .nullable()
    .optional()
    .or(z.literal(''))
    .transform((val) => (val && val.length > 0 ? val : null)),
  sortOrder: z.coerce.number().optional(),
});

export const createProjectSchema = z.object({
  customerId: z
    .string()
    .uuid()
    .nullable()
    .optional()
    .or(z.literal(''))
    .transform((val) => (val && val.length > 0 ? val : null)),
  quoteId: z
    .string()
    .uuid()
    .nullable()
    .optional()
    .or(z.literal(''))
    .transform((val) => (val && val.length > 0 ? val : null)),
  name: z.string().trim().min(2, 'Project name must be at least 2 characters').max(150),
  description: z
    .string()
    .trim()
    .max(2000)
    .nullable()
    .optional()
    .or(z.literal(''))
    .transform((val) => (val && val.length > 0 ? val : null)),
  status: ProjectStatusEnum.default('PLANNING'),
  color: z
    .string()
    .trim()
    .regex(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/, 'Must be a valid hex color code')
    .default('#3b82f6'),
  startDate: z
    .string()
    .datetime()
    .nullable()
    .optional()
    .or(z.literal(''))
    .transform((val) => (val && val.length > 0 ? val : null)),
  targetDate: z
    .string()
    .datetime()
    .nullable()
    .optional()
    .or(z.literal(''))
    .transform((val) => (val && val.length > 0 ? val : null)),
  budget: z.coerce.number().min(0).nullable().optional(),
  currency: z.string().trim().min(2).max(10).default('USD'),
  initialTasks: z
    .array(
      z.object({
        title: z.string().trim().min(2).max(200),
        status: TaskStatusEnum.default('TODO'),
        priority: TaskPriorityEnum.default('MEDIUM'),
      }),
    )
    .optional(),
});

export const updateProjectSchema = z.object({
  customerId: z
    .string()
    .uuid()
    .nullable()
    .optional()
    .or(z.literal(''))
    .transform((val) => (val && val.length > 0 ? val : null)),
  name: z.string().trim().min(2).max(150).optional(),
  description: z
    .string()
    .trim()
    .max(2000)
    .nullable()
    .optional()
    .or(z.literal(''))
    .transform((val) => (val && val.length > 0 ? val : null)),
  status: ProjectStatusEnum.optional(),
  color: z
    .string()
    .trim()
    .regex(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/, 'Must be a valid hex color code')
    .optional(),
  startDate: z
    .string()
    .datetime()
    .nullable()
    .optional()
    .or(z.literal(''))
    .transform((val) => (val && val.length > 0 ? val : null)),
  targetDate: z
    .string()
    .datetime()
    .nullable()
    .optional()
    .or(z.literal(''))
    .transform((val) => (val && val.length > 0 ? val : null)),
  budget: z.coerce.number().min(0).nullable().optional(),
  currency: z.string().trim().min(2).max(10).optional(),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type CreateChecklistItemInput = z.infer<typeof createChecklistItemSchema>;
export type UpdateChecklistItemInput = z.infer<typeof updateChecklistItemSchema>;
