const mongoose = require('mongoose');
const { MASTERY } = require('../config/constants.js');

/**
 * One row per (user, exam, subject, topic).
 * This is the adaptive engine's memory: every answer updates it, and every
 * question batch is weighted from it.
 */
const progressSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    exam: { type: mongoose.Schema.Types.ObjectId, ref: 'Exam', required: true, index: true },

    subject: { type: String, required: true },
    topic: { type: String, required: true },

    attempted: { type: Number, default: 0 },
    correct: { type: Number, default: 0 },
    wrong: { type: Number, default: 0 },
    mistakeCount: { type: Number, default: 0 },
    /** Consecutive correct answers — resets to 0 on a mistake. */
    streak: { type: Number, default: 0 },

    accuracy: { type: Number, default: 0 },
    mastery: { type: Number, default: 0 },
    level: {
      type: String,
      enum: ['untouched', 'weak', 'average', 'strong', 'mastered'],
      default: 'untouched',
      index: true,
    },

    avgTimeSec: { type: Number, default: 0 },
    totalTimeSec: { type: Number, default: 0 },

    lessonCompleted: { type: Boolean, default: false },
    revisionDue: { type: Date, default: null },
    lastAttemptedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

progressSchema.index({ user: 1, exam: 1, subject: 1, topic: 1 }, { unique: true });
progressSchema.index({ user: 1, exam: 1, mastery: 1 });

/**
 * Mastery blends raw accuracy with a confidence factor so that 2/2 does not
 * outrank 18/20. Confidence saturates at 10 attempts.
 */
progressSchema.methods.recompute = function recompute() {
  const total = this.attempted || 0;
  this.accuracy = total ? Math.round((this.correct / total) * 1000) / 10 : 0;

  const confidence = Math.min(1, total / 10);
  this.mastery = Math.round(this.accuracy * confidence * 10) / 10;

  if (total === 0) this.level = 'untouched';
  else if (this.mastery >= 90 && this.accuracy >= MASTERY.STRONG) this.level = 'mastered';
  else if (this.mastery >= MASTERY.AVERAGE) this.level = 'strong';
  else if (this.mastery >= MASTERY.WEAK) this.level = 'average';
  else this.level = 'weak';

  // Spaced repetition: the weaker the topic, the sooner it comes back.
  const days = this.level === 'weak' ? 1 : this.level === 'average' ? 3 : this.level === 'strong' ? 7 : 14;
  this.revisionDue = new Date(Date.now() + days * 86400000);

  return this;
};

module.exports = mongoose.model('Progress', progressSchema);
