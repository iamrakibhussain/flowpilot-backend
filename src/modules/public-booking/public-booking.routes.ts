import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { getPublicBookingRateLimitOptions } from '../../config/security.js';
import { PublicBookingController } from './public-booking.controller.js';

const router = Router();
const publicBookingRateLimiter = rateLimit(getPublicBookingRateLimitOptions());

router.get('/:slug', PublicBookingController.getProfile);
router.get('/:slug/slots', PublicBookingController.getSlots);
router.post('/:slug/book', publicBookingRateLimiter, PublicBookingController.book);

export const publicBookingRoutes = router;
