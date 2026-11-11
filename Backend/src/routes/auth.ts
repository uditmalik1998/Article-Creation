/**
 * 🔐 Auth Routes
 */

import { Router } from 'express';
import * as authController from '../controllers/authController';
import { authenticate, requireAdmin } from '../middleware/auth';

const router = Router();

router.post('/register', authenticate, requireAdmin, authController.register);
router.post('/login', authController.login);
router.post('/verify', authController.verifyToken);
router.get('/me', authenticate, authController.getCurrentUser);
router.post('/change-password', authenticate, authController.changePassword);

export default router;
