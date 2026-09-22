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
app.use(
  cors({
    origin(origin, cb) {
      // Allow same-origin / curl (no Origin header) and any configured client.
      if (!origin || CLIENT_ORIGINS.includes(origin)) return cb(null, true);
      return cb(new Error(`Origin ${origin} is not allowed by CORS`));
    },
    credentials: true,
  }),
);
app.use(compression());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(morgan(IS_PROD ? 'combined' : 'dev'));

app.use('/api', apiLimiter, routes);

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
