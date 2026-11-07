import { Router } from 'express';
import { SubscriptionController } from './subscription.controller.js';
import { authenticate } from '../../common/middleware/auth.js';
import { tenantContextMiddleware } from '../../common/middleware/tenant-context.js';

const router = Router();

// ==========================================
// 1. PUBLIC WEBHOOK RECEIVER (Stripe SaaS Billing)
// ==========================================
router.post('/webhook', SubscriptionController.handleWebhook);

// ==========================================
// 2. AUTHENTICATED PLAN CATALOG (Global)
// ==========================================
router.get('/plans', authenticate, SubscriptionController.getPlans);

// ==========================================
// 3. TENANT PROTECTED SUBSCRIPTION ENDPOINTS
// ==========================================
const tenantRouter = Router();
tenantRouter.use(authenticate);
tenantRouter.use(tenantContextMiddleware());

// General Read (All organization members can inspect status & usage)
tenantRouter.get('/current', SubscriptionController.getCurrentSubscription);
tenantRouter.get('/usage', SubscriptionController.getUsage);

// Financial History Read (OWNER & ADMIN only)
tenantRouter.get(
  '/billing-history',
  tenantContextMiddleware({ allowedRoles: ['OWNER', 'ADMIN'] }),
  SubscriptionController.getBillingHistory,
);

// High-Privilege Billing Mutations (OWNER only)
tenantRouter.post(
  '/checkout',
  tenantContextMiddleware({ allowedRoles: ['OWNER'] }),
  SubscriptionController.createCheckoutSession,
);

tenantRouter.post(
  '/verify-checkout',
  tenantContextMiddleware({ allowedRoles: ['OWNER'] }),
  SubscriptionController.verifyCheckout,
);

tenantRouter.post(
  '/portal',
  tenantContextMiddleware({ allowedRoles: ['OWNER'] }),
  SubscriptionController.createPortalSession,
);

tenantRouter.post(
  '/change-plan',
  tenantContextMiddleware({ allowedRoles: ['OWNER'] }),
  SubscriptionController.changePlan,
);

tenantRouter.post(
  '/cancel',
  tenantContextMiddleware({ allowedRoles: ['OWNER'] }),
  SubscriptionController.cancelSubscription,
);

tenantRouter.post(
  '/resume',
  tenantContextMiddleware({ allowedRoles: ['OWNER'] }),
  SubscriptionController.resumeSubscription,
);

router.use(tenantRouter);

export const subscriptionRoutes = router;
