import { Router } from 'express';
import { RecurringController } from './recurring.controller.js';
import { authenticate } from '../../common/middleware/auth.js';
import { tenantContextMiddleware } from '../../common/middleware/tenant-context.js';

const router = Router();

router.use(authenticate);
router.use(tenantContextMiddleware());

// Specific endpoints before parameter routes
router.get('/', RecurringController.list);
router.get('/stats', RecurringController.getStats);
router.post(
  '/process-now',
  tenantContextMiddleware({ allowedRoles: ['OWNER', 'ADMIN'] }),
  RecurringController.processNow,
);

// Schedule-specific management endpoints
router.get('/:id', RecurringController.getById);
router.post(
  '/',
  tenantContextMiddleware({ allowedRoles: ['OWNER', 'ADMIN'] }),
  RecurringController.create,
);
router.patch(
  '/:id',
  tenantContextMiddleware({ allowedRoles: ['OWNER', 'ADMIN'] }),
  RecurringController.update,
);
router.post(
  '/:id/pause',
  tenantContextMiddleware({ allowedRoles: ['OWNER', 'ADMIN'] }),
  RecurringController.pause,
);
router.post(
  '/:id/resume',
  tenantContextMiddleware({ allowedRoles: ['OWNER', 'ADMIN'] }),
  RecurringController.resume,
);
router.post(
  '/:id/cancel',
  tenantContextMiddleware({ allowedRoles: ['OWNER', 'ADMIN'] }),
  RecurringController.cancel,
);
router.post(
  '/:id/retainer-hours',
  tenantContextMiddleware({ allowedRoles: ['OWNER', 'ADMIN'] }),
  RecurringController.logRetainerHours,
);

export const recurringRoutes = router;
