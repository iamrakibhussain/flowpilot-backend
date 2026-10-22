import { Router } from 'express';
import { CustomerController } from './customer.controller.js';
import { authenticate } from '../../common/middleware/auth.js';
import { tenantContextMiddleware } from '../../common/middleware/tenant-context.js';

const router = Router();

// Non-negotiable multi-tenant security enforcement:
// All customer CRM routes require valid session authentication
// AND strict multi-tenant organization context verification
router.use(authenticate);
router.use(tenantContextMiddleware());

router.get('/', CustomerController.list);
router.post('/', CustomerController.create);
router.get('/:id', CustomerController.getById);
router.patch('/:id', CustomerController.update);
router.delete('/:id', CustomerController.archive);
router.post('/:id/reactivate', CustomerController.reactivate);
router.post('/:id/notes', CustomerController.addNote);

export const customerRoutes = router;
