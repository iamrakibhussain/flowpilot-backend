import { Router } from 'express';
import { StaffController } from './staff.controller.js';
import { BlockedTimeController } from './blocked-time.controller.js';
import { authenticate } from '../../common/middleware/auth.js';
import { tenantContextMiddleware } from '../../common/middleware/tenant-context.js';

const router = Router();

// Strict multi-tenant security: Authenticated user + validated organization context
router.use(authenticate);
router.use(tenantContextMiddleware());

// Blocked time & holiday management routes (placed before /:id)
router.get('/blocked-time', BlockedTimeController.list);
router.post('/blocked-time', BlockedTimeController.create);
router.patch('/blocked-time/:id', BlockedTimeController.update);
router.delete('/blocked-time/:id', BlockedTimeController.delete);

router.get('/', StaffController.list);
router.get('/metrics', StaffController.getMetrics);
router.get('/:id', StaffController.getById);
router.post('/', StaffController.create);
router.patch('/:id', StaffController.update);
router.patch('/:id/status', StaffController.updateStatus);
router.delete('/:id', StaffController.delete);

export const staffRoutes = router;
