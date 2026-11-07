import { Router } from 'express';
import { ServiceController } from './service.controller.js';
import { authenticate } from '../../common/middleware/auth.js';
import { tenantContextMiddleware } from '../../common/middleware/tenant-context.js';

const router = Router();

router.use(authenticate);
router.use(tenantContextMiddleware());

router.get('/', ServiceController.list);
router.post(
  '/',
  tenantContextMiddleware({ allowedRoles: ['OWNER', 'ADMIN'] }),
  ServiceController.create,
);
router.get('/:id', ServiceController.getById);
router.patch(
  '/:id',
  tenantContextMiddleware({ allowedRoles: ['OWNER', 'ADMIN'] }),
  ServiceController.update,
);
router.put(
  '/:id/staff',
  tenantContextMiddleware({ allowedRoles: ['OWNER', 'ADMIN'] }),
  ServiceController.syncStaff,
);
router.delete(
  '/:id',
  tenantContextMiddleware({ allowedRoles: ['OWNER', 'ADMIN'] }),
  ServiceController.delete,
);
router.post(
  '/:id/toggle-active',
  tenantContextMiddleware({ allowedRoles: ['OWNER', 'ADMIN'] }),
  ServiceController.toggleActive,
);

export const serviceRoutes = router;
