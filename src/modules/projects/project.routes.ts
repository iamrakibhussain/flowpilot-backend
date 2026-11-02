import { Router } from 'express';
import { ProjectController } from './project.controller.js';
import { authenticate } from '../../common/middleware/auth.js';
import { tenantContextMiddleware } from '../../common/middleware/tenant-context.js';

const router = Router();

router.use(authenticate);
router.use(tenantContextMiddleware());

// Project Operations
router.get('/', ProjectController.list);
router.get('/stats', ProjectController.getStats);
router.get('/:id', ProjectController.getById);
router.post('/', ProjectController.create);
router.patch('/:id', ProjectController.update);
router.delete('/:id', ProjectController.delete);

// Task Operations (Kanban & List)
router.post('/:id/tasks', ProjectController.createTask);
router.patch('/:id/tasks/:taskId', ProjectController.updateTask);
router.delete('/:id/tasks/:taskId', ProjectController.deleteTask);

// Task Checklist Operations
router.post('/:id/tasks/:taskId/checklist', ProjectController.createChecklistItem);
router.patch('/:id/tasks/:taskId/checklist/:itemId', ProjectController.updateChecklistItem);
router.delete('/:id/tasks/:taskId/checklist/:itemId', ProjectController.deleteChecklistItem);

export const projectRoutes = router;
