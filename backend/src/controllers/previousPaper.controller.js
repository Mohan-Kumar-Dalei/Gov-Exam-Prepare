const asyncHandler = require('../utils/asyncHandler.js');
const ApiError = require('../utils/ApiError.js');
const { ok, created } = require('../utils/apiResponse.js');
const { PreviousPaper } = require('../models/index.js');
const { loadOwnedExam } = require('./exam.controller.js');
const { generatePreviousPaper } = require('../services/ai.service.js');
const { normaliseLanguage } = require('../config/languages.js');
const logger = require('../utils/logger.js');

/** Papers older than this are rarely a useful guide to the current pattern. */
const OLDEST_YEAR = 2010;

/**
 * GET /api/papers/:examId
 *
 * The learner's papers for one exam, newest year first. Questions are omitted
 * so the index stays small; the detail route carries them.
 */
const listPapers = asyncHandler(async (req, res) => {
  const exam = await loadOwnedExam(req.user._id, req.params.examId);
  const language = normaliseLanguage(req.query.language, req.user.preferences?.language);

  const papers = await PreviousPaper.find({ user: req.user._id, exam: exam._id, language })
    .select('-questions')
    .sort({ year: -1, paperName: 1 })
    .lean();

  // Counting separately keeps the payload small without hiding how big each
  // paper is — the list needs that to render anything useful.
  const counts = await PreviousPaper.aggregate([
    { $match: { user: req.user._id, exam: exam._id, language } },
    {
      $project: {
        questionCount: { $size: '$questions' },
        recalledCount: {
          $size: {
            $filter: {
              input: '$questions',
              cond: { $eq: ['$$this.provenance', 'recalled'] },
            },
          },
        },
      },
    },
  ]);
  const byId = new Map(counts.map((c) => [String(c._id), c]));

  return ok(res, {
    exam: { _id: exam._id, examName: exam.examName, organization: exam.organization },
    papers: papers.map((p) => ({
      ...p,
      questionCount: byId.get(String(p._id))?.questionCount || 0,
      recalledCount: byId.get(String(p._id))?.recalledCount || 0,
    })),
  });
});

/** GET /api/papers/:examId/:paperId — one paper, with its questions. */
const getPaper = asyncHandler(async (req, res) => {
  const exam = await loadOwnedExam(req.user._id, req.params.examId);

  const paper = await PreviousPaper.findOneAndUpdate(
    { _id: req.params.paperId, user: req.user._id, exam: exam._id },
    { $inc: { revisedCount: 1 }, $set: { lastRevisedAt: new Date() } },
    { new: true },
  );
  if (!paper) throw ApiError.notFound('Paper not found.');

  return ok(res, { paper });
});

/**
 * POST /api/papers/:examId
 *
 * Generates one year's paper. Synchronous: a paper is a single call and the
 * client shows a progress state, unlike the upload pipeline which can run for
 * minutes and needs polling.
 */
const buildPaper = asyncHandler(async (req, res) => {
  const exam = await loadOwnedExam(req.user._id, req.params.examId);
  const language = normaliseLanguage(req.body.language, req.user.preferences?.language);

  const year = Number(req.body.year);
  const thisYear = new Date().getFullYear();

  if (!Number.isInteger(year) || year < OLDEST_YEAR || year > thisYear) {
    throw ApiError.badRequest(`Pick a year between ${OLDEST_YEAR} and ${thisYear}.`);
  }

  const paperName = String(req.body.paperName || '').trim();
  const count = Math.min(50, Math.max(5, Number(req.body.count) || 25));

  const existing = await PreviousPaper.findOne({
    user: req.user._id,
    exam: exam._id,
    year,
    paperName,
    language,
  });

  if (existing && !req.body.regenerate) {
    return ok(res, { paper: existing, regenerated: false }, 'You already have this paper.');
  }

  logger.info(`Building ${exam.examName} ${year} ${paperName || ''} (${count} questions, ${language})`);

  const generated = await generatePreviousPaper({
    examName: exam.examName,
    organization: exam.organization,
    examPattern: exam.examPattern,
    syllabus: exam.syllabus,
    year,
    paperName,
    count,
    language,
  });

  if (!generated.questions.length) {
    throw ApiError.unprocessable(
      `No question from the ${year} paper met the confidence bar, so nothing was saved. ` +
        'This usually means the model does not have reliable information about that year — ' +
        'try a different year, or a year closer to the present.',
    );
  }

  // Upsert so regenerating replaces the year rather than accumulating copies.
  const paper = await PreviousPaper.findOneAndUpdate(
    { user: req.user._id, exam: exam._id, year, paperName, language },
    {
      $set: {
        questions: generated.questions,
        sourceBasis: generated.sourceBasis,
        grounded: generated.grounded,
        groundingSources: generated.groundingSources,
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );

  return created(
    res,
    { paper, dropped: generated.dropped },
    generated.dropped
      ? `Paper ready. ${generated.dropped} question(s) were left out for being below the confidence bar.`
      : 'Paper ready.',
  );
});

/** DELETE /api/papers/:examId/:paperId */
const deletePaper = asyncHandler(async (req, res) => {
  const exam = await loadOwnedExam(req.user._id, req.params.examId);

  const paper = await PreviousPaper.findOneAndDelete({
    _id: req.params.paperId,
    user: req.user._id,
    exam: exam._id,
  });
  if (!paper) throw ApiError.notFound('Paper not found.');

  return ok(res, null, 'Paper deleted.');
});

module.exports = { listPapers, getPaper, buildPaper, deletePaper, OLDEST_YEAR };
Object.assign(module.exports, { listPapers, getPaper, buildPaper, deletePaper, OLDEST_YEAR });
