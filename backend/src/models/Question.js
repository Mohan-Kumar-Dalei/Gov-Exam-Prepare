const mongoose = require('mongoose');
const { DIFFICULTIES, QUESTION_TYPES } = require('../config/constants.js');
const { LANGUAGES } = require('../config/languages.js');
const { fingerprint } = require('../utils/text.js');

const questionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    exam: { type: mongoose.Schema.Types.ObjectId, ref: 'Exam', required: true, index: true },

    subject: { type: String, required: true, index: true },
    topic: { type: String, required: true, index: true },

    question: { type: String, required: true, trim: true },
    options: {
      type: [String],
      validate: {
        validator: (v) => Array.isArray(v) && v.length >= 2 && v.length <= 6,
        message: 'A question needs between 2 and 6 options',
      },
    },
    /** Index into `options` — stored numerically so shuffling stays safe. */
    answerIndex: { type: Number, required: true, min: 0 },
    answer: { type: String, required: true },
    explanation: { type: String, default: '' },

    difficulty: { type: String, enum: DIFFICULTIES, default: 'medium', index: true },
    type: { type: String, enum: QUESTION_TYPES, default: 'mcq' },
    marks: { type: Number, default: 1 },

    /** Normalised text hash — the dedupe key that enforces "never repeat a question". */
    fingerprint: { type: String, required: true, index: true },

    language: { type: String, enum: LANGUAGES, default: 'en', index: true },

    /** What real exam pattern this was modelled on — the authenticity audit trail. */
    sourceBasis: { type: String, default: '' },
    /** The model's own 0-100 confidence that the question and answer are factually correct. */
    factualConfidence: { type: Number, default: 100 },
    /** True when the generation was backed by Google Search rather than model memory. */
    grounded: { type: Boolean, default: false },
    /** Pages the search grounding actually consulted — the learner can verify a fact. */
    groundingSources: [{ type: String }],

    source: { type: String, enum: ['ai', 'manual'], default: 'ai' },
    timesServed: { type: Number, default: 0 },
    timesCorrect: { type: Number, default: 0 },
    timesWrong: { type: Number, default: 0 },
    flagged: { type: Boolean, default: false },
  },
  { timestamps: true },
);

// One copy of any given question per user+exam.
questionSchema.index({ user: 1, exam: 1, fingerprint: 1, language: 1 }, { unique: true });
questionSchema.index({ user: 1, exam: 1, topic: 1, difficulty: 1, language: 1 });

questionSchema.pre('validate', function setFingerprint(next) {
  if (!this.fingerprint && this.question) this.fingerprint = fingerprint(this.question);
  if (this.answerIndex == null && this.answer && Array.isArray(this.options)) {
    const idx = this.options.findIndex((o) => o === this.answer);
    if (idx >= 0) this.answerIndex = idx;
  }
  if (this.answerIndex != null && Array.isArray(this.options) && !this.answer) {
    this.answer = this.options[this.answerIndex];
  }
  next();
});

/** Strips the answer before a question is sent to a client mid-test. */
questionSchema.methods.toClient = function toClient({ withAnswer = false } = {}) {
  const base = {
    id: this._id,
    subject: this.subject,
    topic: this.topic,
    question: this.question,
    options: this.options,
    difficulty: this.difficulty,
    type: this.type,
    marks: this.marks,
    language: this.language,
  };
  if (!withAnswer) return base;
  return {
    ...base,
    answerIndex: this.answerIndex,
    answer: this.answer,
    explanation: this.explanation,
    sourceBasis: this.sourceBasis,
    factualConfidence: this.factualConfidence,
    grounded: this.grounded,
    groundingSources: this.groundingSources,
  };
};

module.exports = mongoose.model('Question', questionSchema);
