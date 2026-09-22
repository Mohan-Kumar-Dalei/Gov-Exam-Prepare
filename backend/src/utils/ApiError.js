class ApiError extends Error {
  constructor(statusCode, message, details = undefined) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(msg = 'Bad request', details) { return new ApiError(400, msg, details); }
  static unauthorized(msg = 'Unauthorized') { return new ApiError(401, msg); }
  static forbidden(msg = 'Forbidden') { return new ApiError(403, msg); }
  static notFound(msg = 'Not found') { return new ApiError(404, msg); }
  static conflict(msg = 'Conflict') { return new ApiError(409, msg); }
  static tooLarge(msg = 'Payload too large') { return new ApiError(413, msg); }
  static unprocessable(msg = 'Unprocessable', details) { return new ApiError(422, msg, details); }
  static internal(msg = 'Internal server error') { return new ApiError(500, msg); }
  static upstream(msg = 'Upstream AI service failed') { return new ApiError(502, msg); }
}

module.exports = ApiError;
