import { Router } from 'express';
import { healthRoutes } from '../modules/health/health.routes.js';
import { authRoutes } from '../modules/auth/auth.routes.js';
import { dashboardRoutes } from '../modules/dashboard/dashboard.routes.js';
import { customerRoutes } from '../modules/customers/customer.routes.js';
import { appointmentRoutes } from '../modules/appointments/appointment.routes.js';
import { serviceRoutes } from '../modules/services/service.routes.js';
import { staffRoutes } from '../modules/staff/staff.routes.js';
import { invoiceRoutes } from '../modules/invoices/invoice.routes.js';
import { paymentRoutes } from '../modules/payments/payment.routes.js';
import { teamRoutes } from '../modules/team/team.routes.js';

const router = Router();

router.use('/health', healthRoutes);
router.use('/auth', authRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/customers', customerRoutes);
router.use('/appointments', appointmentRoutes);
router.use('/services', serviceRoutes);
router.use('/staff', staffRoutes);
router.use('/invoices', invoiceRoutes);
router.use('/payments', paymentRoutes);
router.use('/team', teamRoutes);

export const v1Routes = router;
