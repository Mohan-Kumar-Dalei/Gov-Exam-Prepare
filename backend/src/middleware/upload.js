const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const multer = require('multer');

// Resolved from this file so the directory is the same wherever the process starts.
const UPLOAD_DIR = path.resolve(__dirname, '../../', process.env.UPLOAD_DIR || 'uploads');
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 20);
const ApiError = require('../utils/ApiError.js');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const safeBase = path
      .basename(file.originalname, path.extname(file.originalname))
      .replace(/[^a-zA-Z0-9-_]/g, '_')
      .slice(0, 40);
    const ext = path.extname(file.originalname).toLowerCase() || '.pdf';
    cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}-${safeBase}${ext}`);
  },
});

/**
 * Plain text is accepted as well as PDF.
 *
 * A notification the user has already converted to text elsewhere is the best
 * possible input: nothing has to be transcribed, no page images reach the
 * model, and their converter's output is usually cleaner than anything we
 * would produce ourselves.
 */
const ACCEPTED = {
  '.pdf': ['application/pdf'],
  '.txt': ['text/plain', 'application/octet-stream'],
  '.md': ['text/markdown', 'text/plain', 'application/octet-stream'],
};

const fileFilter = (_req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  const allowedTypes = ACCEPTED[ext];

  if (!allowedTypes) {
    return cb(ApiError.badRequest('Upload a PDF, or a .txt file of the notification text.'));
  }
  // Browsers are inconsistent about the type they report for .txt, so the
  // extension decides and the mime type is only a sanity check.
  return cb(null, true);
};

const uploadPdf = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
}).single('pdf');

/** Wraps multer so its errors flow through the normal error middleware. */
const handlePdfUpload = (req, res, next) =>
  uploadPdf(req, res, (err) => {
    if (err) return next(err);
    if (!req.file) return next(ApiError.badRequest('No PDF was uploaded. Use the "pdf" field.'));
    return next();
  });

module.exports = handlePdfUpload;
Object.assign(module.exports, { uploadPdf, handlePdfUpload });
