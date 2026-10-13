import { Router } from 'express';
import { AuthController } from './auth.controller.js';
import { validateRequest } from '../../common/middleware/validate.js';
import { loginSchema, registerSchema } from './auth.types.js';

const router = Router();

router.post('/login', validateRequest({ body: loginSchema }), AuthController.login);
router.post('/register', validateRequest({ body: registerSchema }), AuthController.register);
router.post('/logout', AuthController.logout);
router.get('/me', AuthController.me);

export const authRoutes = router;
