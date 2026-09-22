const mongoose = require('mongoose');
const { Progress, TestSession, Question, Lesson } = require('../models/index.js');
const { pct } = require('../utils/text.js');
const { MASTERY } = require('../config/constants.js');

const oid = (id) => new mongoose.Types.ObjectId(String(id));

/** Headline counters for the dashboard cards. */
async function overview({ userId, examId }) {
  const match = { user: oid(userId), ...(examId ? { exam: oid(examId) } : {}) };

  const [sessionAgg] = await TestSession.aggregate([
    { $match: { ...match, status: 'submitted' } },
    {
      $group: {
        _id: null,
        tests: { $sum: 1 },
        attempted: { $sum: '$attempted' },
        correct: { $sum: '$correct' },
        wrong: { $sum: '$wrong' },
        skipped: { $sum: '$skipped' },
        timeSec: { $sum: '$timeTakenSec' },
        score: { $sum: '$score' },
        maxScore: { $sum: '$maxScore' },
      },
    },
  ]);

  const s = sessionAgg || {
    tests: 0, attempted: 0, correct: 0, wrong: 0, skipped: 0, timeSec: 0, score: 0, maxScore: 0,
  };

  const [progressAgg] = await Progress.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        topics: { $sum: 1 },
        touched: { $sum: { $cond: [{ $gt: ['$attempted', 0] }, 1, 0] } },
        avgMastery: { $avg: '$mastery' },
        lessonsDone: { $sum: { $cond: ['$lessonCompleted', 1, 0] } },
      },
    },
  ]);

  const p = progressAgg || { topics: 0, touched: 0, avgMastery: 0, lessonsDone: 0 };
  const questionBank = await Question.countDocuments(match);

  return {
    totalTests: s.tests,
    totalQuestionsAttempted: s.attempted,
    totalCorrect: s.correct,
    totalWrong: s.wrong,
    totalSkipped: s.skipped,
    accuracy: pct(s.correct, s.attempted),
    scoreEfficiency: pct(s.score, s.maxScore),
    avgTimePerQuestionSec: s.attempted ? Math.round(s.timeSec / s.attempted) : 0,
    totalStudyMinutes: Math.round(s.timeSec / 60),
    topicsTotal: p.topics,
    topicsTouched: p.touched,
    syllabusCoverage: pct(p.touched, p.topics),
    avgMastery: Math.round((p.avgMastery || 0) * 10) / 10,
    lessonsCompleted: p.lessonsDone,
    questionBankSize: questionBank,
  };
}

/** Strong / weak split plus full per-topic table. */
async function topicBreakdown({ userId, examId }) {
  const rows = await Progress.find({ user: oid(userId), exam: oid(examId) })
    .sort({ mastery: -1 })
    .lean();

  const touched = rows.filter((r) => r.attempted > 0);

  return {
    all: rows.map((r) => ({
      subject: r.subject,
      topic: r.topic,
      attempted: r.attempted,
      correct: r.correct,
      wrong: r.wrong,
      mistakeCount: r.mistakeCount,
      accuracy: r.accuracy,
      mastery: r.mastery,
      level: r.level,
      avgTimeSec: r.avgTimeSec,
      lessonCompleted: r.lessonCompleted,
      lastAttemptedAt: r.lastAttemptedAt,
    })),
    strong: touched
      .filter((r) => r.mastery >= MASTERY.AVERAGE)
      .slice(0, 10)
      .map((r) => ({ subject: r.subject, topic: r.topic, mastery: r.mastery, accuracy: r.accuracy })),
    weak: touched
      .filter((r) => r.mastery < MASTERY.WEAK)
      .sort((a, b) => a.mastery - b.mastery)
      .slice(0, 10)
      .map((r) => ({
        subject: r.subject,
        topic: r.topic,
        mastery: r.mastery,
        accuracy: r.accuracy,
        mistakeCount: r.mistakeCount,
      })),
    untouched: rows.filter((r) => r.attempted === 0).map((r) => ({ subject: r.subject, topic: r.topic })),
  };
}

/** Subject-level roll-up for the radar / bar charts. */
async function subjectBreakdown({ userId, examId }) {
  return Progress.aggregate([
    { $match: { user: oid(userId), exam: oid(examId) } },
    {
      $group: {
        _id: '$subject',
        topics: { $sum: 1 },
        attempted: { $sum: '$attempted' },
        correct: { $sum: '$correct' },
        wrong: { $sum: '$wrong' },
        mastery: { $avg: '$mastery' },
      },
    },
    {
      $project: {
        _id: 0,
        subject: '$_id',
        topics: 1,
        attempted: 1,
        correct: 1,
        wrong: 1,
        mastery: { $round: [{ $ifNull: ['$mastery', 0] }, 1] },
        accuracy: {
          $cond: [
            { $gt: ['$attempted', 0] },
            { $round: [{ $multiply: [{ $divide: ['$correct', '$attempted'] }, 100] }, 1] },
            0,
          ],
        },
      },
    },
    { $sort: { mastery: -1 } },
  ]);
}

/** Score trend over the last N submitted sessions. */
async function scoreTrend({ userId, examId, limit = 15 }) {
  const sessions = await TestSession.find({
    user: oid(userId),
    ...(examId ? { exam: oid(examId) } : {}),
    status: 'submitted',
  })
    .sort({ submittedAt: -1 })
    .limit(limit)
    .select('title mode score maxScore accuracy attempted correct submittedAt timeTakenSec')
    .lean();

  return sessions.reverse().map((s) => ({
    id: s._id,
    title: s.title || s.mode,
    mode: s.mode,
    score: s.score,
    maxScore: s.maxScore,
    accuracy: s.accuracy,
    attempted: s.attempted,
    correct: s.correct,
    date: s.submittedAt,
    minutes: Math.round((s.timeTakenSec || 0) / 60),
  }));
}

/** Daily activity for the last `days` days — drives the streak heatmap. */
async function activityHeatmap({ userId, days = 90 }) {
  const from = new Date(Date.now() - days * 86400000);

  const rows = await TestSession.aggregate([
    { $match: { user: oid(userId), status: 'submitted', submittedAt: { $gte: from } } },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$submittedAt' } },
        questions: { $sum: '$attempted' },
        correct: { $sum: '$correct' },
        minutes: { $sum: { $divide: ['$timeTakenSec', 60] } },
        sessions: { $sum: 1 },
      },
    },
    { $project: { _id: 0, date: '$_id', questions: 1, correct: 1, sessions: 1, minutes: { $round: ['$minutes', 0] } } },
    { $sort: { date: 1 } },
  ]);

  return rows;
}

/**
 * Deterministic readiness score, used on its own and as the grounding input for
 * the AI prediction so the model cannot drift far from the numbers.
 *
 *   50% weighted mastery across the syllabus
 *   30% syllabus coverage
 *   20% recent test accuracy
 */
async function readinessScore({ userId, examId }) {
  const [rows, recent] = await Promise.all([
    Progress.find({ user: oid(userId), exam: oid(examId) }).lean(),
    TestSession.find({ user: oid(userId), exam: oid(examId), status: 'submitted' })
      .sort({ submittedAt: -1 })
      .limit(5)
      .select('accuracy')
      .lean(),
  ]);

  const total = rows.length || 1;
  const masterySum = rows.reduce((s, r) => s + (r.mastery || 0), 0);
  const avgMastery = masterySum / total;
  const coverage = pct(rows.filter((r) => r.attempted > 0).length, total);
  const recentAccuracy = recent.length
    ? recent.reduce((s, r) => s + (r.accuracy || 0), 0) / recent.length
    : 0;

  const readiness = Math.round(avgMastery * 0.5 + coverage * 0.3 + recentAccuracy * 0.2);

  return {
    readiness: Math.min(100, Math.max(0, readiness)),
    components: {
      avgMastery: Math.round(avgMastery * 10) / 10,
      syllabusCoverage: coverage,
      recentAccuracy: Math.round(recentAccuracy * 10) / 10,
    },
    topicsTotal: rows.length,
    topicsTouched: rows.filter((r) => r.attempted > 0).length,
  };
}

/** Compact snapshot handed to the AI mentor and readiness predictor. */
async function learnerSnapshot({ userId, exam }) {
  const [base, topics, subjects, trend, lessons] = await Promise.all([
    readinessScore({ userId, examId: exam._id }),
    topicBreakdown({ userId, examId: exam._id }),
    subjectBreakdown({ userId, examId: exam._id }),
    scoreTrend({ userId, examId: exam._id, limit: 5 }),
    Lesson.countDocuments({ user: userId, exam: exam._id, completed: true }),
  ]);

  return {
    exam: exam.examName,
    organization: exam.organization,
    subjects: exam.subjects,
    examPattern: exam.examPattern,
    readiness: base.readiness,
    readinessComponents: base.components,
    syllabusTopics: base.topicsTotal,
    topicsAttempted: base.topicsTouched,
    lessonsCompleted: lessons,
    weakTopics: topics.weak,
    strongTopics: topics.strong,
    untouchedTopicCount: topics.untouched.length,
    subjectPerformance: subjects,
    recentTests: trend,
  };
}

module.exports = {
  overview,
  topicBreakdown,
  subjectBreakdown,
  scoreTrend,
  activityHeatmap,
  readinessScore,
  learnerSnapshot,
};
Object.assign(module.exports, { overview, topicBreakdown, subjectBreakdown, scoreTrend, activityHeatmap, readinessScore, learnerSnapshot });
