import { Router } from 'express';
import { FlowRulesController } from './flow-rules.controller.js';
import { authenticate } from '../../common/middleware/auth.js';
import { tenantContextMiddleware } from '../../common/middleware/tenant-context.js';

const router = Router();

// Strict Authentication and Multi-Tenant Isolation
router.use(authenticate);
router.use(tenantContextMiddleware());

// Statistics & Run History
router.get('/stats', FlowRulesController.getStats);
router.get('/executions', FlowRulesController.getExecutions);

// FlowRules CRUD & Operations
router.get('/', FlowRulesController.listRules);
router.post(
  '/',
  tenantContextMiddleware({ allowedRoles: ['OWNER', 'ADMIN'] }),
  FlowRulesController.createRule,
);
router.get('/:id/executions', FlowRulesController.getExecutions);
router.get('/:id', FlowRulesController.getRuleById);
router.put(
  '/:id',
  tenantContextMiddleware({ allowedRoles: ['OWNER', 'ADMIN'] }),
  FlowRulesController.updateRule,
);
router.patch(
  '/:id',
  tenantContextMiddleware({ allowedRoles: ['OWNER', 'ADMIN'] }),
  FlowRulesController.updateRule,
);
router.patch(
  '/:id/toggle',
  tenantContextMiddleware({ allowedRoles: ['OWNER', 'ADMIN'] }),
  FlowRulesController.toggleRule,
);
router.post(
  '/:id/test',
  tenantContextMiddleware({ allowedRoles: ['OWNER', 'ADMIN'] }),
  FlowRulesController.testRule,
);
router.delete(
  '/:id',
  tenantContextMiddleware({ allowedRoles: ['OWNER', 'ADMIN'] }),
  FlowRulesController.deleteRule,
);

export default router;
