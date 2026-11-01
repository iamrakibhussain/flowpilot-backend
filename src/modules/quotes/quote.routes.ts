import { Router } from 'express';
import { QuoteController } from './quote.controller.js';
import { authenticate } from '../../common/middleware/auth.js';
import { tenantContextMiddleware } from '../../common/middleware/tenant-context.js';

// Internal Workspace Authenticated Routes
const router = Router();

router.use(authenticate);
router.use(tenantContextMiddleware());

router.get('/', QuoteController.list);
router.get('/stats', QuoteController.getStats);
router.get('/:id', QuoteController.getById);
router.post('/', QuoteController.create);
router.patch('/:id', QuoteController.update);
router.delete('/:id', QuoteController.delete);
router.post('/:id/send', QuoteController.send);
router.post('/:id/convert-invoice', QuoteController.convertToInvoice);

export const quoteRoutes = router;

// Public Client Proposal Access Routes (Protected by 256-bit Cryptographic Token)
const publicRouter = Router();

publicRouter.get('/:token', QuoteController.getPublic);
publicRouter.post('/:token/accept', QuoteController.acceptPublic);
publicRouter.post('/:token/decline', QuoteController.declinePublic);

export const publicQuoteRoutes = publicRouter;
