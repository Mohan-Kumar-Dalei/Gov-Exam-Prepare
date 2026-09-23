const { AsyncLocalStorage } = require('node:async_hooks');

/**
 * Who the current request belongs to, available anywhere without being passed.
 *
 * Every learner brings their own Gemini key, so the transport layer has to
 * know whose ring to spend before it can pick a key. Threading a user id down
 * through every AI call — analysis, lessons, questions, roadmaps, mock
 * blueprints, mentor chat — would mean changing the signature of every
 * function in between, none of which otherwise cares who is asking.
 *
 * Ownership of a request is exactly the kind of cross-cutting, request-scoped
 * fact AsyncLocalStorage exists for. The store follows the async chain, so
 * work a handler starts and deliberately does not await — the upload pipeline,
 * the background question warm-up — still resolves the right owner's keys.
 */
const storage = new AsyncLocalStorage();

/** Express middleware: binds the authenticated user to this request's context. */
const withUserContext = (req, _res, next) => {
  if (!req.user) return next();
  return storage.run({ userId: String(req.user._id), role: req.user.role }, next);
};

/** The current request's context, or null outside a request (scripts, boot). */
const currentContext = () => storage.getStore() || null;

/** Runs `fn` under an explicit context — for scripts and tests. */
const runWithContext = (context, fn) => storage.run(context, fn);

module.exports = { withUserContext, currentContext, runWithContext, storage };
Object.assign(module.exports, { withUserContext, currentContext, runWithContext, storage });
