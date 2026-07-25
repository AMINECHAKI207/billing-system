import { Router } from 'express';
import { authController } from './auth.controller';
import { authenticate } from '@middleware/authenticate';
import { authLimiter } from '@middleware/rateLimiter';

const router = Router();

/**
 * Public Routes
 */

// Apply strict rate limiting to login and register
router.post('/register', authLimiter, authController.register);
router.post('/login', authLimiter, authController.login);

// Refresh token doesn't require Bearer auth, it reads the httpOnly cookie
router.post('/refresh', authController.refresh);

/**
 * Protected Routes
 */

// Logout is intentionally public so expired access cookies can still be cleared.
router.post('/logout', authController.logout);

// Get current user profile
router.get('/me', authenticate, authController.me);

// Change own password after confirming the current one
router.patch('/password', authenticate, authController.changePassword);

// Persist the current user's visual theme preference
router.patch('/theme', authenticate, authController.updateTheme);

export default router;
