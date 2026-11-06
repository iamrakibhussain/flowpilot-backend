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

// Contracts self-service & in-portal signing
protectedRouter.get('/contracts', PortalController.listContracts);
protectedRouter.get('/contracts/:id', PortalController.getContract);
protectedRouter.post('/contracts/:id/sign', PortalController.signContract);

// Appointments self-service
protectedRouter.get('/appointments/:id/available-slots', PortalController.getAvailableSlots);
protectedRouter.patch('/appointments/:id/reschedule', PortalController.reschedule);
protectedRouter.patch('/appointments/:id/cancel', PortalController.cancel);

// Proposals & Estimates
protectedRouter.post('/quotes/:id/accept', PortalController.acceptQuote);
protectedRouter.post('/quotes/:id/token', PortalController.getQuoteToken);

// Notifications & Activity Feed
protectedRouter.get('/notifications', PortalController.getNotifications);
protectedRouter.patch('/notifications/:id/read', PortalController.markNotificationRead);
protectedRouter.post('/notifications/read-all', PortalController.markAllNotificationsRead);

// Client Coordinates & Session
protectedRouter.patch('/profile', PortalController.updateProfile);
protectedRouter.post('/auth/logout', PortalController.logout);

router.use('/', protectedRouter);

export const portalRoutes = router;
