import { Router } from 'express';
import { StaffController } from './staff.controller.js';
import { authenticate } from '../../common/middleware/auth.js';
import { tenantContextMiddleware } from '../../common/middleware/tenant-context.js';

const router = Router();

// Strict multi-tenant security: Authenticated user + validated organization context
router.use(authenticate);
router.use(tenantContextMiddleware());

router.get('/', StaffController.list);
router.get('/metrics', StaffController.getMetrics);
router.get('/:id', StaffController.getById);
router.post('/', StaffController.create);
router.patch('/:id', StaffController.update);
router.patch('/:id/status', StaffController.updateStatus);
router.delete('/:id', StaffController.delete);

export const staffRoutes = router;
