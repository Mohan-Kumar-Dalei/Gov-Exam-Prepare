const asyncHandler = require('../utils/asyncHandler.js');
const ApiError = require('../utils/ApiError.js');
const { ok, created } = require('../utils/apiResponse.js');
const { Roadmap } = require('../models/index.js');
const { loadOwnedExam } = require('./exam.controller.js');
const { buildRoadmap } = require('../services/roadmap.service.js');

/** POST /api/roadmap — generate or regenerate (PHASE 5). */
const generate = asyncHandler(async (req, res) => {
  const { examId, days, dailyMinutes, startDate, regenerate } = req.body;
  const exam = await loadOwnedExam(req.user._id, examId);

  const existing = await Roadmap.findOne({ user: req.user._id, exam: exam._id, isActive: true });
  if (existing && !regenerate) {
    return ok(res, { roadmap: existing, regenerated: false }, 'An active roadmap already exists.');
  }

  const roadmap = await buildRoadmap({
    userId: req.user._id,
    exam,
    days,
    dailyMinutes,
    startDate: startDate || new Date(),
  });

  return created(res, { roadmap, regenerated: Boolean(existing) }, 'Roadmap ready.');
});

/** GET /api/roadmap?examId= */
const getRoadmap = asyncHandler(async (req, res) => {
  const examId = req.query.examId || req.user.activeExam;
  if (!examId) throw ApiError.badRequest('No active exam.');

  const roadmap = await Roadmap.findOne({ user: req.user._id, exam: examId, isActive: true });
  if (!roadmap) throw ApiError.notFound('No roadmap yet. Generate one first.');

  return ok(res, {
    roadmap,
    currentDay: roadmap.currentDay,
    completionRate: roadmap.completionRate,
  });
});

/** GET /api/roadmap/today?examId= */
const today = asyncHandler(async (req, res) => {
  const examId = req.query.examId || req.user.activeExam;
  if (!examId) throw ApiError.badRequest('No active exam.');

  const roadmap = await Roadmap.findOne({ user: req.user._id, exam: examId, isActive: true });
  if (!roadmap) throw ApiError.notFound('No roadmap yet. Generate one first.');

  const day = roadmap.currentDay;
  const plan = roadmap.days.find((d) => d.day === day);

  return ok(res, {
    roadmapId: roadmap._id,
    day,
    totalDays: roadmap.totalDays,
    plan: plan || null,
    // A little context either side keeps the UI's "what's next" strip honest.
    upcoming: roadmap.days.filter((d) => d.day > day && d.day <= day + 3),
    missed: roadmap.days.filter((d) => d.day < day && !d.completed).slice(-5),
    completionRate: roadmap.completionRate,
  });
});

/** PATCH /api/roadmap/:id/day/:day */
const markDay = asyncHandler(async (req, res) => {
  const { completed, actualMinutes } = req.body;
  const dayNumber = Number(req.params.day);

  const roadmap = await Roadmap.findOne({ _id: req.params.id, user: req.user._id });
  if (!roadmap) throw ApiError.notFound('Roadmap not found.');

  const day = roadmap.days.find((d) => d.day === dayNumber);
  if (!day) throw ApiError.notFound(`Day ${dayNumber} is not part of this roadmap.`);

  day.completed = completed;
  day.completedAt = completed ? new Date() : null;
  day.actualMinutes = actualMinutes || day.actualMinutes;
  await roadmap.save();

  if (completed && req.user.touchStreak()) await req.user.save();

  return ok(res, { day, completionRate: roadmap.completionRate, streak: req.user.streak });
});

/** DELETE /api/roadmap/:id */
const deleteRoadmap = asyncHandler(async (req, res) => {
  const roadmap = await Roadmap.findOneAndDelete({ _id: req.params.id, user: req.user._id });
  if (!roadmap) throw ApiError.notFound('Roadmap not found.');
  return ok(res, null, 'Roadmap deleted.');
});

module.exports = { generate, getRoadmap, today, markDay, deleteRoadmap };
Object.assign(module.exports, { generate, getRoadmap, today, markDay, deleteRoadmap });
