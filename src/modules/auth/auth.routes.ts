import { Router } from 'express';
import { AuthController } from './auth.controller.js';
import { validateRequest } from '../../common/middleware/validate.js';
import {
  loginSchema,
  registerSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  verifyEmailSchema,
  changePasswordSchema,
  deleteAccountSchema,
} from './auth.types.js';
import { authenticate } from '../../common/middleware/auth.js';

const router = Router();

router.post('/login', validateRequest({ body: loginSchema }), AuthController.login);
router.post('/register', validateRequest({ body: registerSchema }), AuthController.register);
router.post('/logout', AuthController.logout);
router.post(
  '/forgot-password',
  validateRequest({ body: forgotPasswordSchema }),
  AuthController.forgotPassword,
);
router.post(
  '/reset-password',
  validateRequest({ body: resetPasswordSchema }),
  AuthController.resetPassword,
);
router.post('/send-verification', authenticate, AuthController.sendEmailVerification);
router.post(
  '/verify-email',
  authenticate,
  validateRequest({ body: verifyEmailSchema }),
  AuthController.verifyEmail,
);
router.post(
  '/change-password',
  authenticate,
  validateRequest({ body: changePasswordSchema }),
  AuthController.changePassword,
);
router.delete(
  '/account',
  authenticate,
  validateRequest({ body: deleteAccountSchema }),
  AuthController.deleteAccount,
);
router.get('/me', authenticate, AuthController.me);

export const authRoutes = router;
