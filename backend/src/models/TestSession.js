const mongoose = require('mongoose');
const { SESSION_MODES } = require('../config/constants.js');

const responseSchema = new mongoose.Schema(
  {
    question: { type: mongoose.Schema.Types.ObjectId, ref: 'Question', required: true },
    subject: { type: String, default: '' },
    topic: { type: String, default: '' },
    difficulty: { type: String, default: 'medium' },
    selectedIndex: { type: Number, default: null },
    correctIndex: { type: Number, required: true },
    isCorrect: { type: Boolean, default: false },
    isSkipped: { type: Boolean, default: true },
    timeSpentSec: { type: Number, default: 0 },
    marksAwarded: { type: Number, default: 0 },
  },
  { _id: false },
);

const testSessionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    exam: { type: mongoose.Schema.Types.ObjectId, ref: 'Exam', required: true, index: true },

    mode: { type: String, enum: SESSION_MODES, default: 'quiz', index: true },
    title: { type: String, default: '' },
    subjects: [{ type: String }],
    topics: [{ type: String }],
    difficulty: { type: String, default: 'mixed' },

    questions: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Question' }],
    responses: [responseSchema],

    totalQuestions: { type: Number, default: 0 },
    attempted: { type: Number, default: 0 },
    correct: { type: Number, default: 0 },
    wrong: { type: Number, default: 0 },
    skipped: { type: Number, default: 0 },
    score: { type: Number, default: 0 },
    maxScore: { type: Number, default: 0 },
    accuracy: { type: Number, default: 0 },
    negativeMarking: { type: Number, default: 0 },

    durationMinutes: { type: Number, default: 0 },
    timeTakenSec: { type: Number, default: 0 },

    status: {
      type: String,
      enum: ['in_progress', 'submitted', 'expired', 'abandoned'],
      default: 'in_progress',
      index: true,
    },
    startedAt: { type: Date, default: Date.now },
    submittedAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },

    /** Per-topic roll-up computed at submit time; drives the analytics dashboard. */
    topicPerformance: [
      {
        _id: false,
        subject: String,
        topic: String,
        total: Number,
        correct: Number,
        accuracy: Number,
      },
    ],
    aiFeedback: {
      summary: { type: String, default: '' },
      strongTopics: [{ type: String }],
      weakTopics: [{ type: String }],
      confidenceLevel: { type: String, default: '' },
      nextSteps: [{ type: String }],
    },
  },
  { timestamps: true },
);

testSessionSchema.index({ user: 1, createdAt: -1 });
testSessionSchema.index({ user: 1, exam: 1, status: 1 });

module.exports = mongoose.model('TestSession', testSessionSchema);
