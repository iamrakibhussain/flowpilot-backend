import { Router } from 'express';
import { HealthController } from './health.controller.js';

const router = Router();

router.get('/', HealthController.getLiveness);
router.get('/ready', HealthController.getReadiness);

export const healthRoutes = router;
