const asyncHandler = require('../utils/asyncHandler.js');
const ApiError = require('../utils/ApiError.js');
const { ok, created } = require('../utils/apiResponse.js');
const { User } = require('../models/index.js');
const { signAccessToken, signRefreshToken, verifyRefreshToken } = require('../middleware/auth.js');

const authPayload = (user) => ({
  user: user.toJSON(),
  accessToken: signAccessToken(user),
  refreshToken: signRefreshToken(user),
});

/** POST /api/auth/signup */
const signup = asyncHandler(async (req, res) => {
  const { name, email, password } = req.body;

  if (await User.exists({ email })) {
    throw ApiError.conflict('An account with that email already exists.');
  }

  // The first account to exist owns the deployment: someone has to be able to
  // reach the API key ring, and there is no other bootstrap path.
  const isFirstUser = (await User.estimatedDocumentCount()) === 0;

  const user = await User.create({
    name,
    email,
    password,
    role: isFirstUser ? 'admin' : 'student',
  });
  user.touchStreak();
  user.lastLoginAt = new Date();
  await user.save();

  return created(res, authPayload(user), 'Account created successfully.');
});

/** POST /api/auth/login */
const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const user = await User.findOne({ email }).select('+password');
  // Same message either way: never reveal whether the email exists.
  if (!user || !(await user.comparePassword(password))) {
    throw ApiError.unauthorized('Incorrect email or password.');
  }

  user.touchStreak();
  user.lastLoginAt = new Date();
  await user.save();

  const fresh = await User.findById(user._id);
  return ok(res, authPayload(fresh), 'Signed in successfully.');
});

/** POST /api/auth/refresh */
const refresh = asyncHandler(async (req, res) => {
  let decoded;
  try {
    decoded = verifyRefreshToken(req.body.refreshToken);
  } catch {
    throw ApiError.unauthorized('Refresh token is invalid or expired. Please sign in again.');
  }

  const user = await User.findById(decoded.sub);
  if (!user) throw ApiError.unauthorized('This account no longer exists.');

  return ok(res, { accessToken: signAccessToken(user), refreshToken: signRefreshToken(user) });
});

/** GET /api/auth/me */
const me = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).populate('activeExam', 'examName organization subjects');
  return ok(res, { user });
});

/** PATCH /api/auth/me */
const updateProfile = asyncHandler(async (req, res) => {
  const { name, avatarUrl, activeExam, preferences } = req.body;
  const user = await User.findById(req.user._id);

  if (name !== undefined) user.name = name;
  if (avatarUrl !== undefined) user.avatarUrl = avatarUrl;
  if (activeExam !== undefined) user.activeExam = activeExam;
  if (preferences) user.preferences = { ...user.preferences.toObject?.() ?? user.preferences, ...preferences };

  await user.save();
  return ok(res, { user }, 'Profile updated.');
});

/** POST /api/auth/change-password */
const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const user = await User.findById(req.user._id).select('+password');

  if (!(await user.comparePassword(currentPassword))) {
    throw ApiError.unauthorized('Your current password is incorrect.');
  }

  user.password = newPassword;
  await user.save();

  return ok(res, { accessToken: signAccessToken(user) }, 'Password changed.');
});

/** POST /api/auth/logout — tokens are stateless, so this just clears the cookie. */
const logout = asyncHandler(async (_req, res) => {
  res.clearCookie?.('accessToken');
  return ok(res, null, 'Signed out.');
});

module.exports = { signup, login, refresh, me, updateProfile, changePassword, logout };
Object.assign(module.exports, { signup, login, refresh, me, updateProfile, changePassword, logout });
