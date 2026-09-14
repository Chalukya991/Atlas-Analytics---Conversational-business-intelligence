const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const authController = require('../controllers/auth');
const { authenticateToken } = require('../middleware/auth');
const { validateBody } = require('../middleware/validate');

// Tight limit on credential endpoints to slow brute force.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { status: 'error', message: 'Too many attempts. Try again in a few minutes.' },
});

router.post(
  '/register',
  authLimiter,
  validateBody({
    email: { type: 'email', required: true, max: 254 },
    password: { type: 'string', required: true, min: 8, max: 128, trim: false },
    name: { type: 'string', required: true, min: 1, max: 80 },
  }),
  authController.register,
);
router.post(
  '/login',
  authLimiter,
  validateBody({
    email: { type: 'email', required: true, max: 254 },
    password: { type: 'string', required: true, max: 128, trim: false },
  }),
  authController.login,
);
router.get('/me', authenticateToken, authController.me);
router.post('/logout', authenticateToken, authController.logout);
router.post(
  '/password',
  authenticateToken,
  validateBody({
    currentPassword: { type: 'string', required: true, max: 128, trim: false },
    newPassword: { type: 'string', required: true, min: 8, max: 128, trim: false },
  }),
  authController.changePassword,
);

module.exports = router;
