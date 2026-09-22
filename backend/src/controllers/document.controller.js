const fs = require('node:fs/promises');
const { createHash } = require('node:crypto');
const asyncHandler = require('../utils/asyncHandler.js');
const ApiError = require('../utils/ApiError.js');
const { ok, created } = require('../utils/apiResponse.js');
const { Document, Exam, User, Roadmap } = require('../models/index.js');
const { parsePdf, removeFile } = require('../services/pdf.service.js');
const { analyzeNotification } = require('../services/ai.service.js');
const { seedProgress, buildRoadmap } = require('../services/roadmap.service.js');
const { warmQuestionBank } = require('../services/adaptive.service.js');
const { parsePagination, buildMeta } = require('../utils/pagination.js');
const logger = require('../utils/logger.js');

/**
 * parse -> Gemini analysis -> Exam -> Progress rows -> roadmap.
 *
 * Runs detached from the HTTP request: under load, Gemini retries and model
 * fallbacks can push this past any reasonable browser timeout. Progress is
 * written to the Document so the client can poll, and so closing the tab does
 * not lose the work. Roadmap generation is best-effort — failing there must not
 * discard a successful analysis.
 */
async function runPipeline(doc, user) {
  try {
    const { text, pageCount, charCount, needsVision, buffer } = await parsePdf(doc.path);

    doc.extractedText = text;
    doc.pageCount = pageCount;
    doc.charCount = charCount;
    doc.isScanned = needsVision;
    doc.status = 'analyzing';
    await doc.save();

    // A scanned notification has no usable text layer, so Gemini reads the pages.
    const analysis = await analyzeNotification(
      needsVision
        ? { buffer, mimeType: doc.mimeType, displayName: doc.originalName }
        : { text },
    );

    const exam = await Exam.create({ ...analysis, user: user._id, sourceDocument: doc._id });

    doc.exam = exam._id;
    doc.status = 'completed';
    doc.analyzedAt = new Date();
    await doc.save();

    await seedProgress(user._id, exam);

    // Make this the learner's active exam if they do not have one yet.
    if (!user.activeExam) {
      await User.findByIdAndUpdate(user._id, { activeExam: exam._id });
    }

    try {
      await buildRoadmap({
        userId: user._id,
        exam,
        days: 60,
        dailyMinutes: user.preferences?.dailyStudyMinutes || 120,
      });
    } catch (err) {
      logger.error('Automatic roadmap generation failed', err.message);
    }

    logger.info(`Analysis complete for ${doc.originalName}: ${exam.examName}`);

    // Stock the bank now, while the learner is still reading the extracted
    // syllabus. Without this the very first quiz pays full generation latency,
    // which is exactly the moment a new learner is least willing to wait.
    warmQuestionBank({
      userId: user._id,
      exam,
      language: user.preferences?.language || 'en',
    });
  } catch (err) {
    logger.error(`Analysis failed for ${doc.originalName}`, err.message);
    doc.status = 'failed';
    doc.error = err.message?.slice(0, 500) || 'Unknown error';
    await doc.save().catch(() => {});
  }
}

/**
 * POST /api/documents/upload
 *
 * Accepts the file and returns 202 immediately. Poll
 * `GET /api/documents/:id/status` for the result.
 */
const uploadAndAnalyze = asyncHandler(async (req, res) => {
  const { file, user } = req;

  const contentHash = createHash('sha256').update(await fs.readFile(file.path)).digest('hex');

  // Re-uploading a PDF this user has already analysed is common — point at the
  // finished exam instead of paying for the whole pipeline again.
  const previous = await Document.findOne({
    user: user._id,
    contentHash,
    status: 'completed',
    exam: { $ne: null },
  }).sort({ createdAt: -1 });

  if (previous) {
    logger.info(`Identical PDF already analysed (${contentHash.slice(0, 12)}); reusing it`);
    await removeFile(file.path);

    return res.status(200).json({
      success: true,
      message: 'You have already analysed this PDF — reusing the earlier result.',
      data: { documentId: previous._id, status: 'completed', reused: true },
    });
  }

  const doc = await Document.create({
    user: user._id,
    originalName: file.originalname,
    storedName: file.filename,
    path: file.path,
    mimeType: file.mimetype,
    sizeBytes: file.size,
    contentHash,
    status: 'parsing',
  });

  // Deliberately not awaited: the response goes out now.
  runPipeline(doc, user);

  return res.status(202).json({
    success: true,
    message: 'Upload received. Analysis has started.',
    data: {
      documentId: doc._id,
      status: doc.status,
      originalName: doc.originalName,
    },
  });
});

/** GET /api/documents/:id/status — poll target for the upload pipeline. */
const getStatus = asyncHandler(async (req, res) => {
  const doc = await Document.findOne({ _id: req.params.id, user: req.user._id })
    .select('status error pageCount isScanned originalName exam analyzedAt createdAt')
    .lean();
  if (!doc) throw ApiError.notFound('Document not found.');

  const payload = {
    documentId: doc._id,
    status: doc.status,
    originalName: doc.originalName,
    pageCount: doc.pageCount,
    isScanned: doc.isScanned,
    error: doc.error || null,
    elapsedSec: Math.round((Date.now() - new Date(doc.createdAt).getTime()) / 1000),
  };

  if (doc.status !== 'completed') return ok(res, payload);

  const exam = await Exam.findById(doc.exam);
  const roadmap = await Roadmap.exists({ user: req.user._id, exam: doc.exam, isActive: true });

  return ok(res, { ...payload, exam, roadmapGenerated: Boolean(roadmap) });
});

/** POST /api/documents/:id/reanalyze — re-runs Gemini on a stored upload. */
const reanalyze = asyncHandler(async (req, res) => {
  const doc = await Document.findOne({ _id: req.params.id, user: req.user._id }).select(
    '+extractedText',
  );
  if (!doc) throw ApiError.notFound('Document not found.');

  doc.status = 'analyzing';
  await doc.save();

  // Scanned documents have no stored text, so re-read the file from disk.
  let payload;
  if (doc.extractedText) {
    payload = { text: doc.extractedText };
  } else {
    const { buffer, needsVision } = await parsePdf(doc.path);
    if (!needsVision) throw ApiError.badRequest('This document has no content to analyse.');
    payload = { buffer, mimeType: doc.mimeType, displayName: doc.originalName };
  }

  const analysis = await analyzeNotification(payload);

  const exam = await Exam.create({ ...analysis, user: req.user._id, sourceDocument: doc._id });
  doc.exam = exam._id;
  doc.status = 'completed';
  doc.analyzedAt = new Date();
  await doc.save();

  await seedProgress(req.user._id, exam);

  return created(res, { exam }, 'Document re-analysed.');
});

/** GET /api/documents */
const listDocuments = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const filter = { user: req.user._id, ...(req.query.status ? { status: req.query.status } : {}) };

  const [items, total] = await Promise.all([
    Document.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('exam', 'examName organization subjects vacancies.total')
      .lean(),
    Document.countDocuments(filter),
  ]);

  return ok(res, items, 'OK', buildMeta(total, page, limit));
});

/** GET /api/documents/:id */
const getDocument = asyncHandler(async (req, res) => {
  const doc = await Document.findOne({ _id: req.params.id, user: req.user._id }).populate('exam');
  if (!doc) throw ApiError.notFound('Document not found.');
  return ok(res, doc);
});

/** GET /api/documents/:id/text — the raw extracted text, for debugging an odd analysis. */
const getDocumentText = asyncHandler(async (req, res) => {
  const doc = await Document.findOne({ _id: req.params.id, user: req.user._id }).select(
    '+extractedText originalName pageCount',
  );
  if (!doc) throw ApiError.notFound('Document not found.');

  return ok(res, {
    originalName: doc.originalName,
    pageCount: doc.pageCount,
    text: doc.extractedText,
  });
});

/** DELETE /api/documents/:id */
const deleteDocument = asyncHandler(async (req, res) => {
  const doc = await Document.findOneAndDelete({ _id: req.params.id, user: req.user._id });
  if (!doc) throw ApiError.notFound('Document not found.');

  await removeFile(doc.path);
  return ok(res, null, 'Document deleted. The extracted exam was kept.');
});

module.exports = {
  uploadAndAnalyze,
  getStatus,
  reanalyze,
  listDocuments,
  getDocument,
  getDocumentText,
  deleteDocument,
};
Object.assign(module.exports, { uploadAndAnalyze, getStatus, reanalyze, listDocuments, getDocument, getDocumentText, deleteDocument });
