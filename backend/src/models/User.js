const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { LANGUAGES } = require('../config/languages.js');

const streakSchema = new mongoose.Schema(
  {
    current: { type: Number, default: 0 },
    longest: { type: Number, default: 0 },
    lastActiveOn: { type: Date, default: null },
  },
  { _id: false },
);

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: [true, 'Name is required'], trim: true, maxlength: 80 },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Invalid email address'],
    },
    password: { type: String, required: true, minlength: 8, select: false },
    role: { type: String, enum: ['student', 'admin'], default: 'student' },
    avatarUrl: { type: String, default: '' },

    activeExam: { type: mongoose.Schema.Types.ObjectId, ref: 'Exam', default: null },
    streak: { type: streakSchema, default: () => ({}) },

    preferences: {
      dailyStudyMinutes: { type: Number, default: 120 },
      dailyQuizTarget: { type: Number, default: 20 },
      language: { type: String, enum: LANGUAGES, default: 'en' },
      notifications: { type: Boolean, default: true },
    },

    stats: {
      totalQuestions: { type: Number, default: 0 },
      totalCorrect: { type: Number, default: 0 },
      totalTests: { type: Number, default: 0 },
      totalStudyMinutes: { type: Number, default: 0 },
    },

    lastLoginAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: (_doc, ret) => {
        delete ret.password;
        delete ret.__v;
        return ret;
      },
    },
  },
);

userSchema.virtual('accuracy').get(function accuracy() {
  return this.stats?.totalQuestions
    ? Math.round((this.stats.totalCorrect / this.stats.totalQuestions) * 1000) / 10
    : 0;
});

userSchema.pre('save', async function hashPassword(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  return next();
});

userSchema.methods.comparePassword = function comparePassword(plain) {
  return bcrypt.compare(plain, this.password);
};

/** Rolls the learning streak forward; returns true when this is the first activity today. */
userSchema.methods.touchStreak = function touchStreak(now = new Date()) {
  const dayKey = (d) => new Date(d).toISOString().slice(0, 10);
  const today = dayKey(now);
  const last = this.streak?.lastActiveOn ? dayKey(this.streak.lastActiveOn) : null;

  if (last === today) return false;

  const yesterday = dayKey(new Date(now.getTime() - 86400000));
  this.streak.current = last === yesterday ? (this.streak.current || 0) + 1 : 1;
  this.streak.longest = Math.max(this.streak.longest || 0, this.streak.current);
  this.streak.lastActiveOn = now;
  return true;
};

module.exports = mongoose.model('User', userSchema);
