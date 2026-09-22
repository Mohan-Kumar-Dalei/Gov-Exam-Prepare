const { Router } = require('express');
const ctrl = require('../controllers/auth.controller.js');
const { protect } = require('../middleware/auth.js');
const { validate } = require('../middleware/validate.js');
const { authLimiter } = require('../middleware/rateLimit.js');
const { signupSchema, loginSchema, refreshSchema, updateProfileSchema, changePasswordSchema, } = require('../validators/schemas.js');

const router = Router();

router.post('/signup', authLimiter, validate(signupSchema), ctrl.signup);
router.post('/login', authLimiter, validate(loginSchema), ctrl.login);
router.post('/refresh', validate(refreshSchema), ctrl.refresh);
router.post('/logout', ctrl.logout);

router.get('/me', protect, ctrl.me);
router.patch('/me', protect, validate(updateProfileSchema), ctrl.updateProfile);
router.post('/change-password', protect, validate(changePasswordSchema), ctrl.changePassword);

module.exports = router;
