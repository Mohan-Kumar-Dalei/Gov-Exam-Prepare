const asyncHandler = require('../utils/asyncHandler.js');
const ApiError = require('../utils/ApiError.js');
const { ok } = require('../utils/apiResponse.js');
const { Exam, User, Progress, Question, Lesson, Roadmap, TestSession } = require('../models/index.js');
const { seedProgress } = require('../services/roadmap.service.js');
const { parsePagination, buildMeta } = require('../utils/pagination.js');

/** Loads an exam the caller owns, or throws 404. Reused by most controllers. */
async function loadOwnedExam(userId, examId) {
  const exam = await Exam.findOne({ _id: examId, user: userId });
  if (!exam) throw ApiError.notFound('Exam not found.');
  return exam;
}

/** GET /api/exams */
const listExams = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);

  const [items, total] = await Promise.all([
    Exam.find({ user: req.user._id }).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Exam.countDocuments({ user: req.user._id }),
  ]);

  const withCounts = items.map((e) => ({
    ...e,
    topicCount: (e.syllabus || []).reduce((s, x) => s + (x.topics?.length || 0), 0),
    isActive: String(req.user.activeExam || '') === String(e._id),
  }));

  return ok(res, withCounts, 'OK', buildMeta(total, page, limit));
});

/** GET /api/exams/:id */
const getExam = asyncHandler(async (req, res) => {
  const exam = await loadOwnedExam(req.user._id, req.params.id);
  const [topicsTracked, questionCount] = await Promise.all([
    Progress.countDocuments({ user: req.user._id, exam: exam._id }),
    Question.countDocuments({ user: req.user._id, exam: exam._id }),
  ]);

  return ok(res, {
    exam,
    stats: { topicsTracked, questionBankSize: questionCount, topicCount: exam.topicCount },
  });
});

/** GET /api/exams/:id/syllabus — flattened, with live mastery attached. */
const getSyllabus = asyncHandler(async (req, res) => {
  const exam = await loadOwnedExam(req.user._id, req.params.id);
  const rows = await Progress.find({ user: req.user._id, exam: exam._id }).lean();
  const byKey = new Map(rows.map((r) => [`${r.subject}::${r.topic}`, r]));

  const syllabus = exam.syllabus.map((s) => ({
    subject: s.subject,
    weightage: s.weightage,
    topics: s.topics.map((t) => {
      const p = byKey.get(`${s.subject}::${t.name}`);
      return {
        name: t.name,
        subtopics: t.subtopics,
        importance: t.importance,
        estimatedHours: t.estimatedHours,
        mastery: p?.mastery ?? 0,
        accuracy: p?.accuracy ?? 0,
        attempted: p?.attempted ?? 0,
        level: p?.level ?? 'untouched',
        lessonCompleted: p?.lessonCompleted ?? false,
      };
    }),
  }));

  return ok(res, { examName: exam.examName, subjects: exam.subjects, syllabus });
});

/** POST /api/exams/:id/activate */
const setActiveExam = asyncHandler(async (req, res) => {
  const exam = await loadOwnedExam(req.user._id, req.params.id);
  await User.findByIdAndUpdate(req.user._id, { activeExam: exam._id });
  // Backfill Progress in case the exam predates the seeding step.
  await seedProgress(req.user._id, exam);

  return ok(res, { activeExam: exam._id }, `${exam.examName} is now your active exam.`);
});

/** PATCH /api/exams/:id — manual correction of an AI extraction. */
const updateExam = asyncHandler(async (req, res) => {
  const exam = await loadOwnedExam(req.user._id, req.params.id);

  const editable = ['examName', 'organization', 'postName', 'examPattern', 'syllabus', 'subjects', 'importantDates'];
  editable.forEach((field) => {
    if (req.body[field] !== undefined) exam[field] = req.body[field];
  });

  await exam.save();
  if (req.body.syllabus) await seedProgress(req.user._id, exam);

  return ok(res, { exam }, 'Exam updated.');
});

/** DELETE /api/exams/:id — removes the exam and everything derived from it. */
const deleteExam = asyncHandler(async (req, res) => {
  const exam = await loadOwnedExam(req.user._id, req.params.id);
  const scope = { user: req.user._id, exam: exam._id };

  await Promise.all([
    Progress.deleteMany(scope),
    Question.deleteMany(scope),
    Lesson.deleteMany(scope),
    Roadmap.deleteMany(scope),
    TestSession.deleteMany(scope),
  ]);
  await exam.deleteOne();

  await User.updateOne(
    { _id: req.user._id, activeExam: exam._id },
    { $set: { activeExam: null } },
  );

  return ok(res, null, 'Exam and all related study data deleted.');
});

module.exports = { listExams, getExam, getSyllabus, setActiveExam, updateExam, deleteExam };
Object.assign(module.exports, { listExams, getExam, getSyllabus, setActiveExam, updateExam, deleteExam, loadOwnedExam });
