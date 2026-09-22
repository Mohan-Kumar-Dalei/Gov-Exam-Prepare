const asyncHandler = require('../utils/asyncHandler.js');
const ApiError = require('../utils/ApiError.js');
const { ok, created } = require('../utils/apiResponse.js');
const { TestSession, Question, User } = require('../models/index.js');
const { loadOwnedExam } = require('./exam.controller.js');
const { buildAdaptivePlan, fetchOrGenerateQuestions, applyResponsesToProgress, warmQuestionBank, } = require('../services/adaptive.service.js');
const { generateMockBlueprint, analyzePerformance } = require('../services/ai.service.js');
const { parsePagination, buildMeta } = require('../utils/pagination.js');
const { normaliseLanguage } = require('../config/languages.js');
const { pct } = require('../utils/text.js');
const logger = require('../utils/logger.js');

/* ------------------------------------------------------------------ */
/* Start a quiz (PHASE 2 + PHASE 4)                                    */
/* ------------------------------------------------------------------ */

/** POST /api/tests/quiz */
const startQuiz = asyncHandler(async (req, res) => {
  const { examId, count, subjects, topics, difficulty, mode, durationMinutes } = req.body;
  const language = normaliseLanguage(req.body.language, req.user.preferences?.language);
  const exam = await loadOwnedExam(req.user._id, examId);

  const { plan, tier, weakTopics, avgAccuracy } = await buildAdaptivePlan({
    userId: req.user._id,
    exam,
    count,
    subjects,
    topics,
    difficulty,
  });

  if (!plan.length) throw ApiError.badRequest('No syllabus topics match that filter.');

  const questions = await fetchOrGenerateQuestions({
    userId: req.user._id,
    exam,
    plan,
    count,
    language,
  });

  if (!questions.length) {
    throw ApiError.upstream('Could not prepare any questions. Please try again in a moment.');
  }

  const duration = durationMinutes ?? Math.max(5, Math.ceil(questions.length * 1.2));

  const session = await TestSession.create({
    user: req.user._id,
    exam: exam._id,
    mode,
    title: topics.length
      ? `${topics[0]}${topics.length > 1 ? ` +${topics.length - 1}` : ''} quiz`
      : `${exam.examName} — ${mode} set`,
    subjects,
    topics,
    difficulty,
    questions: questions.map((q) => q._id),
    totalQuestions: questions.length,
    maxScore: questions.reduce((s, q) => s + (q.marks || 1), 0),
    durationMinutes: duration,
    expiresAt: new Date(Date.now() + (duration + 10) * 60000),
  });

  await Question.updateMany({ _id: { $in: session.questions } }, { $inc: { timesServed: 1 } });

  // Restock while the learner answers, so the next quiz needs no model call.
  warmQuestionBank({ userId: req.user._id, exam, language });

  return created(
    res,
    {
      session: {
        id: session._id,
        mode: session.mode,
        title: session.title,
        totalQuestions: session.totalQuestions,
        durationMinutes: session.durationMinutes,
        expiresAt: session.expiresAt,
      },
      questions: questions.map((q) => q.toClient()),
      adaptive: { tier, avgAccuracy, weakTopics, plan },
    },
    'Quiz ready.',
  );
});

/* ------------------------------------------------------------------ */
/* Start a full mock (PHASE 6)                                         */
/* ------------------------------------------------------------------ */

/** POST /api/tests/mock */
const startMock = asyncHandler(async (req, res) => {
  const { examId, maxQuestions } = req.body;
  const language = normaliseLanguage(req.body.language, req.user.preferences?.language);
  const exam = await loadOwnedExam(req.user._id, examId);

  // The blueprint depends only on the pattern and syllabus, so it is generated
  // once per exam and reused — this removes a model call from every mock.
  let blueprint = exam.mockBlueprint;
  if (!blueprint) {
    blueprint = await generateMockBlueprint({
      examName: exam.examName,
      examPattern: exam.examPattern,
      syllabus: exam.syllabus,
    });
    exam.mockBlueprint = blueprint;
    await exam.save();
  } else {
    logger.info(`Reusing cached mock blueprint for exam ${exam._id}`);
  }

  const cap = maxQuestions || Math.min(blueprint.totalQuestions || 100, 100);

  // Flatten the blueprint into the same plan shape the quiz path uses, then
  // scale it down proportionally if the blueprint exceeds the cap.
  const rawPlan = blueprint.sections.flatMap((s) =>
    (s.topicPlan || []).map((t) => ({
      subject: s.subject || s.section,
      topic: t.topic,
      difficulty: t.difficulty,
      count: Math.max(1, t.count),
    })),
  );

  const planTotal = rawPlan.reduce((sum, p) => sum + p.count, 0) || 1;
  const scale = planTotal > cap ? cap / planTotal : 1;
  const plan = rawPlan
    .map((p) => ({ ...p, count: Math.max(1, Math.round(p.count * scale)) }))
    .filter((p) => p.topic);

  if (!plan.length) throw ApiError.upstream('The AI returned an empty mock blueprint.');

  const questions = await fetchOrGenerateQuestions({
    userId: req.user._id,
    exam,
    plan,
    count: cap,
    language,
  });

  if (!questions.length) throw ApiError.upstream('Could not prepare the mock test. Please retry.');

  const duration = blueprint.durationMinutes || exam.examPattern?.durationMinutes || 90;
  const negative = blueprint.negativeMarking ?? exam.examPattern?.negativeMarking ?? 0;

  const session = await TestSession.create({
    user: req.user._id,
    exam: exam._id,
    mode: 'mock',
    title: blueprint.title,
    subjects: [...new Set(plan.map((p) => p.subject))],
    difficulty: 'mixed',
    questions: questions.map((q) => q._id),
    totalQuestions: questions.length,
    maxScore: questions.reduce((s, q) => s + (q.marks || 1), 0),
    negativeMarking: negative,
    durationMinutes: duration,
    expiresAt: new Date(Date.now() + (duration + 10) * 60000),
  });

  await Question.updateMany({ _id: { $in: session.questions } }, { $inc: { timesServed: 1 } });

  return created(
    res,
    {
      session: {
        id: session._id,
        mode: 'mock',
        title: session.title,
        totalQuestions: session.totalQuestions,
        durationMinutes: duration,
        negativeMarking: negative,
        expiresAt: session.expiresAt,
      },
      blueprint,
      questions: questions.map((q) => q.toClient()),
    },
    'Mock test ready.',
  );
});

/* ------------------------------------------------------------------ */
/* Read / resume                                                       */
/* ------------------------------------------------------------------ */

/** GET /api/tests/:id — answers are withheld until the session is submitted. */
const getSession = asyncHandler(async (req, res) => {
  const session = await TestSession.findOne({ _id: req.params.id, user: req.user._id }).populate(
    'questions',
  );
  if (!session) throw ApiError.notFound('Test session not found.');

  const submitted = session.status === 'submitted';

  return ok(res, {
    session: {
      id: session._id,
      exam: session.exam,
      mode: session.mode,
      title: session.title,
      status: session.status,
      totalQuestions: session.totalQuestions,
      durationMinutes: session.durationMinutes,
      negativeMarking: session.negativeMarking,
      startedAt: session.startedAt,
      expiresAt: session.expiresAt,
      submittedAt: session.submittedAt,
      ...(submitted
        ? {
            score: session.score,
            maxScore: session.maxScore,
            accuracy: session.accuracy,
            correct: session.correct,
            wrong: session.wrong,
            skipped: session.skipped,
            topicPerformance: session.topicPerformance,
            aiFeedback: session.aiFeedback,
            responses: session.responses,
          }
        : {}),
    },
    questions: session.questions.map((q) => q.toClient({ withAnswer: submitted })),
  });
});

/** GET /api/tests */
const listSessions = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const filter = {
    user: req.user._id,
    ...(req.query.examId ? { exam: req.query.examId } : {}),
    ...(req.query.mode ? { mode: req.query.mode } : {}),
    ...(req.query.status ? { status: req.query.status } : {}),
  };

  const [items, total] = await Promise.all([
    TestSession.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select('mode title status totalQuestions attempted correct wrong score maxScore accuracy startedAt submittedAt timeTakenSec')
      .lean(),
    TestSession.countDocuments(filter),
  ]);

  return ok(res, items, 'OK', buildMeta(total, page, limit));
});

/* ------------------------------------------------------------------ */
/* Submit + score (PHASE 3)                                            */
/* ------------------------------------------------------------------ */

/** POST /api/tests/:id/submit */
const submitSession = asyncHandler(async (req, res) => {
  const { responses, timeTakenSec, requestAiFeedback } = req.body;

  const session = await TestSession.findOne({ _id: req.params.id, user: req.user._id }).populate(
    'questions',
  );
  if (!session) throw ApiError.notFound('Test session not found.');
  if (session.status === 'submitted') throw ApiError.conflict('This test has already been submitted.');

  const questionById = new Map(session.questions.map((q) => [String(q._id), q]));
  const seen = new Set();
  const scored = [];

  for (const r of responses) {
    const q = questionById.get(String(r.questionId));
    if (!q || seen.has(String(r.questionId))) continue; // ignore foreign or duplicated ids
    seen.add(String(r.questionId));

    const isSkipped = r.selectedIndex === null || r.selectedIndex === undefined;
    const isCorrect = !isSkipped && r.selectedIndex === q.answerIndex;
    const marks = q.marks || 1;
    const marksAwarded = isSkipped ? 0 : isCorrect ? marks : -(session.negativeMarking || 0) * marks;

    scored.push({
      question: q._id,
      subject: q.subject,
      topic: q.topic,
      difficulty: q.difficulty,
      selectedIndex: isSkipped ? null : r.selectedIndex,
      correctIndex: q.answerIndex,
      isCorrect,
      isSkipped,
      timeSpentSec: r.timeSpentSec || 0,
      marksAwarded: Math.round(marksAwarded * 100) / 100,
    });
  }

  // Questions the learner never sent back count as skipped.
  for (const q of session.questions) {
    if (seen.has(String(q._id))) continue;
    scored.push({
      question: q._id,
      subject: q.subject,
      topic: q.topic,
      difficulty: q.difficulty,
      selectedIndex: null,
      correctIndex: q.answerIndex,
      isCorrect: false,
      isSkipped: true,
      timeSpentSec: 0,
      marksAwarded: 0,
    });
  }

  const correct = scored.filter((r) => r.isCorrect).length;
  const skipped = scored.filter((r) => r.isSkipped).length;
  const attempted = scored.length - skipped;
  const wrong = attempted - correct;
  const score = Math.round(scored.reduce((s, r) => s + r.marksAwarded, 0) * 100) / 100;

  // Per-topic roll-up for the results screen.
  const topicMap = new Map();
  for (const r of scored) {
    if (r.isSkipped) continue;
    const key = `${r.subject}::${r.topic}`;
    const row = topicMap.get(key) || { subject: r.subject, topic: r.topic, total: 0, correct: 0 };
    row.total += 1;
    if (r.isCorrect) row.correct += 1;
    topicMap.set(key, row);
  }
  const topicPerformance = [...topicMap.values()].map((t) => ({
    ...t,
    accuracy: pct(t.correct, t.total),
  }));

  session.set({
    responses: scored,
    attempted,
    correct,
    wrong,
    skipped,
    score: Math.max(0, score),
    accuracy: pct(correct, attempted),
    timeTakenSec: timeTakenSec || scored.reduce((s, r) => s + r.timeSpentSec, 0),
    topicPerformance,
    status: 'submitted',
    submittedAt: new Date(),
  });

  // Fan-out: adaptive memory, question stats, user counters, streak.
  await applyResponsesToProgress({
    userId: req.user._id,
    examId: session.exam,
    responses: scored,
  });

  const questionStatOps = scored
    .filter((r) => !r.isSkipped)
    .map((r) => ({
      updateOne: {
        filter: { _id: r.question },
        update: { $inc: r.isCorrect ? { timesCorrect: 1 } : { timesWrong: 1 } },
      },
    }));

  await Promise.all([
    // bulkWrite rejects an empty op list, and an all-skipped test is legitimate.
    questionStatOps.length
      ? Question.bulkWrite(questionStatOps, { ordered: false }).catch(() => {})
      : Promise.resolve(),
    User.updateOne(
      { _id: req.user._id },
      {
        $inc: {
          'stats.totalQuestions': attempted,
          'stats.totalCorrect': correct,
          'stats.totalTests': 1,
          'stats.totalStudyMinutes': Math.round((session.timeTakenSec || 0) / 60),
        },
      },
    ),
  ]);

  if (req.user.touchStreak()) await req.user.save();

  // The learner is about to read their result — a good moment to restock.
  loadOwnedExam(req.user._id, session.exam)
    .then((exam) =>
      warmQuestionBank({
        userId: req.user._id,
        exam,
        language: req.user.preferences?.language || 'en',
      }),
    )
    .catch(() => {});

  // AI feedback is a nicety: a failure here must not lose a submitted test.
  if (requestAiFeedback) {
    try {
      const feedback = await analyzePerformance({
        exam: session.title,
        score,
        maxScore: session.maxScore,
        correct,
        wrong,
        skipped,
        accuracy: session.accuracy,
        avgSecondsPerQuestion: attempted
          ? Math.round((session.timeTakenSec || 0) / attempted)
          : 0,
        topicPerformance,
        difficultyBreakdown: ['easy', 'medium', 'hard'].map((d) => {
          const rows = scored.filter((r) => r.difficulty === d && !r.isSkipped);
          return { difficulty: d, total: rows.length, correct: rows.filter((r) => r.isCorrect).length };
        }),
      }, req.user.preferences?.language || 'en');

      session.aiFeedback = {
        summary: feedback.summary,
        strongTopics: feedback.strongTopics,
        weakTopics: feedback.weakTopics,
        confidenceLevel: feedback.confidenceLevel,
        nextSteps: feedback.nextSteps,
      };
    } catch (err) {
      logger.error('AI feedback failed', err.message);
    }
  }

  await session.save();

  return ok(
    res,
    {
      result: {
        id: session._id,
        score: session.score,
        maxScore: session.maxScore,
        accuracy: session.accuracy,
        correct,
        wrong,
        skipped,
        attempted,
        timeTakenSec: session.timeTakenSec,
        topicPerformance,
        aiFeedback: session.aiFeedback,
      },
      review: scored.map((r) => {
        const q = questionById.get(String(r.question));
        return {
          questionId: r.question,
          question: q.question,
          options: q.options,
          correctIndex: r.correctIndex,
          selectedIndex: r.selectedIndex,
          isCorrect: r.isCorrect,
          isSkipped: r.isSkipped,
          explanation: q.explanation,
          topic: r.topic,
          subject: r.subject,
          difficulty: r.difficulty,
        };
      }),
      streak: req.user.streak,
    },
    'Test submitted.',
  );
});

/** DELETE /api/tests/:id — abandon an unfinished attempt. */
const abandonSession = asyncHandler(async (req, res) => {
  const session = await TestSession.findOne({ _id: req.params.id, user: req.user._id });
  if (!session) throw ApiError.notFound('Test session not found.');
  if (session.status === 'submitted') throw ApiError.conflict('Submitted tests cannot be abandoned.');

  session.status = 'abandoned';
  await session.save();
  return ok(res, null, 'Test abandoned.');
});

module.exports = { startQuiz, startMock, getSession, listSessions, submitSession, abandonSession };
Object.assign(module.exports, { startQuiz, startMock, getSession, listSessions, submitSession, abandonSession });
