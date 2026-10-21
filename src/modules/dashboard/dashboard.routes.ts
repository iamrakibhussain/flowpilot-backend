import { Router } from 'express';
import { DashboardController } from './dashboard.controller.js';
import { authenticate } from '../../common/middleware/auth.js';
import { tenantContextMiddleware } from '../../common/middleware/tenant-context.js';

const router = Router();

// Non-negotiable security: All dashboard routes require valid session authentication
// AND strict multi-tenant organization context verification
router.use(authenticate);
router.use(tenantContextMiddleware());

// Query routes
router.get('/metrics', DashboardController.getMetrics);
router.get('/activities', DashboardController.getActivities);
router.get('/schedule/today', DashboardController.getTodaySchedule);
router.get('/staff/on-duty', DashboardController.getOnDutyStaff);
router.get('/customers', DashboardController.getCustomers);

// Quick mutation routes (called directly from dashboard modals)
router.post('/invoices', DashboardController.createInvoice);
router.post('/appointments', DashboardController.createAppointment);
router.post('/customers', DashboardController.createCustomer);

export const dashboardRoutes = router;
