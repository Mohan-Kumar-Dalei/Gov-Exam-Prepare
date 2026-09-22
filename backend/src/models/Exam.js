const mongoose = require('mongoose');

const syllabusSubjectSchema = new mongoose.Schema(
  {
    subject: { type: String, required: true, trim: true },
    weightage: { type: Number, default: 0 },
    /** False when the AI supplied this subject rather than reading it. */
    fromNotification: { type: Boolean, default: true },
    topics: [
      {
        _id: false,
        name: { type: String, required: true, trim: true },
        subtopics: [{ type: String, trim: true }],
        importance: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
        estimatedHours: { type: Number, default: 2 },
        /** False when the AI supplied this topic rather than reading it. */
        fromNotification: { type: Boolean, default: true },
      },
    ],
  },
  { _id: false },
);

const patternSectionSchema = new mongoose.Schema(
  {
    section: { type: String, required: true },
    questions: { type: Number, default: 0 },
    marks: { type: Number, default: 0 },
    durationMinutes: { type: Number, default: 0 },
    negativeMarking: { type: Number, default: 0 },
  },
  { _id: false },
);

const importantDateSchema = new mongoose.Schema(
  {
    event: { type: String, required: true },
    // Kept as free text: notifications often say things like "3rd week of July".
    date: { type: String, default: '' },
    parsedDate: { type: Date, default: null },
  },
  { _id: false },
);

const examSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    sourceDocument: { type: mongoose.Schema.Types.ObjectId, ref: 'Document', default: null },

    examName: { type: String, required: true, trim: true },
    organization: { type: String, default: '', trim: true },
    postName: { type: String, default: '' },
    advertisementNo: { type: String, default: '' },

    vacancies: {
      total: { type: Number, default: 0 },
      raw: { type: String, default: '' },
      breakdown: [{ _id: false, category: String, count: Number }],
    },

    eligibility: {
      educational: [{ type: String }],
      ageLimit: {
        min: { type: Number, default: null },
        max: { type: Number, default: null },
        relaxation: { type: String, default: '' },
        asOnDate: { type: String, default: '' },
      },
      nationality: { type: String, default: '' },
      other: [{ type: String }],
    },

    selectionProcess: [{ _id: false, stage: String, description: String }],

    examPattern: {
      mode: { type: String, default: 'CBT' },
      totalQuestions: { type: Number, default: 0 },
      totalMarks: { type: Number, default: 0 },
      durationMinutes: { type: Number, default: 0 },
      negativeMarking: { type: Number, default: 0 },
      sections: [patternSectionSchema],
    },

    syllabus: [syllabusSubjectSchema],
    subjects: [{ type: String }],
    importantDates: [importantDateSchema],

    applicationFee: [{ _id: false, category: String, amount: String }],
    officialLinks: [{ type: String }],

    /**
     * Cached mock blueprint. It is derived from the pattern and syllabus, which
     * do not change, so regenerating it on every mock is a wasted model call.
     */
    mockBlueprint: { type: mongoose.Schema.Types.Mixed, default: null },

    /** The syllabus text as printed, so the extraction can be checked against it. */
    syllabusQuote: { type: String, default: '' },

    aiConfidence: { type: Number, default: 0 },
    aiNotes: { type: String, default: '' },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, toJSON: { virtuals: true } },
);

examSchema.index({ user: 1, createdAt: -1 });
examSchema.index({ examName: 'text', organization: 'text' });

examSchema.virtual('topicCount').get(function topicCount() {
  return (this.syllabus || []).reduce((sum, s) => sum + (s.topics?.length || 0), 0);
});

/** Flattened [{ subject, topic, ... }] list — the unit of work everywhere downstream. */
examSchema.methods.flatTopics = function flatTopics() {
  return (this.syllabus || []).flatMap((s) =>
    (s.topics || []).map((t) => ({
      subject: s.subject,
      topic: t.name,
      importance: t.importance,
      subtopics: t.subtopics || [],
    })),
  );
};

examSchema.pre('save', function invalidateBlueprint(next) {
  if (this.isModified('syllabus') || this.isModified('examPattern')) this.mockBlueprint = null;
  next();
});

module.exports = mongoose.model('Exam', examSchema);
