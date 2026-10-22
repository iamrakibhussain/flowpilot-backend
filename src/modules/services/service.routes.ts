import { Router } from 'express';
import { ServiceController } from './service.controller.js';
import { authenticate } from '../../common/middleware/auth.js';
import { tenantContextMiddleware } from '../../common/middleware/tenant-context.js';

const router = Router();

router.use(authenticate);
router.use(tenantContextMiddleware());

router.get('/', ServiceController.list);
router.post('/', ServiceController.create);
router.get('/:id', ServiceController.getById);
router.patch('/:id', ServiceController.update);
router.post('/:id/toggle-active', ServiceController.toggleActive);

export const serviceRoutes = router;
