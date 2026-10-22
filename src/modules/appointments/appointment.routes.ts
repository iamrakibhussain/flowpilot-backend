import { Router } from 'express';
import { AppointmentController } from './appointment.controller.js';
import { authenticate } from '../../common/middleware/auth.js';
import { tenantContextMiddleware } from '../../common/middleware/tenant-context.js';

const router = Router();

// Non-negotiable multi-tenant security enforcement:
// All appointment scheduling routes require valid session authentication
// AND strict multi-tenant organization context verification
router.use(authenticate);
router.use(tenantContextMiddleware());

router.get('/', AppointmentController.list);
router.post('/', AppointmentController.create);
router.post('/check-conflict', AppointmentController.checkConflict);
router.get('/:id', AppointmentController.getById);
router.patch('/:id', AppointmentController.update);
router.patch('/:id/reschedule', AppointmentController.reschedule);
router.patch('/:id/status', AppointmentController.updateStatus);
router.delete('/:id', AppointmentController.cancel);

export const appointmentRoutes = router;
