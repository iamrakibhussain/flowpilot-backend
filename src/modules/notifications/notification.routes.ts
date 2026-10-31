import { Router } from 'express';
import { NotificationController } from './notification.controller.js';
import { authenticate } from '../../common/middleware/auth.js';
import { tenantContextMiddleware } from '../../common/middleware/tenant-context.js';

const router = Router();

// Multi-tenant security enforcement:
// All routes require valid user session and verified organization context
router.use(authenticate);
router.use(tenantContextMiddleware());

router.get('/', NotificationController.list);
router.patch('/read-all', NotificationController.markAllAsRead);
router.patch('/:id/read', NotificationController.markAsRead);
router.delete('/clear-read', NotificationController.clearRead);

// Diagnostic test email dispatcher: restricted to OWNER and ADMIN
router.post(
  '/test-email',
  tenantContextMiddleware({ allowedRoles: ['OWNER', 'ADMIN'] }),
  NotificationController.testEmail,
);

export const notificationRoutes = router;
