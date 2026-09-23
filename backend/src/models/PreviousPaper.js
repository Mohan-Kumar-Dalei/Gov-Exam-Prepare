const mongoose = require('mongoose');
const { LANGUAGES } = require('../config/languages.js');

/**
 * A previous-year question paper the learner can revise.
 *
 * An important honesty constraint shapes this model. A language model cannot
 * reproduce a real question paper verbatim, and one that claims to is the most
 * damaging thing this app could ship: a learner would revise fabricated
 * questions believing they are the real exam. So every paper records how it
 * was produced and how confident the model was, and the UI shows that next to
 * the questions rather than presenting them as a scan of the original.
 */
const paperQuestionSchema = new mongoose.Schema(
  {
    questionNumber: { type: Number, default: 0 },
    question: { type: String, required: true, trim: true },
    options: {
      type: [String],
      validate: {
        validator: (v) => Array.isArray(v) && v.length >= 2 && v.length <= 6,
        message: 'A question needs between 2 and 6 options',
      },
    },
    answerIndex: { type: Number, required: true, min: 0 },
    answer: { type: String, required: true },
    explanation: { type: String, default: '' },

    subject: { type: String, default: '' },
    topic: { type: String, default: '' },
    marks: { type: Number, default: 1 },

    /**
     * How this question relates to the real paper:
     *   recalled      — the model recognises it from the actual paper
     *   reconstructed — same pattern and syllabus point, rewritten
     */
    provenance: {
      type: String,
      enum: ['recalled', 'reconstructed'],
      default: 'reconstructed',
    },
    /** The model's own 0-100 confidence that the question and answer are correct. */
    factualConfidence: { type: Number, default: 100 },
  },
  { _id: false },
);

const previousPaperSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    exam: { type: mongoose.Schema.Types.ObjectId, ref: 'Exam', required: true, index: true },

    year: { type: Number, required: true, index: true },
    /** e.g. "Paper I", "Shift 2" — blank when the exam has a single paper. */
    paperName: { type: String, default: '', trim: true },

    questions: { type: [paperQuestionSchema], default: [] },

    language: { type: String, enum: LANGUAGES, default: 'en', index: true },

    /** True when Google Search backed the generation rather than model memory. */
    grounded: { type: Boolean, default: false },
    groundingSources: [{ type: String }],
    /** What the model says it based this paper on — the audit trail. */
    sourceBasis: { type: String, default: '' },

    revisedCount: { type: Number, default: 0 },
    lastRevisedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// One paper per year per name, so regenerating replaces rather than duplicates.
previousPaperSchema.index({ user: 1, exam: 1, year: 1, paperName: 1, language: 1 }, { unique: true });
previousPaperSchema.index({ user: 1, exam: 1, year: -1 });

/** Share of questions the model claims to actually recognise from the real paper. */
previousPaperSchema.virtual('recalledCount').get(function recalledCount() {
  return (this.questions || []).filter((q) => q.provenance === 'recalled').length;
});

previousPaperSchema.set('toJSON', { virtuals: true });
previousPaperSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('PreviousPaper', previousPaperSchema);
