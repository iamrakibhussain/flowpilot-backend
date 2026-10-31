import { Router } from 'express';
import { InvoiceController } from './invoice.controller.js';
import { authenticate } from '../../common/middleware/auth.js';
import { tenantContextMiddleware } from '../../common/middleware/tenant-context.js';

const router = Router();

// Non-negotiable multi-tenant security enforcement:
// All invoice routes require valid authentication AND strict organization tenant context
router.use(authenticate);
router.use(tenantContextMiddleware());

router.get('/', InvoiceController.list);
router.get('/stats', InvoiceController.getStats);
router.post('/', InvoiceController.create);
router.get('/:id', InvoiceController.getById);
router.patch('/:id', InvoiceController.update);
router.patch('/:id/status', InvoiceController.updateStatus);
router.post('/:id/record-payment', InvoiceController.recordPayment);
router.post('/:id/send-email', InvoiceController.sendEmail);
router.delete('/:id', InvoiceController.delete);

export const invoiceRoutes = router;
