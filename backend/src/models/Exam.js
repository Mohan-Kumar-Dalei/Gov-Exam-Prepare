const mongoose = require('mongoose');
const { topicKey } = require('../utils/text.js');

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

/**
 * Finds the syllabus entry a (subject, topic) pair refers to.
 *
 * Topic labels do not all originate here. The syllabus comes from the
 * notification, but the roadmap planner and the question generator each write
 * their own labels, and a model asked for "Group-A Common Subjects" will
 * happily answer "Current Affairs" whether or not that exact string was
 * extracted. Demanding an exact match turned every such near-miss into a dead
 * "Revise this topic" button, which is the app refusing to teach something it
 * put in front of the learner itself.
 *
 * Matching therefore widens in stages, most trustworthy first, and reports how
 * it succeeded so callers can prefer the canonical label.
 *
 * @returns {{ entry: object, matchedBy: 'exact'|'normalised'|'subject'|'overlap' }|null}
 */
examSchema.methods.resolveTopic = function resolveTopic(subject, topic) {
  const all = this.flatTopics();
  if (!topic) return null;

  const wantTopic = topicKey(topic);
  const wantSubject = topicKey(subject);
  if (!wantTopic) return null;

  const exact = all.find((t) => t.subject === subject && t.topic === topic);
  if (exact) return { entry: exact, matchedBy: 'exact' };

  // Case, spacing and punctuation differences only.
  const normalised = all.find(
    (t) => topicKey(t.subject) === wantSubject && topicKey(t.topic) === wantTopic,
  );
  if (normalised) return { entry: normalised, matchedBy: 'normalised' };

  // Right topic, wrong subject heading — common when a planner regroups the
  // syllabus under its own section names.
  const elsewhere = all.find((t) => topicKey(t.topic) === wantTopic);
  if (elsewhere) return { entry: elsewhere, matchedBy: 'subject' };

  // One label contains the other: "Current Affairs" vs "Current Affairs and
  // General Knowledge". Short keys are excluded because a two-letter overlap
  // is coincidence, not a match.
  if (wantTopic.length >= 5) {
    const overlapping = all
      .filter((t) => {
        const key = topicKey(t.topic);
        return key.length >= 5 && (key.includes(wantTopic) || wantTopic.includes(key));
      })
      // Prefer the same subject, then the closest-length label: against
      // "Current Affairs", "Current Affairs and GK" beats a catch-all
      // "General Studies including Current Affairs".
      .sort((a, b) => {
        const subjectRank =
          Number(topicKey(b.subject) === wantSubject) - Number(topicKey(a.subject) === wantSubject);
        if (subjectRank) return subjectRank;
        return (
          Math.abs(topicKey(a.topic).length - wantTopic.length) -
          Math.abs(topicKey(b.topic).length - wantTopic.length)
        );
      })[0];
    if (overlapping) return { entry: overlapping, matchedBy: 'overlap' };
  }

  return null;
};

examSchema.pre('save', function invalidateBlueprint(next) {
  if (this.isModified('syllabus') || this.isModified('examPattern')) this.mockBlueprint = null;
  next();
});

module.exports = mongoose.model('Exam', examSchema);
