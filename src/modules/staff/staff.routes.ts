import { Router } from 'express';
import { StaffController } from './staff.controller.js';
import { authenticate } from '../../common/middleware/auth.js';
import { tenantContextMiddleware } from '../../common/middleware/tenant-context.js';

const router = Router();

router.use(authenticate);
router.use(tenantContextMiddleware());

router.get('/', StaffController.list);
router.post('/', StaffController.create);
router.patch('/:id/status', StaffController.updateStatus);

export const staffRoutes = router;
