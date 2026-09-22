// Load .env before anything else requires a module that reads process.env.
const { loadEnv } = require('./config/loadEnv.js');

const envFile = loadEnv();

const app = require('./app.js');
const { connectDB, disconnectDB } = require('./config/db.js');
const logger = require('./utils/logger.js');
const { isConfigured } = require('./services/gemini.service.js');

const PORT = Number(process.env.PORT || 5000);
const NODE_ENV = process.env.NODE_ENV || 'development';

let server;

async function start() {
  logger.info(envFile ? `Loaded env from ${envFile}` : 'No .env file found — using defaults');

  await connectDB();

  if (!(await isConfigured())) {
    logger.warn('No usable Gemini API key — add one under Settings, or set GEMINI_API_KEY.');
  }

  server = app.listen(PORT, () => {
    logger.info(`AI Exam Coach API listening on http://localhost:${PORT} (${NODE_ENV})`);
  });
}

async function shutdown(signal) {
  logger.info(`${signal} received — shutting down`);
  server?.close(async () => {
    await disconnectDB();
    process.exit(0);
  });
  // Do not hang forever on in-flight AI calls.
  setTimeout(() => process.exit(1), 10000).unref();
}

['SIGINT', 'SIGTERM'].forEach((sig) => process.on(sig, () => shutdown(sig)));

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', reason instanceof Error ? reason.message : reason);
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception — exiting', err.message, err.stack);
  process.exit(1);
});

start().catch((err) => {
  logger.error('Failed to start server', err.message);
  process.exit(1);
});
