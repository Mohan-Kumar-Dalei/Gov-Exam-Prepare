const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'dev_only_insecure_secret_change_me';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'dev_only_insecure_refresh_change_me';
const JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '30d';
const ApiError = require('../utils/ApiError.js');
const asyncHandler = require('../utils/asyncHandler.js');
const { User } = require('../models/index.js');

const signAccessToken = (user) =>
  jwt.sign({ sub: String(user._id), role: user.role }, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
  });

const signRefreshToken = (user) =>
  jwt.sign({ sub: String(user._id), type: 'refresh' }, JWT_REFRESH_SECRET, {
    expiresIn: JWT_REFRESH_EXPIRES_IN,
  });

const verifyRefreshToken = (token) => jwt.verify(token, JWT_REFRESH_SECRET);

const readToken = (req) => {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  if (req.cookies?.accessToken) return req.cookies.accessToken;
  return null;
};

const protect = asyncHandler(async (req, _res, next) => {
  const token = readToken(req);
  if (!token) throw ApiError.unauthorized('Authentication required. Please sign in.');

  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch (err) {
    throw ApiError.unauthorized(
      err.name === 'TokenExpiredError' ? 'Session expired. Please sign in again.' : 'Invalid token.',
    );
  }

  const user = await User.findById(decoded.sub);
  if (!user) throw ApiError.unauthorized('This account no longer exists.');

  req.user = user;
  return next();
});

const restrictTo = (...roles) => (req, _res, next) => {
  if (!roles.includes(req.user?.role)) {
    return next(ApiError.forbidden('You do not have permission to perform this action.'));
  }
  return next();
};

module.exports = protect;
Object.assign(module.exports, { signAccessToken, signRefreshToken, verifyRefreshToken, protect, restrictTo });
