const path = require('node:path');
const fs = require('node:fs');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');

// Origins allowed to call this API, as a comma-separated list.
const CLIENT_ORIGINS = (process.env.CLIENT_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);
const IS_PROD = process.env.NODE_ENV === 'production';
const routes = require('./routes/index.js');
const { apiLimiter } = require('./middleware/rateLimit.js');
const { notFound, errorHandler } = require('./middleware/error.js');

const app = express();

app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(compression());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(morgan(IS_PROD ? 'combined' : 'dev'));

/**
 * CORS applies to the API only.
 *
 * Static assets are served from this same origin, so a cross-origin policy has
 * no business gating them — and an over-strict one turns a stylesheet into a
 * JSON error, which the browser then rejects on MIME grounds.
 *
 * The service's own origin is always allowed, whatever CLIENT_ORIGIN says:
 * when the API and the frontend share a process, the app must be able to call
 * itself without anyone having to configure that.
 */
const corsPolicy = (req, cb) => {
  const { origin } = req.headers;
  const selfOrigin = `${req.protocol}://${req.get('host')}`;

  const allowed =
    !origin || // same-origin navigations, curl, server-to-server
    origin === selfOrigin ||
    CLIENT_ORIGINS.includes(origin);

  // Denial means "send no CORS headers", never "throw a 500".
  cb(null, { origin: allowed, credentials: true });
};

app.use('/api', cors(corsPolicy), apiLimiter, routes);

/**
 * In production the built frontend is served from this same process, so the
 * browser talks to one origin and CORS never enters the picture. In
 * development Vite serves the app and proxies /api here instead.
 */
const CLIENT_DIST = path.resolve(__dirname, '../../frontend/dist');

if (fs.existsSync(path.join(CLIENT_DIST, 'index.html'))) {
  app.use(express.static(CLIENT_DIST, { maxAge: '1h', index: false }));

  // Anything that is not an API route is a client-side route.
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    return res.sendFile(path.join(CLIENT_DIST, 'index.html'));
  });
} else {
  app.get('/', (_req, res) =>
    res.json({ success: true, message: 'AI Exam Coach API. See /api/health.' }),
  );
}

app.use(notFound);
app.use(errorHandler);

module.exports = app;
