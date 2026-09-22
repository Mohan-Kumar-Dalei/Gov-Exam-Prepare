const ApiError = require('../utils/ApiError.js');

/**
 * Validates `req[source]` against a zod schema and replaces it with the parsed
 * result, so handlers always receive coerced, trimmed values.
 */
const validate = (schema, source = 'body') => (req, _res, next) => {
  const result = schema.safeParse(req[source]);

  if (!result.success) {
    const details = result.error.issues.map((i) => ({
      field: i.path.join('.') || source,
      message: i.message,
    }));
    return next(ApiError.unprocessable('Validation failed', details));
  }

  if (source === 'query') {
    // req.query is a getter in Express 5; mutate in place rather than reassigning.
    Object.keys(req.query).forEach((k) => delete req.query[k]);
    Object.assign(req.query, result.data);
  } else {
    req[source] = result.data;
  }
  return next();
};

module.exports = validate;
Object.assign(module.exports, { validate });
