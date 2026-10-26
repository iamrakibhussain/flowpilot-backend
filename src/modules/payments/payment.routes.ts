import { Router } from 'express';
import { PaymentController } from './payment.controller.js';
import { authenticate } from '../../common/middleware/auth.js';
import { tenantContextMiddleware } from '../../common/middleware/tenant-context.js';

const router = Router();

// ==========================================
// 1. PUBLIC ROUTES (Zero-login Client Portal)
// ==========================================
router.get('/public/invoice/:token', PaymentController.getPublicInvoice);
router.post('/public/checkout/:token', PaymentController.createCheckoutSession);
router.post('/public/sandbox-pay/:token', PaymentController.settleSandbox);

// ==========================================
// 2. WEBHOOK RECEIVER (Stripe Callbacks)
// ==========================================
router.post('/webhook', PaymentController.handleWebhook);

// ==========================================
// 3. TENANT PROTECTED ROUTES
// ==========================================
const protectedRouter = Router();
protectedRouter.use(authenticate);
protectedRouter.use(tenantContextMiddleware());

protectedRouter.post('/invoices/:id/token', PaymentController.generateInvoiceToken);
protectedRouter.get('/settings', PaymentController.getSettings);
protectedRouter.patch('/settings', PaymentController.updateSettings);
protectedRouter.get('/transactions', PaymentController.listTransactions);

router.use(protectedRouter);

export const paymentRoutes = router;
