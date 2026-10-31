import { Router } from 'express';
import { PublicBookingController } from './public-booking.controller.js';

const router = Router();

router.get('/:slug', PublicBookingController.getProfile);
router.get('/:slug/slots', PublicBookingController.getSlots);
router.post('/:slug/book', PublicBookingController.book);

export const publicBookingRoutes = router;
