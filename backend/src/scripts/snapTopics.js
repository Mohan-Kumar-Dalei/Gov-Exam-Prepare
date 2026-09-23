/**
 * Rewrites stored topic labels to the syllabus labels they refer to.
 *
 *   npm run snap-topics             # dry run — reports, changes nothing
 *   npm run snap-topics -- --apply  # writes, after saving a backup
 *
 * Topic labels used to be written by three separate authors — the notification
 * analyser, the roadmap planner and the question generator — and nothing
 * reconciled them. Exam.resolveTopic now does that at read time, and new
 * labels are snapped as they are written, so this script is only for rows that
 * were stored before both. It is a one-off, not part of any request path.
 *
 * Safety, because this rewrites real learner data:
 *   - Dry run is the default. Nothing is written without --apply.
 *   - MONGO_URI must be set explicitly. The app's connectDB falls back to a
 *     local database when it is missing, which is exactly how a migration ends
 *     up rewriting the wrong data; here a missing URI is a hard stop.
 *   - Every document this script would modify or remove is written to a
 *     timestamped JSON backup before anything changes.
 *   - The only deletion is a Progress row whose history has been merged into
 *     its canonical twin. Nothing else is ever removed.
 */
const fs = require('node:fs');
const path = require('node:path');
const { loadEnv } = require('../config/loadEnv.js');

const envFile = loadEnv();

const mongoose = require('mongoose');
const { Exam, Question, Roadmap, Lesson, Progress } = require('../models/index.js');
const logger = require('../utils/logger.js');

const APPLY = process.argv.includes('--apply');

/** Documents captured before modification, written out as one JSON file. */
const backup = [];
const keep = (model, doc) => backup.push({ model, doc: doc.toObject ? doc.toObject() : doc });

const summary = {
  questions: 0,
  roadmapDays: 0,
  lessons: 0,
  lessonConflicts: 0,
  progress: 0,
  progressMerged: 0,
};

/** Canonical label for a stored pair, or null when it is already correct. */
function drift(exam, subject, topic) {
  const match = exam.resolveTopic(subject, topic);
  if (!match || match.matchedBy === 'exact') return null;
  return { subject: match.entry.subject, topic: match.entry.topic, how: match.matchedBy };
}

async function snapQuestions(exam) {
  // A question's unique index is on its fingerprint, not its topic, so
  // relabelling one can never collide with another.
  const rows = await Question.find({ exam: exam._id });
  for (const q of rows) {
    const to = drift(exam, q.subject, q.topic);
    if (!to) continue;

    logger.info(`  question  "${q.subject} / ${q.topic}" -> "${to.subject} / ${to.topic}" (${to.how})`);
    summary.questions += 1;
    if (!APPLY) continue;

    keep('Question', q);
    q.subject = to.subject;
    q.topic = to.topic;
    await q.save();
  }
}

async function snapRoadmaps(exam) {
  const rows = await Roadmap.find({ exam: exam._id });
  for (const roadmap of rows) {
    let touched = 0;
    const original = roadmap.toObject();

    for (const day of roadmap.days || []) {
      for (const list of ['studyTopics', 'revisionTopics']) {
        for (const entry of day[list] || []) {
          const to = drift(exam, entry.subject, entry.topic);
          if (!to) continue;

          logger.info(
            `  day ${String(day.day).padStart(2)}   "${entry.subject} / ${entry.topic}" -> ` +
              `"${to.subject} / ${to.topic}" (${to.how})`,
          );
          touched += 1;
          if (!APPLY) continue;
          entry.subject = to.subject;
          entry.topic = to.topic;
        }
      }
    }

    summary.roadmapDays += touched;
    if (touched && APPLY) {
      keep('Roadmap', original);
      await roadmap.save();
    }
  }
}

async function snapLessons(exam) {
  // Lessons are unique per (user, exam, subject, topic, language). Where the
  // canonical lesson already exists, the drifted one is left untouched: it is
  // simply unreachable, and deleting a lesson the learner may have read is a
  // worse outcome than leaving a stale row behind.
  const rows = await Lesson.find({ exam: exam._id });
  for (const lesson of rows) {
    const to = drift(exam, lesson.subject, lesson.topic);
    if (!to) continue;

    const clash = await Lesson.exists({
      user: lesson.user,
      exam: exam._id,
      subject: to.subject,
      topic: to.topic,
      language: lesson.language,
    });

    if (clash) {
      logger.warn(
        `  lesson    "${lesson.subject} / ${lesson.topic}" already has a canonical twin — left as is`,
      );
      summary.lessonConflicts += 1;
      continue;
    }

    logger.info(`  lesson    "${lesson.subject} / ${lesson.topic}" -> "${to.subject} / ${to.topic}"`);
    summary.lessons += 1;
    if (!APPLY) continue;

    keep('Lesson', lesson);
    lesson.subject = to.subject;
    lesson.topic = to.topic;
    await lesson.save();
  }
}

async function snapProgress(exam) {
  // Progress is unique per (user, exam, subject, topic), so a drifted row and
  // its canonical twin are two halves of one topic's history. They are summed
  // rather than overwritten — the learner answered all of those questions.
  const rows = await Progress.find({ exam: exam._id });
  for (const row of rows) {
    const to = drift(exam, row.subject, row.topic);
    if (!to) continue;

    const twin = await Progress.findOne({
      user: row.user,
      exam: exam._id,
      subject: to.subject,
      topic: to.topic,
    });

    if (!twin) {
      logger.info(`  progress  "${row.subject} / ${row.topic}" -> "${to.subject} / ${to.topic}"`);
      summary.progress += 1;
      if (!APPLY) continue;

      keep('Progress', row);
      row.subject = to.subject;
      row.topic = to.topic;
      await row.save();
      continue;
    }

    logger.info(
      `  progress  merging "${row.subject} / ${row.topic}" (${row.attempted} attempted) into ` +
        `"${to.subject} / ${to.topic}" (${twin.attempted} attempted)`,
    );
    summary.progressMerged += 1;
    if (!APPLY) continue;

    keep('Progress', row);
    keep('Progress', twin);

    twin.attempted += row.attempted;
    twin.correct += row.correct;
    twin.wrong += row.wrong;
    twin.mistakeCount += row.mistakeCount;
    twin.totalTimeSec += row.totalTimeSec;
    twin.avgTimeSec = twin.attempted ? Math.round(twin.totalTimeSec / twin.attempted) : 0;
    // A streak is a run of recent correct answers; summing two separate runs
    // would invent one that never happened, so the longer is kept.
    twin.streak = Math.max(twin.streak, row.streak);
    twin.lessonCompleted = twin.lessonCompleted || row.lessonCompleted;
    if (row.lastAttemptedAt && (!twin.lastAttemptedAt || row.lastAttemptedAt > twin.lastAttemptedAt)) {
      twin.lastAttemptedAt = row.lastAttemptedAt;
    }
    twin.recompute();

    await twin.save();
    await Progress.deleteOne({ _id: row._id });
  }
}

async function run() {
  // The app's connectDB falls back to a local database when MONGO_URI is
  // missing. For a migration that is how you silently rewrite the wrong
  // database, so this script refuses to guess.
  const uri = process.env.MONGO_URI;
  if (!uri) {
    logger.error(
      'MONGO_URI is not set, so there is no way to know which database to migrate. ' +
        `Checked ${envFile || 'no .env file'}. Set it and run again — this script will not guess.`,
    );
    process.exit(1);
  }

  await mongoose.connect(uri, { autoIndex: false, serverSelectionTimeoutMS: 15000 });
  logger.info(`Connected to ${mongoose.connection.name} — ${APPLY ? 'APPLYING CHANGES' : 'DRY RUN'}`);

  const exams = await Exam.find({});
  logger.info(`Scanning ${exams.length} exam(s)\n`);

  for (const exam of exams) {
    logger.info(`${exam.examName} (${exam._id})`);
    await snapQuestions(exam);
    await snapRoadmaps(exam);
    await snapLessons(exam);
    await snapProgress(exam);
  }

  const total =
    summary.questions +
    summary.roadmapDays +
    summary.lessons +
    summary.progress +
    summary.progressMerged;

  logger.info('');
  logger.info(`questions relabelled : ${summary.questions}`);
  logger.info(`roadmap entries      : ${summary.roadmapDays}`);
  logger.info(`lessons relabelled   : ${summary.lessons}`);
  logger.info(`lessons left as is   : ${summary.lessonConflicts} (canonical twin already exists)`);
  logger.info(`progress relabelled  : ${summary.progress}`);
  logger.info(`progress merged      : ${summary.progressMerged}`);

  if (!APPLY) {
    logger.info('');
    logger.info(
      total
        ? `DRY RUN — nothing was written. Re-run with --apply to make these ${total} change(s).`
        : 'DRY RUN — nothing needs changing.',
    );
  } else if (backup.length) {
    const file = path.resolve(
      __dirname,
      '../../',
      `snap-topics-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
    );
    fs.writeFileSync(file, JSON.stringify(backup, null, 2));
    logger.info('');
    logger.info(`Applied ${total} change(s). Pre-change copies of ${backup.length} document(s): ${file}`);
  }

  await mongoose.connection.close();
}

run().catch(async (err) => {
  logger.error('snap-topics failed', err.message);
  // A backup is only useful if it survives the failure that made it matter.
  if (backup.length) {
    const file = path.resolve(__dirname, '../../', `snap-topics-backup-failed-${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify(backup, null, 2));
    logger.error(`Partial run — documents captured before the failure: ${file}`);
  }
  await mongoose.connection.close().catch(() => {});
  process.exit(1);
});
