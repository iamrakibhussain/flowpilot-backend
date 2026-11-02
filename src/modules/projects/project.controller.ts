import { Request, Response, NextFunction } from 'express';
import { ProjectService } from './project.service.js';
import { sendSuccess } from '../../common/http/response.js';
import {
  createProjectSchema,
  updateProjectSchema,
  createTaskSchema,
  updateTaskSchema,
  createChecklistItemSchema,
  updateChecklistItemSchema,
  ListProjectsQuery,
  ProjectStatus,
} from './project.types.js';

export class ProjectController {
  /**
   * GET /api/v1/projects
   */
  public static async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const { status, customerId, search, page, limit } = req.query;

      const query: ListProjectsQuery = {
        status: typeof status === 'string' ? (status as ProjectStatus) : undefined,
        customerId: typeof customerId === 'string' ? customerId : undefined,
        search: typeof search === 'string' ? search : undefined,
        page: typeof page === 'string' ? parseInt(page, 10) : undefined,
        limit: typeof limit === 'string' ? parseInt(limit, 10) : undefined,
      };

      const result = await ProjectService.listProjects(organizationId, query);
      sendSuccess(res, result);
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/v1/projects/stats
   */
  public static async getStats(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const stats = await ProjectService.getProjectStats(organizationId);
      sendSuccess(res, stats);
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/v1/projects/:id
   */
  public static async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const id = req.params.id as string;
      const project = await ProjectService.getProjectById(organizationId, id);
      sendSuccess(res, project);
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/v1/projects
   */
  public static async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const userId = req.user!.id;
      const validated = createProjectSchema.parse(req.body);

      const project = await ProjectService.createProject(organizationId, userId, validated);
      sendSuccess(res, project, 201);
    } catch (err) {
      next(err);
    }
  }

  /**
   * PATCH /api/v1/projects/:id
   */
  public static async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const id = req.params.id as string;
      const validated = updateProjectSchema.parse(req.body);

      const project = await ProjectService.updateProject(organizationId, id, validated);
      sendSuccess(res, project);
    } catch (err) {
      next(err);
    }
  }

  /**
   * DELETE /api/v1/projects/:id
   */
  public static async delete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const id = req.params.id as string;
      await ProjectService.deleteProject(organizationId, id);
      sendSuccess(res, { message: 'Project deleted successfully' });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/v1/projects/:id/tasks
   */
  public static async createTask(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const userId = req.user!.id;
      const projectId = req.params.id as string;
      const validated = createTaskSchema.parse(req.body);

      const task = await ProjectService.createTask(organizationId, projectId, userId, validated);
      sendSuccess(res, task, 201);
    } catch (err) {
      next(err);
    }
  }

  /**
   * PATCH /api/v1/projects/:id/tasks/:taskId
   */
  public static async updateTask(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const projectId = req.params.id as string;
      const taskId = req.params.taskId as string;
      const validated = updateTaskSchema.parse(req.body);

      const task = await ProjectService.updateTask(organizationId, projectId, taskId, validated);
      sendSuccess(res, task);
    } catch (err) {
      next(err);
    }
  }

  /**
   * DELETE /api/v1/projects/:id/tasks/:taskId
   */
  public static async deleteTask(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const projectId = req.params.id as string;
      const taskId = req.params.taskId as string;

      await ProjectService.deleteTask(organizationId, projectId, taskId);
      sendSuccess(res, { message: 'Task deleted successfully' });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/v1/projects/:id/tasks/:taskId/checklist
   */
  public static async createChecklistItem(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const projectId = req.params.id as string;
      const taskId = req.params.taskId as string;
      const validated = createChecklistItemSchema.parse(req.body);

      const item = await ProjectService.createChecklistItem(
        organizationId,
        projectId,
        taskId,
        validated,
      );
      sendSuccess(res, item, 201);
    } catch (err) {
      next(err);
    }
  }

  /**
   * PATCH /api/v1/projects/:id/tasks/:taskId/checklist/:itemId
   */
  public static async updateChecklistItem(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const projectId = req.params.id as string;
      const taskId = req.params.taskId as string;
      const itemId = req.params.itemId as string;
      const validated = updateChecklistItemSchema.parse(req.body);

      const item = await ProjectService.updateChecklistItem(
        organizationId,
        projectId,
        taskId,
        itemId,
        validated,
      );
      sendSuccess(res, item);
    } catch (err) {
      next(err);
    }
  }

  /**
   * DELETE /api/v1/projects/:id/tasks/:taskId/checklist/:itemId
   */
  public static async deleteChecklistItem(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      const organizationId = req.tenant!.organizationId;
      const projectId = req.params.id as string;
      const taskId = req.params.taskId as string;
      const itemId = req.params.itemId as string;

      await ProjectService.deleteChecklistItem(organizationId, projectId, taskId, itemId);
      sendSuccess(res, { message: 'Checklist item deleted successfully' });
    } catch (err) {
      next(err);
    }
  }
}
