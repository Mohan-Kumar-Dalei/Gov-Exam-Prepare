const asyncHandler = require('../utils/asyncHandler.js');
const ApiError = require('../utils/ApiError.js');
const { ok } = require('../utils/apiResponse.js');
const { Lesson, Progress, Roadmap, Question } = require('../models/index.js');
const { loadOwnedExam } = require('./exam.controller.js');
const { generateLesson, generateLessonStreamed } = require('../services/ai.service.js');
const logger = require('../utils/logger.js');
const { normaliseLanguage } = require('../config/languages.js');
const { warmQuestionBank } = require('../services/adaptive.service.js');

/**
 * The syllabus entry to teach, given whatever labels the caller had to hand.
 *
 * Topic strings arrive from three writers that never fully agree: the analyser
 * that read the syllabus, the planner that wrote the roadmap, and the
 * generator that tagged each question. An exact-match lookup turned every
 * disagreement into a 400 on "Revise this topic" — the app refusing to teach
 * something it had itself put in front of the learner.
 *
 * So a resolved topic is taught under its canonical label, which also keeps
 * lessons cached once instead of once per spelling. An unresolved topic is
 * still taught when the app surfaced it — it is on their roadmap, or it tags a
 * question they were actually asked. Only a label from nowhere is rejected.
 */
async function resolveStudyTopic({ exam, userId, subject, topic }) {
  const match = exam.resolveTopic(subject, topic);
  if (match) {
    if (match.matchedBy !== 'exact') {
      logger.info(
        `Topic "${subject} / ${topic}" resolved to ` +
          `"${match.entry.subject} / ${match.entry.topic}" by ${match.matchedBy}`,
      );
    }
    return { ...match.entry, offSyllabus: false };
  }

  const [onRoadmap, onQuestion] = await Promise.all([
    // Both halves of a roadmap day: the revision list is what the "Revise this
    // topic" link is built from, so checking only study topics would miss it.
    Roadmap.exists({
      user: userId,
      exam: exam._id,
      $or: [{ 'days.studyTopics.topic': topic }, { 'days.revisionTopics.topic': topic }],
    }),
    Question.exists({ user: userId, exam: exam._id, topic }),
  ]);

  if (onRoadmap || onQuestion) {
    logger.warn(
      `Teaching "${subject} / ${topic}", which is not in the extracted syllabus — ` +
        'the roadmap or question bank surfaced it, so the learner can reach it.',
    );
    return { subject, topic, importance: 'medium', subtopics: [], offSyllabus: true };
  }

  return null;
}

const unknownTopic = (subject, topic) =>
  ApiError.badRequest(
    `"${topic}" is not a topic in ${subject} for this exam, and nothing in your ` +
      'roadmap or question bank refers to it. Re-analyse the notification if the syllabus looks incomplete.',
  );

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

  const known = await resolveStudyTopic({ exam, userId: req.user._id, subject, topic });
  if (!known) throw unknownTopic(subject, topic);

  // Cache and teach under the canonical label, not the caller's spelling.
  const { subject: canonSubject, topic: canonTopic } = known;

  let lesson = await Lesson.findOne({
    user: req.user._id,
    exam: exam._id,
    subject: canonSubject,
    topic: canonTopic,
    language,
  });

  if (lesson && !refresh) {
    lesson.readCount += 1;
    await lesson.save();
    return ok(res, { lesson, cached: true });
  }

  const content = await generateLesson({
    examName: exam.examName,
    subject: canonSubject,
    topic: canonTopic,
    subtopics: known.subtopics,
    level,
    language,
  });

  // Upsert rather than create: two tabs (or React StrictMode's double effect)
  // can both miss the cache and race to insert, which used to trip the unique
  // index and surface as a confusing 409.
  lesson = await Lesson.findOneAndUpdate(
    { user: req.user._id, exam: exam._id, subject: canonSubject, topic: canonTopic, language },
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

  const known = await resolveStudyTopic({ exam, userId: req.user._id, subject, topic });
  if (!known) throw unknownTopic(subject, topic);

  const { subject: canonSubject, topic: canonTopic } = known;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  const cached = await Lesson.findOne({
    user: req.user._id,
    exam: exam._id,
    subject: canonSubject,
    topic: canonTopic,
    language,
  });

  if (cached && !refresh) {
    cached.readCount += 1;
    await cached.save();
    send('cached', { lesson: cached });
    send('done', { cached: true });
    return res.end();
  }

  send('start', { subject: canonSubject, topic: canonTopic, language });

  try {
    const content = await generateLessonStreamed({
      examName: exam.examName,
      subject: canonSubject,
      topic: canonTopic,
      subtopics: known.subtopics,
      level,
      language,
      onProse: (chunk) => send('prose', { text: chunk }),
    });

    const { structureFailed, structureError, ...fields } = content;

    const lesson = await Lesson.findOneAndUpdate(
      { user: req.user._id, exam: exam._id, subject: canonSubject, topic: canonTopic, language },
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
