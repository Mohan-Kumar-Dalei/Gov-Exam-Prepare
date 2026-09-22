const rateLimit = require('express-rate-limit');

const message = (text) => ({ success: false, message: text });

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: message('Too many requests. Please slow down and try again shortly.'),
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: message('Too many sign-in attempts. Please try again in 15 minutes.'),
});

/** AI calls are slow and metered — keep a tighter budget on them. */
const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => String(req.user?._id || req.ip),
  message: message('You are generating content very quickly. Please wait a moment.'),
});

const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => String(req.user?._id || req.ip),
  message: message('Upload limit reached for this hour.'),
});

module.exports = apiLimiter;
Object.assign(module.exports, { apiLimiter, authLimiter, aiLimiter, uploadLimiter });
