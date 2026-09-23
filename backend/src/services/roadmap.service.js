const { Roadmap, Progress } = require('../models/index.js');
const { generateRoadmap } = require('./ai.service.js');
const { ROADMAP_DAYS } = require('../config/constants.js');
const logger = require('../utils/logger.js');

/** Creates the untouched Progress row for every syllabus topic, once. */
async function seedProgress(userId, exam) {
  const topics = exam.flatTopics();
  if (!topics.length) return 0;

  const ops = topics.map((t) => ({
    updateOne: {
      filter: { user: userId, exam: exam._id, subject: t.subject, topic: t.topic },
      update: {
        $setOnInsert: {
          user: userId,
          exam: exam._id,
          subject: t.subject,
          topic: t.topic,
          level: 'untouched',
        },
      },
      upsert: true,
    },
  }));

  const result = await Progress.bulkWrite(ops, { ordered: false });
  return result.upsertedCount || 0;
}

/**
 * The model occasionally returns fewer than `days` entries for long plans.
 * Rather than fail, we cycle the syllabus deterministically to fill the gaps so
 * the learner always gets a complete plan.
 */
function fillMissingDays({ days, generated, dailyMinutes, flatTopics }) {
  const byDay = new Map(generated.map((d) => [d.day, d]));
  const out = [];

  for (let day = 1; day <= days; day += 1) {
    const existing = byDay.get(day);
    if (existing) {
      out.push(existing);
      continue;
    }

    const isRevisionPhase = day > days - 10;
    const study = isRevisionPhase
      ? []
      : [0, 1].map((offset) => {
          const t = flatTopics[(day * 2 + offset) % flatTopics.length];
          return { subject: t.subject, topic: t.topic, minutes: Math.round(dailyMinutes / 2) };
        });

    const revise = [0, 1].map((offset) => {
      const t = flatTopics[(day * 3 + offset) % flatTopics.length];
      return { subject: t.subject, topic: t.topic };
    });

    out.push({
      day,
      phase: isRevisionPhase ? 'Final Revision' : 'Syllabus Coverage',
      focusSubject: (study[0] || revise[0]).subject,
      studyTopics: study,
      revisionTopics: revise,
      quizCount: 20,
      mockTest: day % 7 === 0 || isRevisionPhase,
      targetMinutes: dailyMinutes,
      notes: isRevisionPhase ? 'Revise and attempt a full mock.' : 'Cover the topics, then quiz yourself.',
    });
  }

  return out;
}

/**
 * Builds (or rebuilds) the active roadmap for a user + exam.
 * Weak topics from live Progress are fed in so a regenerated plan re-weights itself.
 */
/**
 * Rewrites the planner's topic labels to the syllabus ones they refer to.
 *
 * The planner is given the syllabus but writes its own labels, and a label
 * that drifts even slightly becomes a day the learner cannot open. Snapping
 * here keeps the roadmap pointing at topics that actually exist; a label that
 * matches nothing is kept as-is rather than dropped, so the plan stays whole
 * and the lesson endpoint decides what to do with it.
 */
function snapDayTopics(day, exam) {
  const snap = (t) => {
    const match = exam.resolveTopic?.(t.subject, t.topic);
    return match ? { ...t, subject: match.entry.subject, topic: match.entry.topic } : t;
  };
  return {
    ...day,
    studyTopics: (day.studyTopics || []).map(snap),
    revisionTopics: (day.revisionTopics || []).map(snap),
  };
}

async function buildRoadmap({
  userId,
  exam,
  days = ROADMAP_DAYS,
  dailyMinutes = 120,
  startDate = new Date(),
}) {
  const flatTopics = exam.flatTopics();
  if (!flatTopics.length) {
    throw new Error('This exam has no syllabus topics to build a roadmap from.');
  }

  const weakRows = await Progress.find({ user: userId, exam: exam._id, attempted: { $gt: 0 } })
    .sort({ mastery: 1 })
    .limit(10)
    .lean();

  const ai = await generateRoadmap({
    examName: exam.examName,
    syllabus: exam.syllabus,
    days,
    dailyMinutes,
    weakTopics: weakRows.map((r) => r.topic),
  });

  if (ai.days.length < days) {
    logger.warn(`Roadmap returned ${ai.days.length}/${days} days; filling the remainder`);
  }

  const start = new Date(startDate);
  const filled = fillMissingDays({ days, generated: ai.days, dailyMinutes, flatTopics })
    .map((d) => snapDayTopics(d, exam))
    .map((d) => ({
      ...d,
      date: new Date(start.getTime() + (d.day - 1) * 86400000),
    }));

  const existing = await Roadmap.findOne({ user: userId, exam: exam._id, isActive: true });

  if (existing) {
    // Preserve the learner's completion history across a regeneration.
    const doneByDay = new Map(
      existing.days.filter((d) => d.completed).map((d) => [d.day, d]),
    );
    filled.forEach((d) => {
      const prior = doneByDay.get(d.day);
      if (prior) {
        d.completed = true;
        d.completedAt = prior.completedAt;
        d.actualMinutes = prior.actualMinutes;
      }
    });

    existing.set({
      totalDays: days,
      startDate: start,
      endDate: new Date(start.getTime() + (days - 1) * 86400000),
      dailyMinutes,
      strategy: ai.strategy,
      phases: ai.phases,
      days: filled,
      version: (existing.version || 1) + 1,
      regeneratedAt: new Date(),
    });
    await existing.save();
    return existing;
  }

  return Roadmap.create({
    user: userId,
    exam: exam._id,
    title: `${days}-Day Plan — ${exam.examName}`,
    totalDays: days,
    startDate: start,
    endDate: new Date(start.getTime() + (days - 1) * 86400000),
    dailyMinutes,
    strategy: ai.strategy,
    phases: ai.phases,
    days: filled,
  });
}

module.exports = { seedProgress, buildRoadmap };
Object.assign(module.exports, { seedProgress, buildRoadmap });
