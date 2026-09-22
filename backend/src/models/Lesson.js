const mongoose = require('mongoose');
const { LANGUAGES } = require('../config/languages.js');

/** Cached AI teaching output for one (exam, subject, topic). */
const lessonSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    exam: { type: mongoose.Schema.Types.ObjectId, ref: 'Exam', required: true, index: true },

    subject: { type: String, required: true },
    topic: { type: String, required: true },
    language: { type: String, enum: LANGUAGES, default: 'en' },

    explanation: { type: String, default: '' },
    importantConcepts: [
      { _id: false, concept: String, detail: String },
    ],
    shortNotes: [{ type: String }],
    tricks: [{ type: String }],
    examples: [
      { _id: false, problem: String, solution: String, takeaway: String },
    ],
    formulas: [{ _id: false, name: String, expression: String, usage: String }],
    commonMistakes: [{ type: String }],
    estimatedMinutes: { type: Number, default: 20 },

    readCount: { type: Number, default: 0 },
    completed: { type: Boolean, default: false },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

lessonSchema.index({ user: 1, exam: 1, subject: 1, topic: 1, language: 1 }, { unique: true });

module.exports = mongoose.model('Lesson', lessonSchema);
