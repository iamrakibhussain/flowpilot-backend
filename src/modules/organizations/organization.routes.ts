import { Router } from 'express';
import { OrganizationController } from './organization.controller.js';
import { authenticate } from '../../common/middleware/auth.js';
import { tenantContextMiddleware } from '../../common/middleware/tenant-context.js';

const router = Router();

router.use(authenticate);
router.use(tenantContextMiddleware());

router.get('/settings', OrganizationController.getSettings);
router.patch('/settings', OrganizationController.updateSettings);
router.post('/settings/check-slug', OrganizationController.checkSlug);
router.get('/audit-logs', OrganizationController.getAuditLogs);

export const organizationRoutes = router;
