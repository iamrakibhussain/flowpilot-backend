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
router.post('/process-now', RecurringController.processNow);

// Schedule-specific management endpoints
router.get('/:id', RecurringController.getById);
router.post('/', RecurringController.create);
router.patch('/:id', RecurringController.update);
router.post('/:id/pause', RecurringController.pause);
router.post('/:id/resume', RecurringController.resume);
router.post('/:id/cancel', RecurringController.cancel);
router.post('/:id/retainer-hours', RecurringController.logRetainerHours);

export const recurringRoutes = router;
