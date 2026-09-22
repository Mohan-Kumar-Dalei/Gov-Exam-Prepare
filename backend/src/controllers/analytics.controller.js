const asyncHandler = require('../utils/asyncHandler.js');
const ApiError = require('../utils/ApiError.js');
const { ok } = require('../utils/apiResponse.js');
const { Document, Exam, Roadmap, TestSession } = require('../models/index.js');
const { loadOwnedExam } = require('./exam.controller.js');
const analytics = require('../services/analytics.service.js');
const { predictReadiness } = require('../services/ai.service.js');

/** Falls back to the user's active exam when no examId is supplied. */
async function resolveExam(req) {
  const examId = req.query.examId || req.params.examId || req.user.activeExam;
  if (!examId) throw ApiError.badRequest('No active exam. Upload a notification PDF first.');
  return loadOwnedExam(req.user._id, examId);
}

/** GET /api/analytics/dashboard */
const dashboard = asyncHandler(async (req, res) => {
  const examId = req.query.examId || req.user.activeExam;

  if (!examId) {
    const documents = await Document.countDocuments({ user: req.user._id });
    return ok(res, {
      hasExam: false,
      documents,
      streak: req.user.streak,
      message: 'Upload a recruitment notification PDF to get started.',
    });
  }

  const exam = await loadOwnedExam(req.user._id, examId);

  const [overview, topics, subjects, trend, readiness, roadmap, documents, recentSessions] =
    await Promise.all([
      analytics.overview({ userId: req.user._id, examId: exam._id }),
      analytics.topicBreakdown({ userId: req.user._id, examId: exam._id }),
      analytics.subjectBreakdown({ userId: req.user._id, examId: exam._id }),
      analytics.scoreTrend({ userId: req.user._id, examId: exam._id, limit: 10 }),
      analytics.readinessScore({ userId: req.user._id, examId: exam._id }),
      Roadmap.findOne({ user: req.user._id, exam: exam._id, isActive: true }).lean(),
      Document.countDocuments({ user: req.user._id }),
      TestSession.find({ user: req.user._id, exam: exam._id, status: 'submitted' })
        .sort({ submittedAt: -1 })
        .limit(5)
        .select('title mode score maxScore accuracy submittedAt')
        .lean(),
    ]);

  let today = null;
  if (roadmap) {
    const dayNumber = Math.min(
      Math.max(1, Math.floor((Date.now() - new Date(roadmap.startDate).getTime()) / 86400000) + 1),
      roadmap.totalDays,
    );
    const plan = roadmap.days.find((d) => d.day === dayNumber);
    const done = roadmap.days.filter((d) => d.completed).length;
    today = {
      roadmapId: roadmap._id,
      day: dayNumber,
      totalDays: roadmap.totalDays,
      completedDays: done,
      completionRate: Math.round((done / roadmap.totalDays) * 1000) / 10,
      plan: plan || null,
    };
  }

  return ok(res, {
    hasExam: true,
    exam: {
      id: exam._id,
      examName: exam.examName,
      organization: exam.organization,
      subjects: exam.subjects,
      vacancies: exam.vacancies,
      importantDates: exam.importantDates,
      examPattern: exam.examPattern,
      topicCount: exam.topicCount,
    },
    streak: req.user.streak,
    overview,
    readiness,
    strongTopics: topics.strong,
    weakTopics: topics.weak,
    subjectPerformance: subjects,
    scoreTrend: trend,
    today,
    documents,
    recentSessions,
  });
});

/** GET /api/analytics/topics */
const topics = asyncHandler(async (req, res) => {
  const exam = await resolveExam(req);
  const data = await analytics.topicBreakdown({ userId: req.user._id, examId: exam._id });
  return ok(res, data);
});

/** GET /api/analytics/subjects */
const subjects = asyncHandler(async (req, res) => {
  const exam = await resolveExam(req);
  const data = await analytics.subjectBreakdown({ userId: req.user._id, examId: exam._id });
  return ok(res, data);
});

/** GET /api/analytics/trend */
const trend = asyncHandler(async (req, res) => {
  const exam = await resolveExam(req);
  const data = await analytics.scoreTrend({
    userId: req.user._id,
    examId: exam._id,
    limit: Number(req.query.limit) || 15,
  });
  return ok(res, data);
});

/** GET /api/analytics/activity */
const activity = asyncHandler(async (req, res) => {
  const data = await analytics.activityHeatmap({
    userId: req.user._id,
    days: Number(req.query.days) || 90,
  });
  return ok(res, { days: data, streak: req.user.streak });
});

/**
 * GET /api/analytics/readiness  (PHASE 7)
 * Returns the deterministic score always, and the AI narrative when `ai=true`.
 */
const readiness = asyncHandler(async (req, res) => {
  const exam = await resolveExam(req);
  const base = await analytics.readinessScore({ userId: req.user._id, examId: exam._id });

  if (req.query.ai !== 'true') return ok(res, { ...base, ai: null });

  const snapshot = await analytics.learnerSnapshot({ userId: req.user._id, exam });
  const prediction = await predictReadiness(snapshot, req.user.preferences?.language || 'en');

  return ok(res, { ...base, ai: prediction });
});

/** GET /api/analytics/weak-topics — the adaptive engine's current focus list. */
const weakTopics = asyncHandler(async (req, res) => {
  const exam = await resolveExam(req);
  const data = await analytics.topicBreakdown({ userId: req.user._id, examId: exam._id });
  return ok(res, { weak: data.weak, untouched: data.untouched.slice(0, 20) });
});

/** GET /api/analytics/exams — one summary row per exam the user has uploaded. */
const examSummaries = asyncHandler(async (req, res) => {
  const exams = await Exam.find({ user: req.user._id }).select('examName organization').lean();

  const rows = await Promise.all(
    exams.map(async (e) => ({
      ...e,
      ...(await analytics.readinessScore({ userId: req.user._id, examId: e._id })),
    })),
  );

  return ok(res, rows);
});

module.exports = {
  dashboard,
  topics,
  subjects,
  trend,
  activity,
  readiness,
  weakTopics,
  examSummaries,
};
Object.assign(module.exports, { dashboard, topics, subjects, trend, activity, readiness, weakTopics, examSummaries });
