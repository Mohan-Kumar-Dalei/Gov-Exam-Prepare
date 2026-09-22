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
    cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}-${safeBase}.pdf`);
  },
});

const fileFilter = (_req, file, cb) => {
  const isPdf =
    file.mimetype === 'application/pdf' && path.extname(file.originalname).toLowerCase() === '.pdf';
  if (!isPdf) return cb(ApiError.badRequest('Only PDF files are accepted.'));
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
