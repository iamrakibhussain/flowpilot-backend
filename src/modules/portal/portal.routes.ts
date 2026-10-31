import { Router } from 'express';
import { PortalController } from './portal.controller.js';
import { requirePortalAuth } from './portal.middleware.js';

const router = Router();

// Public Passwordless Access Routes
router.post('/auth/request-link', PortalController.requestLink);
router.post('/auth/verify', PortalController.verifyToken);

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
