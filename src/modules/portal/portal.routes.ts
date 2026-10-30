import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { PortalController } from './portal.controller.js';
import { requirePortalAuth } from './portal.middleware.js';
import {
  getEmailDispatchRateLimitOptions,
  getVerificationRateLimitOptions,
} from '../../config/security.js';

const router = Router();

const linkDispatchLimiter = rateLimit(getEmailDispatchRateLimitOptions());
const tokenVerifyLimiter = rateLimit(getVerificationRateLimitOptions());

// Public Passwordless Access Routes
router.post('/auth/request-link', linkDispatchLimiter, PortalController.requestLink);
router.post('/auth/verify', tokenVerifyLimiter, PortalController.verifyToken);

// Authenticated Client Portal Routes (Requires valid client session)
const protectedRouter = Router();
protectedRouter.use(requirePortalAuth);

protectedRouter.get('/me', PortalController.getMe);
protectedRouter.get('/dashboard', PortalController.getDashboard);
protectedRouter.patch('/appointments/:id/reschedule', PortalController.reschedule);
protectedRouter.patch('/appointments/:id/cancel', PortalController.cancel);
protectedRouter.patch('/profile', PortalController.updateProfile);
protectedRouter.post('/auth/logout', PortalController.logout);

router.use('/', protectedRouter);

export const portalRoutes = router;
