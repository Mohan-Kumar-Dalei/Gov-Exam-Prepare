const asyncHandler = require('../utils/asyncHandler.js');
const ApiError = require('../utils/ApiError.js');
const { ok } = require('../utils/apiResponse.js');
const { Lesson, Progress } = require('../models/index.js');
const { loadOwnedExam } = require('./exam.controller.js');
const { generateLesson, generateLessonStreamed } = require('../services/ai.service.js');
const logger = require('../utils/logger.js');
const { normaliseLanguage } = require('../config/languages.js');
const { warmQuestionBank } = require('../services/adaptive.service.js');

/**
 * GET /api/learning/:examId/lesson?subject=&topic=&refresh=
 *
 * PHASE 1 — teach, then note, then example. Lessons are cached per topic; pass
 * `refresh=true` to force a fresh generation.
 */
const getLesson = asyncHandler(async (req, res) => {
  const { subject, topic, refresh, level } = req.query;
  const language = normaliseLanguage(req.query.language, req.user.preferences?.language);
  const exam = await loadOwnedExam(req.user._id, req.params.examId);

  const known = exam.flatTopics().find((t) => t.subject === subject && t.topic === topic);
  if (!known) {
    throw ApiError.badRequest(`"${topic}" is not a topic in ${subject} for this exam.`);
  }

  let lesson = await Lesson.findOne({ user: req.user._id, exam: exam._id, subject, topic, language });

  if (lesson && !refresh) {
    lesson.readCount += 1;
    await lesson.save();
    return ok(res, { lesson, cached: true });
  }

  const content = await generateLesson({
    examName: exam.examName,
    subject,
    topic,
    subtopics: known.subtopics,
    level,
    language,
  });

  // Upsert rather than create: two tabs (or React StrictMode's double effect)
  // can both miss the cache and race to insert, which used to trip the unique
  // index and surface as a confusing 409.
  lesson = await Lesson.findOneAndUpdate(
    { user: req.user._id, exam: exam._id, subject, topic, language },
    { $set: content, $inc: { readCount: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );

  return ok(res, { lesson, cached: false }, 'Lesson ready.');
});

/**
 * GET /api/learning/:examId/lesson/stream — Server-Sent Events.
 *
 * Emits the teaching prose as it is written, then the structured revision
 * material. A cached lesson is replayed in one frame with no model call.
 */
const getLessonStream = asyncHandler(async (req, res) => {
  const { subject, topic, refresh, level } = req.query;
  const language = normaliseLanguage(req.query.language, req.user.preferences?.language);
  const exam = await loadOwnedExam(req.user._id, req.params.examId);

  const known = exam.flatTopics().find((t) => t.subject === subject && t.topic === topic);
  if (!known) throw ApiError.badRequest(`"${topic}" is not a topic in ${subject} for this exam.`);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  const cached = await Lesson.findOne({ user: req.user._id, exam: exam._id, subject, topic, language });

  if (cached && !refresh) {
    cached.readCount += 1;
    await cached.save();
    send('cached', { lesson: cached });
    send('done', { cached: true });
    return res.end();
  }

  send('start', { subject, topic, language });

  try {
    const content = await generateLessonStreamed({
      examName: exam.examName,
      subject,
      topic,
      subtopics: known.subtopics,
      level,
      language,
      onProse: (chunk) => send('prose', { text: chunk }),
    });

    const { structureFailed, structureError, ...fields } = content;

    const lesson = await Lesson.findOneAndUpdate(
      { user: req.user._id, exam: exam._id, subject, topic, language },
      { $set: fields, $inc: { readCount: 1 } },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );

    // Always emit `structure`, even when the revision half failed — otherwise
    // the notes, examples and tricks tabs wait on an event that never arrives.
    send('structure', { lesson, partial: Boolean(structureFailed), error: structureError || null });
    send('done', { cached: false });

    // "Quiz me" is the usual next click, so have those questions ready.
    warmQuestionBank({ userId: req.user._id, exam, language });
  } catch (err) {
    logger.error('Lesson stream failed', err.message);
    send('error', { message: err.message });
  }

  return res.end();
});

/** POST /api/learning/:examId/lesson/complete */
const completeLesson = asyncHandler(async (req, res) => {
  const { subject, topic } = req.body;
  if (!subject || !topic) throw ApiError.badRequest('subject and topic are required.');

  const exam = await loadOwnedExam(req.user._id, req.params.examId);

  const lesson = await Lesson.findOneAndUpdate(
    { user: req.user._id, exam: exam._id, subject, topic },
    { completed: true, completedAt: new Date() },
    { new: true },
  );
  if (!lesson) throw ApiError.notFound('Generate the lesson before marking it complete.');

  await Progress.findOneAndUpdate(
    { user: req.user._id, exam: exam._id, subject, topic },
    { lessonCompleted: true },
    { upsert: true },
  );

  // Studying counts toward the streak, not just testing.
  if (req.user.touchStreak()) await req.user.save();

  return ok(res, { lesson, streak: req.user.streak }, 'Lesson marked complete.');
});

/** GET /api/learning/:examId/lessons */
const listLessons = asyncHandler(async (req, res) => {
  const exam = await loadOwnedExam(req.user._id, req.params.examId);

  const lessons = await Lesson.find({ user: req.user._id, exam: exam._id })
    .select('subject topic completed completedAt readCount estimatedMinutes updatedAt')
    .sort({ updatedAt: -1 })
    .lean();

  return ok(res, lessons);
});

/**
 * GET /api/learning/:examId/next
 * What to study next: weakest touched topic first, otherwise the next untouched
 * high-importance topic.
 */
const nextTopic = asyncHandler(async (req, res) => {
  const exam = await loadOwnedExam(req.user._id, req.params.examId);
  const rows = await Progress.find({ user: req.user._id, exam: exam._id }).lean();

  const weakest = rows
    .filter((r) => r.attempted > 0 && r.mastery < 60)
    .sort((a, b) => a.mastery - b.mastery)[0];

  const untouched = exam
    .flatTopics()
    .filter((t) => {
      const row = rows.find((r) => r.subject === t.subject && r.topic === t.topic);
      return !row || (!row.lessonCompleted && row.attempted === 0);
    })
    .sort((a, b) => {
      const rank = { high: 0, medium: 1, low: 2 };
      return rank[a.importance] - rank[b.importance];
    })[0];

  const recommendation = weakest
    ? {
        subject: weakest.subject,
        topic: weakest.topic,
        reason: `Your mastery here is ${weakest.mastery}% — the lowest among topics you have attempted.`,
        action: 'revise',
      }
    : untouched
      ? {
          subject: untouched.subject,
          topic: untouched.topic,
          reason: `A ${untouched.importance}-importance topic you have not started yet.`,
          action: 'study',
        }
      : null;

  return ok(res, {
    recommendation,
    coverage: {
      total: rows.length,
      touched: rows.filter((r) => r.attempted > 0).length,
      lessonsCompleted: rows.filter((r) => r.lessonCompleted).length,
    },
  });
});

module.exports = { getLesson, getLessonStream, completeLesson, listLessons, nextTopic };
Object.assign(module.exports, { getLesson, getLessonStream, completeLesson, listLessons, nextTopic });
