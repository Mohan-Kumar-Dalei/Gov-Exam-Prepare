const multer = require('multer');
const ApiError = require('../utils/ApiError.js');

const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 20);
const IS_PROD = process.env.NODE_ENV === 'production';
const logger = require('../utils/logger.js');

const notFound = (req, _res, next) =>
  next(ApiError.notFound(`Route not found: ${req.method} ${req.originalUrl}`));

/** Translates driver/library errors into the same envelope every route uses. */
function normalise(err) {
  if (err instanceof ApiError) return err;

  if (err.name === 'ValidationError') {
    const details = Object.values(err.errors || {}).map((e) => ({
      field: e.path,
      message: e.message,
    }));
    return ApiError.unprocessable('Validation failed', details);
  }

  if (err.name === 'CastError') {
    return ApiError.badRequest(`Invalid ${err.path}: ${err.value}`);
  }

  if (err.code === 11000) {
    const fields = Object.keys(err.keyValue || {});

    // A compound index reports every key it collided on. Naming only the first
    // produces nonsense like "That user is already in use", so describe the
    // record instead, and only name a field when the index is a single column.
    if (fields.length === 1) {
      return ApiError.conflict(`That ${fields[0]} is already in use.`);
    }
    return ApiError.conflict(
      'This record already exists. It may have been created by another tab — please refresh.',
    );
  }

  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return ApiError.tooLarge(`File is larger than the ${MAX_UPLOAD_MB}MB limit.`);
    }
    return ApiError.badRequest(`Upload error: ${err.message}`);
  }

  if (err.type === 'entity.parse.failed') {
    return ApiError.badRequest('Request body is not valid JSON.');
  }

  return new ApiError(err.statusCode || 500, err.message || 'Internal server error');
}

// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, _next) => {
  const error = normalise(err);

  if (error.statusCode >= 500) {
    logger.error(`${req.method} ${req.originalUrl} -> ${error.statusCode}`, error.message, error.stack);
  } else {
    logger.warn(`${req.method} ${req.originalUrl} -> ${error.statusCode}: ${error.message}`);
  }

  res.status(error.statusCode).json({
    success: false,
    message: error.statusCode >= 500 && IS_PROD ? 'Something went wrong.' : error.message,
    ...(error.details ? { details: error.details } : {}),
    ...(IS_PROD ? {} : { stack: error.stack }),
  });
};

module.exports = errorHandler;
Object.assign(module.exports, { notFound, errorHandler });
