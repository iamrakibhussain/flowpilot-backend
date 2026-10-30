import { Router } from 'express';
import { AnalyticsController } from './analytics.controller.js';
import { authenticate } from '../../common/middleware/auth.js';
import { tenantContextMiddleware } from '../../common/middleware/tenant-context.js';

const router = Router();

router.use(authenticate);
router.use(tenantContextMiddleware());

router.get('/overview', AnalyticsController.getOverview);
router.get('/cashflow', AnalyticsController.getCashflow);
router.get('/services', AnalyticsController.getServices);
router.get('/staff', AnalyticsController.getStaff);
router.get('/customers', AnalyticsController.getCustomers);
router.get('/export', AnalyticsController.exportCsv);

export const analyticsRoutes = router;
