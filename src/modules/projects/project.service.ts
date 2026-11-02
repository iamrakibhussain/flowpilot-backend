import { Prisma } from '@prisma/client';
import { prisma } from '../../database/prisma.js';
import { NotFoundError, BadRequestError } from '../../common/errors/app-error.js';
import { NotificationService } from '../notifications/notification.service.js';
import {
  ListProjectsQuery,
  CreateProjectInput,
  UpdateProjectInput,
  CreateTaskInput,
  UpdateTaskInput,
  CreateChecklistItemInput,
  UpdateChecklistItemInput,
  ProjectListItem,
  ProjectDetailResponse,
  ProjectStatsResponse,
  ProjectTaskDto,
  TaskStatus,
  TaskPriority,
  ProjectStatus,
} from './project.types.js';

interface RawChecklistItem {
  id: string;
  taskId: string;
  title: string;
  isCompleted: boolean;
  sortOrder: number;
  createdAt: Date;
}

interface RawProjectTask {
  id: string;
  organizationId: string;
  projectId: string;
  assigneeId: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: string;
  dueDate: Date | null;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
  assignee?: { id: string; name: string; email: string } | null;
  checklists?: RawChecklistItem[];
}

interface RawProjectWithRelations {
  id: string;
  organizationId: string;
  customerId: string | null;
  quoteId: string | null;
  createdById: string | null;
  name: string;
  description: string | null;
  status: ProjectStatus;
  color: string | null;
  startDate: Date | null;
  targetDate: Date | null;
  completedAt: Date | null;
  budget: Prisma.Decimal | number | null;
  currency: string;
  createdAt: Date;
  updatedAt: Date;
  customer?: { id: string; name: string; company: string | null } | null;
  quote?: { id: string; quoteNumber: string } | null;
  tasks?: RawProjectTask[];
}

// Type-safe model accessor
const prismaProjects = prisma as unknown as {
  project: {
    findMany: (args: unknown) => Promise<RawProjectWithRelations[]>;
    findFirst: (args: unknown) => Promise<RawProjectWithRelations | null>;
    count: (args: unknown) => Promise<number>;
    create: (args: unknown) => Promise<RawProjectWithRelations>;
    update: (args: unknown) => Promise<RawProjectWithRelations>;
    delete: (args: unknown) => Promise<unknown>;
  };
  projectTask: {
    findMany: (args: unknown) => Promise<RawProjectTask[]>;
    findFirst: (args: unknown) => Promise<RawProjectTask | null>;
    count: (args: unknown) => Promise<number>;
    create: (args: unknown) => Promise<RawProjectTask>;
    update: (args: unknown) => Promise<RawProjectTask>;
    delete: (args: unknown) => Promise<unknown>;
  };
  taskChecklistItem: {
    findFirst: (args: unknown) => Promise<RawChecklistItem | null>;
    count: (args: unknown) => Promise<number>;
    create: (args: unknown) => Promise<RawChecklistItem>;
    update: (args: unknown) => Promise<RawChecklistItem>;
    delete: (args: unknown) => Promise<unknown>;
  };
};

export class ProjectService {
  /**
   * Format raw project record into clean DTO with progress statistics
   */
  private static formatProjectListItem(p: RawProjectWithRelations): ProjectListItem {
    const tasks = p.tasks || [];
    const totalTasks = tasks.length;
    const completedTasks = tasks.filter((t) => t.status === 'DONE').length;
    const progressPercentage = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

    return {
      id: p.id,
      organizationId: p.organizationId,
      customerId: p.customerId,
      customerName: p.customer?.name || null,
      customerCompany: p.customer?.company || null,
      quoteId: p.quoteId,
      quoteNumber: p.quote?.quoteNumber || null,
      createdById: p.createdById,
      name: p.name,
      description: p.description,
      status: p.status,
      color: p.color || '#3b82f6',
      startDate: p.startDate ? p.startDate.toISOString() : null,
      targetDate: p.targetDate ? p.targetDate.toISOString() : null,
      completedAt: p.completedAt ? p.completedAt.toISOString() : null,
      budget: p.budget !== null ? Number(p.budget) : null,
      currency: p.currency || 'USD',
      totalTasks,
      completedTasks,
      progressPercentage,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    };
  }

  /**
   * Format single task record into clean DTO
   */
  private static formatTaskDto(t: RawProjectTask): ProjectTaskDto {
    const checklists = t.checklists || [];
    const completedCount = checklists.filter((c) => c.isCompleted).length;

    return {
      id: t.id,
      organizationId: t.organizationId,
      projectId: t.projectId,
      assigneeId: t.assigneeId,
      assigneeName: t.assignee?.name || null,
      assigneeEmail: t.assignee?.email || null,
      title: t.title,
      description: t.description,
      status: t.status,
      priority: t.priority as TaskPriority,
      dueDate: t.dueDate ? t.dueDate.toISOString() : null,
      sortOrder: t.sortOrder,
      checklistsCount: checklists.length,
      completedChecklistsCount: completedCount,
      checklists: checklists.map((c) => ({
        id: c.id,
        taskId: c.taskId,
        title: c.title,
        isCompleted: c.isCompleted,
        sortOrder: c.sortOrder,
        createdAt: c.createdAt.toISOString(),
      })),
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
    };
  }

  /**
   * List projects with filters, pagination, and calculated completion rates
   */
  public static async listProjects(
    organizationId: string,
    query: ListProjectsQuery,
  ): Promise<{ projects: ProjectListItem[]; total: number; page: number; limit: number }> {
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 20));
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = { organizationId };

    if (query.customerId) {
      where.customerId = query.customerId;
    }

    if (query.status) {
      where.status = query.status;
    }

    if (query.search && query.search.trim().length > 0) {
      const term = query.search.trim();
      where.OR = [
        { name: { contains: term, mode: 'insensitive' } },
        { description: { contains: term, mode: 'insensitive' } },
        { customer: { name: { contains: term, mode: 'insensitive' } } },
      ];
    }

    const [projects, total] = await Promise.all([
      prismaProjects.project.findMany({
        where,
        skip,
        take: limit,
        orderBy: { updatedAt: 'desc' },
        include: {
          customer: { select: { id: true, name: true, company: true } },
          quote: { select: { id: true, quoteNumber: true } },
          tasks: { select: { id: true, status: true } },
        },
      }),
      prismaProjects.project.count({ where }),
    ]);

    return {
      projects: projects.map((p) => this.formatProjectListItem(p)),
      total,
      page,
      limit,
    };
  }

  /**
   * Retrieve project detail with grouped tasks for the Kanban board
   */
  public static async getProjectById(
    organizationId: string,
    id: string,
  ): Promise<ProjectDetailResponse> {
    const project = await prismaProjects.project.findFirst({
      where: { id, organizationId },
      include: {
        customer: { select: { id: true, name: true, company: true } },
        quote: { select: { id: true, quoteNumber: true } },
        tasks: {
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          include: {
            assignee: { select: { id: true, name: true, email: true } },
            checklists: { orderBy: { sortOrder: 'asc' } },
          },
        },
      },
    });

    if (!project) {
      throw new NotFoundError('Project not found');
    }

    const formattedTasks = (project.tasks || []).map((t) => this.formatTaskDto(t));

    const tasksByStatus: Record<TaskStatus, ProjectTaskDto[]> = {
      BACKLOG: [],
      TODO: [],
      IN_PROGRESS: [],
      IN_REVIEW: [],
      DONE: [],
    };

    for (const task of formattedTasks) {
      if (tasksByStatus[task.status]) {
        tasksByStatus[task.status].push(task);
      } else {
        tasksByStatus.TODO.push(task);
      }
    }

    const base = this.formatProjectListItem(project);

    return {
      ...base,
      tasks: formattedTasks,
      tasksByStatus,
    };
  }

  /**
   * Aggregate stats for the project overview ribbon
   */
  public static async getProjectStats(organizationId: string): Promise<ProjectStatsResponse> {
    const [projects, tasks] = await Promise.all([
      prismaProjects.project.findMany({
        where: { organizationId },
        select: { id: true, status: true },
      }),
      prismaProjects.projectTask.findMany({
        where: { organizationId },
        select: { id: true, status: true, dueDate: true },
      }),
    ]);

    const now = new Date();
    let overdueTasksCount = 0;
    let completedTasksCount = 0;

    for (const t of tasks) {
      if (t.status === 'DONE') {
        completedTasksCount += 1;
      } else if (t.dueDate && new Date(t.dueDate).getTime() < now.getTime()) {
        overdueTasksCount += 1;
      }
    }

    const counts = {
      totalProjects: projects.length,
      activeProjects: projects.filter((p) => p.status === 'ACTIVE').length,
      planningProjects: projects.filter((p) => p.status === 'PLANNING').length,
      completedProjects: projects.filter((p) => p.status === 'COMPLETED').length,
      onHoldProjects: projects.filter((p) => p.status === 'ON_HOLD').length,
      overdueTasksCount,
      totalTasksCount: tasks.length,
      completedTasksCount,
      overallCompletionRate:
        tasks.length > 0 ? Math.round((completedTasksCount / tasks.length) * 100) : 0,
    };

    return counts;
  }

  /**
   * Create a new delivery project
   */
  public static async createProject(
    organizationId: string,
    userId: string,
    input: CreateProjectInput,
  ): Promise<ProjectDetailResponse> {
    // Verify customer belongs to organization
    if (input.customerId) {
      const customer = await prisma.customer.findFirst({
        where: { id: input.customerId, organizationId },
      });
      if (!customer) {
        throw new NotFoundError('Selected customer does not exist in this organization');
      }
    }

    // Verify quote belongs to organization
    if (input.quoteId) {
      const quoteAccessor = prisma as unknown as {
        quote: {
          findFirst: (args: {
            where: { id: string; organizationId: string };
          }) => Promise<{ id: string } | null>;
        };
      };
      const quote = await quoteAccessor.quote.findFirst({
        where: { id: input.quoteId, organizationId },
      });
      if (!quote) {
        throw new NotFoundError('Selected quote does not exist in this organization');
      }
    }

    const initialTasksData = (input.initialTasks || []).map((t, idx) => ({
      organizationId,
      title: t.title.trim(),
      status: t.status || 'TODO',
      priority: t.priority || 'MEDIUM',
      sortOrder: idx,
    }));

    const created = await prismaProjects.project.create({
      data: {
        organizationId,
        createdById: userId,
        customerId: input.customerId || null,
        quoteId: input.quoteId || null,
        name: input.name.trim(),
        description: input.description?.trim() || null,
        status: input.status || 'PLANNING',
        color: input.color || '#3b82f6',
        startDate: input.startDate ? new Date(input.startDate) : null,
        targetDate: input.targetDate ? new Date(input.targetDate) : null,
        budget:
          input.budget !== undefined && input.budget !== null
            ? new Prisma.Decimal(input.budget)
            : null,
        currency: input.currency || 'USD',
        ...(initialTasksData.length > 0
          ? {
              tasks: {
                create: initialTasksData,
              },
            }
          : {}),
      },
      include: {
        customer: { select: { id: true, name: true, company: true } },
        quote: { select: { id: true, quoteNumber: true } },
        tasks: {
          include: {
            assignee: { select: { id: true, name: true, email: true } },
            checklists: true,
          },
        },
      },
    });

    // Notify workspace
    await NotificationService.createNotification({
      organizationId,
      type: 'PROJECT_CREATED',
      title: `Project Launched: ${created.name}`,
      message: `New delivery project "${created.name}" created.`,
      actionUrl: `/dashboard/projects`,
      metadata: { projectId: created.id, customerId: created.customerId },
    });

    return this.getProjectById(organizationId, created.id);
  }

  /**
   * Update an existing project
   */
  public static async updateProject(
    organizationId: string,
    id: string,
    input: UpdateProjectInput,
  ): Promise<ProjectDetailResponse> {
    const existing = await prismaProjects.project.findFirst({
      where: { id, organizationId },
    });

    if (!existing) {
      throw new NotFoundError('Project not found');
    }

    if (input.customerId) {
      const customer = await prisma.customer.findFirst({
        where: { id: input.customerId, organizationId },
      });
      if (!customer) {
        throw new NotFoundError('Selected customer does not exist in this organization');
      }
    }

    const updateData: Record<string, unknown> = {};
    if (input.name) updateData.name = input.name.trim();
    if (input.description !== undefined) updateData.description = input.description?.trim() || null;
    if (input.status) {
      updateData.status = input.status;
      if (input.status === 'COMPLETED' && !existing.completedAt) {
        updateData.completedAt = new Date();
      } else if (input.status !== 'COMPLETED') {
        updateData.completedAt = null;
      }
    }
    if (input.color) updateData.color = input.color;
    if (input.customerId !== undefined) updateData.customerId = input.customerId;
    if (input.startDate !== undefined) {
      updateData.startDate = input.startDate ? new Date(input.startDate) : null;
    }
    if (input.targetDate !== undefined) {
      updateData.targetDate = input.targetDate ? new Date(input.targetDate) : null;
    }
    if (input.budget !== undefined) {
      updateData.budget = input.budget !== null ? new Prisma.Decimal(input.budget) : null;
    }
    if (input.currency) updateData.currency = input.currency;

    await prismaProjects.project.update({
      where: { id },
      data: updateData,
    });

    return this.getProjectById(organizationId, id);
  }

  /**
   * Delete a project and its tasks
   */
  public static async deleteProject(organizationId: string, id: string): Promise<void> {
    const existing = await prismaProjects.project.findFirst({
      where: { id, organizationId },
    });

    if (!existing) {
      throw new NotFoundError('Project not found');
    }

    await prismaProjects.project.delete({ where: { id } });
  }

  /**
   * Add a new task to a project
   */
  public static async createTask(
    organizationId: string,
    projectId: string,
    userId: string,
    input: CreateTaskInput,
  ): Promise<ProjectTaskDto> {
    const project = await prismaProjects.project.findFirst({
      where: { id: projectId, organizationId },
    });

    if (!project) {
      throw new NotFoundError('Project not found');
    }

    // Verify assignee belongs to organization
    if (input.assigneeId) {
      const member = await prisma.membership.findFirst({
        where: { userId: input.assigneeId, organizationId },
      });
      if (!member) {
        throw new BadRequestError('Assignee is not an active team member of this workspace');
      }
    }

    const taskCount = await prismaProjects.projectTask.count({
      where: { projectId, status: input.status || 'TODO' },
    });

    const sortOrder = input.sortOrder !== undefined ? input.sortOrder : taskCount;

    const task = await prismaProjects.projectTask.create({
      data: {
        organizationId,
        projectId,
        assigneeId: input.assigneeId || null,
        title: input.title.trim(),
        description: input.description?.trim() || null,
        status: input.status || 'TODO',
        priority: input.priority || 'MEDIUM',
        dueDate: input.dueDate ? new Date(input.dueDate) : null,
        sortOrder,
      },
      include: {
        assignee: { select: { id: true, name: true, email: true } },
        checklists: true,
      },
    });

    // Notify assignee if assigned to someone else
    if (input.assigneeId && input.assigneeId !== userId) {
      await NotificationService.createNotification({
        organizationId,
        userId: input.assigneeId,
        type: 'TASK_ASSIGNED',
        title: `Task Assigned: ${task.title}`,
        message: `You were assigned to "${task.title}" in project "${project.name}".`,
        actionUrl: `/dashboard/projects`,
        metadata: { projectId, taskId: task.id },
      });
    }

    return this.formatTaskDto(task);
  }

  /**
   * Update an existing task (drag-and-drop status, priority, order, assignee)
   */
  public static async updateTask(
    organizationId: string,
    projectId: string,
    taskId: string,
    input: UpdateTaskInput,
  ): Promise<ProjectTaskDto> {
    const task = await prismaProjects.projectTask.findFirst({
      where: { id: taskId, projectId, organizationId },
      include: { assignee: true, checklists: true },
    });

    if (!task) {
      throw new NotFoundError('Task not found');
    }

    if (input.assigneeId) {
      const member = await prisma.membership.findFirst({
        where: { userId: input.assigneeId, organizationId },
      });
      if (!member) {
        throw new BadRequestError('Assignee is not an active team member of this workspace');
      }
    }

    const updateData: Record<string, unknown> = {};
    if (input.title) updateData.title = input.title.trim();
    if (input.description !== undefined) updateData.description = input.description?.trim() || null;
    if (input.status) updateData.status = input.status;
    if (input.priority) updateData.priority = input.priority;
    if (input.assigneeId !== undefined) updateData.assigneeId = input.assigneeId;
    if (input.dueDate !== undefined) {
      updateData.dueDate = input.dueDate ? new Date(input.dueDate) : null;
    }
    if (input.sortOrder !== undefined) updateData.sortOrder = input.sortOrder;

    const updated = await prismaProjects.projectTask.update({
      where: { id: taskId },
      data: updateData,
      include: {
        assignee: { select: { id: true, name: true, email: true } },
        checklists: { orderBy: { sortOrder: 'asc' } },
      },
    });

    return this.formatTaskDto(updated);
  }

  /**
   * Delete a task
   */
  public static async deleteTask(
    organizationId: string,
    projectId: string,
    taskId: string,
  ): Promise<void> {
    const task = await prismaProjects.projectTask.findFirst({
      where: { id: taskId, projectId, organizationId },
    });

    if (!task) {
      throw new NotFoundError('Task not found');
    }

    await prismaProjects.projectTask.delete({ where: { id: taskId } });
  }

  /**
   * Add a checklist sub-item to a task
   */
  public static async createChecklistItem(
    organizationId: string,
    projectId: string,
    taskId: string,
    input: CreateChecklistItemInput,
  ): Promise<RawChecklistItem> {
    const task = await prismaProjects.projectTask.findFirst({
      where: { id: taskId, projectId, organizationId },
    });

    if (!task) {
      throw new NotFoundError('Task not found');
    }

    const count = await prismaProjects.taskChecklistItem.count({ where: { taskId } });

    return prismaProjects.taskChecklistItem.create({
      data: {
        taskId,
        title: input.title.trim(),
        sortOrder: count,
      },
    });
  }

  /**
   * Toggle or edit a checklist sub-item
   */
  public static async updateChecklistItem(
    organizationId: string,
    projectId: string,
    taskId: string,
    itemId: string,
    input: UpdateChecklistItemInput,
  ): Promise<RawChecklistItem> {
    const task = await prismaProjects.projectTask.findFirst({
      where: { id: taskId, projectId, organizationId },
    });

    if (!task) {
      throw new NotFoundError('Task not found');
    }

    const item = await prismaProjects.taskChecklistItem.findFirst({
      where: { id: itemId, taskId },
    });

    if (!item) {
      throw new NotFoundError('Checklist item not found');
    }

    const updateData: Record<string, unknown> = {};
    if (input.title) updateData.title = input.title.trim();
    if (input.isCompleted !== undefined) updateData.isCompleted = input.isCompleted;

    return prismaProjects.taskChecklistItem.update({
      where: { id: itemId },
      data: updateData,
    });
  }

  /**
   * Delete a checklist item
   */
  public static async deleteChecklistItem(
    organizationId: string,
    projectId: string,
    taskId: string,
    itemId: string,
  ): Promise<void> {
    const task = await prismaProjects.projectTask.findFirst({
      where: { id: taskId, projectId, organizationId },
    });

    if (!task) {
      throw new NotFoundError('Task not found');
    }

    const item = await prismaProjects.taskChecklistItem.findFirst({
      where: { id: itemId, taskId },
    });

    if (!item) {
      throw new NotFoundError('Checklist item not found');
    }

    await prismaProjects.taskChecklistItem.delete({ where: { id: itemId } });
  }
}
