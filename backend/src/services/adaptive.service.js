const { Question, Progress, TestSession } = require('../models/index.js');
const { generateQuestions } = require('./ai.service.js');
const { fingerprint, shuffle, topicKey } = require('../utils/text.js');
const { ADAPTIVE_WEIGHTS } = require('../config/constants.js');
const logger = require('../utils/logger.js');

/**
 * PHASE 4 — the adaptive core.
 *
 * Weakness severity decides how much of the next batch is spent on weak topics:
 *   accuracy < 40%  ->  80% weak / 20% mixed
 *   accuracy < 55%  ->  70% weak / 30% mixed
 *   accuracy < 70%  ->  50% weak / 50% mixed
 *   otherwise       ->  30% weak / 70% breadth
 */
function weaknessTier(avgAccuracy) {
  if (avgAccuracy < 40) return 'critical';
  if (avgAccuracy < 55) return 'weak';
  if (avgAccuracy < 70) return 'moderate';
  return 'balanced';
}

/** Difficulty ladder: struggling learners get easier questions, strong ones get harder. */
function difficultyFor(progressRow) {
  if (!progressRow || progressRow.attempted < 3) return 'easy';
  if (progressRow.accuracy < 45) return 'easy';
  if (progressRow.accuracy < 75) return 'medium';
  return 'hard';
}

/**
 * Builds the per-topic question distribution for the next batch.
 *
 * @returns {Promise<{ plan: Array, tier: string, weakTopics: Array, avgAccuracy: number }>}
 */
async function buildAdaptivePlan({
  userId,
  exam,
  count = 10,
  subjects = [],
  topics = [],
  difficulty = 'adaptive',
}) {
  const allTopics = exam.flatTopics();

  // The caller's labels may come from the roadmap or a question tag rather
  // than the syllabus itself, so they are resolved to canonical labels before
  // filtering. Matching the raw strings used to empty the pool and surface as
  // "No syllabus topics match that filter" on a topic the learner could see.
  // Subjects are compared on the normalised label only: there is no subject
  // resolver, and a topic resolver would be the wrong tool for a heading.
  const wantSubjects = new Set(subjects.map(topicKey));
  const wantTopics = new Set(
    topics.map((x) => topicKey(exam.resolveTopic?.(null, x)?.entry.topic ?? x)),
  );

  const pool = allTopics.filter((t) => {
    if (wantSubjects.size && !wantSubjects.has(topicKey(t.subject))) return false;
    if (wantTopics.size && !wantTopics.has(topicKey(t.topic))) return false;
    return true;
  });

  const candidates = pool.length ? pool : allTopics;
  if (!candidates.length) return { plan: [], tier: 'balanced', weakTopics: [], avgAccuracy: 0 };

  const progressRows = await Progress.find({ user: userId, exam: exam._id }).lean();
  const byKey = new Map(progressRows.map((p) => [`${p.subject}::${p.topic}`, p]));

  const attempted = progressRows.filter((p) => p.attempted > 0);
  const avgAccuracy = attempted.length
    ? attempted.reduce((s, p) => s + p.accuracy, 0) / attempted.length
    : 100; // no history yet -> treat as balanced breadth

  const tier = weaknessTier(avgAccuracy);
  const weakShare = ADAPTIVE_WEIGHTS[tier];

  const scored = candidates.map((t) => {
    const row = byKey.get(`${t.subject}::${t.topic}`);
    const importanceBoost = t.importance === 'high' ? 12 : t.importance === 'low' ? -6 : 0;
    // Untouched topics rank mid-high so breadth still happens; mistakes push a topic up hard.
    const weakness = row
      ? 100 - row.accuracy + Math.min(30, (row.mistakeCount || 0) * 4)
      : 55;
    return { ...t, row, score: weakness + importanceBoost };
  });

  const ranked = [...scored].sort((a, b) => b.score - a.score);
  const weakPool = ranked.filter((t) => !t.row || t.row.accuracy < 70);
  const restPool = ranked.filter((t) => t.row && t.row.accuracy >= 70);

  const weakCount = Math.min(count, Math.round(count * weakShare));
  const restCount = count - weakCount;

  const pick = (source, n) => {
    if (!source.length || n <= 0) return [];
    const out = [];
    for (let i = 0; i < n; i += 1) out.push(source[i % source.length]);
    return out;
  };

  const selection = [
    ...pick(weakPool.length ? weakPool : ranked, weakCount),
    ...pick(restPool.length ? restPool : shuffle(ranked), restCount),
  ];

  // Collapse duplicates into counts so the prompt asks for "3 of X" rather than X three times.
  const grouped = new Map();
  for (const item of selection) {
    const diff = difficulty === 'adaptive' ? difficultyFor(item.row) : difficulty;
    const key = `${item.subject}::${item.topic}::${diff}`;
    const existing = grouped.get(key);
    if (existing) existing.count += 1;
    else {
      grouped.set(key, {
        subject: item.subject,
        topic: item.topic,
        difficulty: diff,
        count: 1,
        subtopics: item.subtopics,
      });
    }
  }

  return {
    plan: [...grouped.values()],
    tier,
    avgAccuracy: Math.round(avgAccuracy * 10) / 10,
    weakTopics: weakPool.slice(0, 8).map((t) => ({ subject: t.subject, topic: t.topic, score: Math.round(t.score) })),
  };
}

/**
 * Questions per generation call. Smaller chunks run concurrently and finish
 * sooner than one long response; too small and the per-call overhead dominates.
 */
const QUESTIONS_PER_CALL = 5;

/** Splits a plan into chunks of at most `size` questions, without splitting topics badly. */
function chunkPlan(plan, size = QUESTIONS_PER_CALL) {
  const chunks = [];
  let current = [];
  let running = 0;

  for (const slot of plan) {
    let remaining = slot.count;
    while (remaining > 0) {
      const take = Math.min(remaining, size - running);
      current.push({ ...slot, count: take });
      running += take;
      remaining -= take;

      if (running >= size) {
        chunks.push(current);
        current = [];
        running = 0;
      }
    }
  }

  if (current.length) chunks.push(current);
  return chunks;
}

/** Question ids this learner has already been served, so nothing repeats. */
async function seenQuestionIds(userId, examId) {
  const sessions = await TestSession.find({ user: userId, exam: examId })
    .select('questions')
    .lean();
  return new Set(sessions.flatMap((s) => (s.questions || []).map(String)));
}

/**
 * Returns `count` questions for the plan, reusing unseen questions already in the
 * bank before asking Gemini for the remainder. Newly generated questions are
 * persisted with a unique fingerprint so they are never generated twice.
 */
async function fetchOrGenerateQuestions({ userId, exam, plan, count, language = 'en' }) {
  if (!plan.length) return [];

  const seen = await seenQuestionIds(userId, exam._id);
  const collected = [];

  // 1. Reuse from the bank.
  for (const slot of plan) {
    const banked = await Question.find({
      user: userId,
      exam: exam._id,
      topic: slot.topic,
      difficulty: slot.difficulty,
      language,
      flagged: false,
    })
      .limit(slot.count * 3)
      .exec();

    const usable = banked.filter((q) => !seen.has(String(q._id))).slice(0, slot.count);
    usable.forEach((q) => {
      seen.add(String(q._id));
      collected.push(q);
    });
    slot.remaining = slot.count - usable.length;
  }

  const shortfall = plan.reduce((s, p) => s + (p.remaining || 0), 0);
  if (shortfall <= 0) return shuffle(collected).slice(0, count);

  // 2. Generate the rest, telling the model exactly what it may not repeat.
  const askedQuestions = await Question.find({ user: userId, exam: exam._id, language })
    .select('question')
    .sort({ createdAt: -1 })
    .limit(120)
    .lean();

  const generationPlan = plan
    .filter((p) => (p.remaining || 0) > 0)
    .map((p) => ({ subject: p.subject, topic: p.topic, difficulty: p.difficulty, count: p.remaining }));

  const examPatternText = exam.examPattern
    ? `${exam.examPattern.totalQuestions} questions, ${exam.examPattern.durationMinutes} minutes, negative marking ${exam.examPattern.negativeMarking}`
    : '';
  const asked = askedQuestions.map((q) => q.question);

  // Generation time scales with output length, so a large batch is split into
  // concurrent chunks. Each chunk still sees the full do-not-repeat list.
  const chunks = chunkPlan(generationPlan, QUESTIONS_PER_CALL);

  let generated = [];
  try {
    const results = await Promise.allSettled(
      chunks.map((chunkedPlan) =>
        generateQuestions({
          examName: exam.examName,
          organization: exam.organization,
          language,
          examPattern: examPatternText,
          plan: chunkedPlan,
          count: chunkedPlan.reduce((s, p) => s + p.count, 0),
          askedQuestions: asked,
        }),
      ),
    );

    generated = results.filter((r) => r.status === 'fulfilled').flatMap((r) => r.value);

    const failed = results.filter((r) => r.status === 'rejected');
    if (failed.length) {
      logger.warn(`${failed.length}/${chunks.length} question chunks failed: ${failed[0].reason?.message}`);
      // Every chunk failing is a real outage, not a partial hiccup.
      if (failed.length === chunks.length && !collected.length) throw failed[0].reason;
    }
  } catch (err) {
    logger.error('Question generation failed', err.message);
    if (!collected.length) throw err;
    return shuffle(collected).slice(0, count);
  }

  const existingPrints = new Set(
    (
      await Question.find({ user: userId, exam: exam._id, language }).select('fingerprint').lean()
    ).map((q) => q.fingerprint),
  );

  const docs = [];
  for (const q of generated) {
    const fp = fingerprint(q.question);
    if (!fp || existingPrints.has(fp)) continue; // dedupe within and across batches
    existingPrints.add(fp);

    // The generator writes its own topic labels. Snapping them to the syllabus
    // keeps a question's "Revise this topic" link pointing somewhere real, and
    // keeps its Progress row merged with the rest of that topic's history
    // instead of splitting it across two spellings.
    const rawSubject = q.subject || plan[0].subject;
    // Optional call: a lean exam has no methods, and question warming is
    // fire-and-forget, so a TypeError here would vanish silently.
    const match = exam.resolveTopic?.(rawSubject, q.topic);

    docs.push({
      user: userId,
      exam: exam._id,
      subject: match ? match.entry.subject : rawSubject,
      topic: match ? match.entry.topic : q.topic,
      question: q.question,
      options: q.options,
      answerIndex: q.answerIndex,
      answer: q.answer,
      explanation: q.explanation,
      difficulty: q.difficulty,
      type: q.type,
      fingerprint: fp,
      language,
      sourceBasis: q.sourceBasis,
      factualConfidence: q.factualConfidence,
      grounded: q.grounded,
      groundingSources: q.groundingSources || [],
      source: 'ai',
    });
  }

  if (docs.length) {
    try {
      const saved = await Question.insertMany(docs, { ordered: false });
      collected.push(...saved);
    } catch (err) {
      // A racing insert can trip the unique index; keep whatever landed.
      if (err.insertedDocs?.length) collected.push(...err.insertedDocs);
      else logger.error('Question insert failed', err.message);
    }
  }

  return shuffle(collected).slice(0, count);
}

/**
 * Applies one submitted session to the learner's Progress rows.
 * This is what makes future batches adapt.
 */
async function applyResponsesToProgress({ userId, examId, responses }) {
  const byTopic = new Map();

  for (const r of responses) {
    const key = `${r.subject}::${r.topic}`;
    const agg = byTopic.get(key) || {
      subject: r.subject,
      topic: r.topic,
      attempted: 0,
      correct: 0,
      wrong: 0,
      timeSec: 0,
      lastCorrect: true,
    };
    if (!r.isSkipped) {
      agg.attempted += 1;
      if (r.isCorrect) agg.correct += 1;
      else agg.wrong += 1;
      agg.lastCorrect = r.isCorrect;
    }
    agg.timeSec += r.timeSpentSec || 0;
    byTopic.set(key, agg);
  }

  const updated = [];
  for (const agg of byTopic.values()) {
    if (!agg.attempted) continue;

    const row =
      (await Progress.findOne({
        user: userId,
        exam: examId,
        subject: agg.subject,
        topic: agg.topic,
      })) ||
      new Progress({ user: userId, exam: examId, subject: agg.subject, topic: agg.topic });

    row.attempted += agg.attempted;
    row.correct += agg.correct;
    row.wrong += agg.wrong;
    row.mistakeCount += agg.wrong;
    row.streak = agg.lastCorrect ? row.streak + agg.correct : 0;
    row.totalTimeSec += agg.timeSec;
    row.avgTimeSec = row.attempted ? Math.round(row.totalTimeSec / row.attempted) : 0;
    row.lastAttemptedAt = new Date();
    row.recompute();

    await row.save();
    updated.push(row);
  }

  return updated;
}

/** Target number of unseen questions to keep banked per learner+exam+language. */
const WARM_BANK_TARGET = 30;

/** One warm-up per (user, exam, language) at a time — duplicates would waste quota. */
const warming = new Set();

/**
 * Tops up the question bank in the background.
 *
 * The bank is checked before any generation happens, so keeping it stocked is
 * what makes a quiz start instantly: the common case becomes a database read
 * rather than a model call. Fired after a quiz starts and after one is
 * submitted, when the learner is busy and latency is free.
 *
 * Never throws — the learner's request must not depend on this.
 */
async function warmQuestionBank({ userId, exam, language = 'en', target = WARM_BANK_TARGET }) {
  const key = `${userId}:${exam._id}:${language}`;
  if (warming.has(key)) return 0;
  warming.add(key);

  try {
    const seen = await seenQuestionIds(userId, exam._id);
    const banked = await Question.find({ user: userId, exam: exam._id, language, flagged: false })
      .select('_id')
      .lean();

    const unseen = banked.filter((q) => !seen.has(String(q._id))).length;
    const shortfall = target - unseen;
    if (shortfall <= 0) return 0;

    const { plan } = await buildAdaptivePlan({
      userId,
      exam,
      count: Math.min(shortfall, 20),
      difficulty: 'adaptive',
    });
    if (!plan.length) return 0;

    const before = await Question.countDocuments({ user: userId, exam: exam._id, language });
    await fetchOrGenerateQuestions({ userId, exam, plan, count: plan.length, language });
    const after = await Question.countDocuments({ user: userId, exam: exam._id, language });

    const added = after - before;
    if (added > 0) logger.info(`Warmed question bank: +${added} (${language}) for exam ${exam._id}`);
    return added;
  } catch (err) {
    logger.warn(`Question bank warm-up skipped: ${err.message}`);
    return 0;
  } finally {
    warming.delete(key);
  }
}

module.exports = {
  buildAdaptivePlan,
  fetchOrGenerateQuestions,
  applyResponsesToProgress,
  warmQuestionBank,
  chunkPlan,
  weaknessTier,
};
Object.assign(module.exports, { weaknessTier, buildAdaptivePlan, chunkPlan, fetchOrGenerateQuestions, applyResponsesToProgress, warmQuestionBank });
