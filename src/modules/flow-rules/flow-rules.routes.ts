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
router.post('/', FlowRulesController.createRule);
router.get('/:id/executions', FlowRulesController.getExecutions);
router.get('/:id', FlowRulesController.getRuleById);
router.put('/:id', FlowRulesController.updateRule);
router.patch('/:id', FlowRulesController.updateRule);
router.patch('/:id/toggle', FlowRulesController.toggleRule);
router.post('/:id/test', FlowRulesController.testRule);
router.delete('/:id', FlowRulesController.deleteRule);

export default router;
