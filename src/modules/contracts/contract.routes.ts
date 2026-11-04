import { Router } from 'express';
import { ContractController } from './contract.controller.js';
import { authenticate } from '../../common/middleware/auth.js';
import { tenantContextMiddleware } from '../../common/middleware/tenant-context.js';

// Internal Workspace Authenticated Routes
const router = Router();

router.use(authenticate);
router.use(tenantContextMiddleware());

router.get('/', ContractController.list);
router.get('/:id', ContractController.getById);
router.post('/', ContractController.create);
router.patch('/:id', ContractController.update);
router.delete('/:id', ContractController.delete);
router.post('/:id/send', ContractController.send);
router.post('/:id/countersign', ContractController.countersign);

export const contractRoutes = router;

// Public Client Contract Signing Routes (Protected by Cryptographic Token)
const publicRouter = Router();

publicRouter.get('/:token', ContractController.getPublic);
publicRouter.post('/:token/sign', ContractController.signPublic);
publicRouter.post('/:token/decline', ContractController.declinePublic);

export const publicContractRoutes = publicRouter;
