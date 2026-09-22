/* Minimal structured logger — avoids a dependency while staying greppable. */
const ts = () => new Date().toISOString();
const write = (level, args) => {
  const line = args
    .map((a) => (typeof a === 'string' ? a : JSON.stringify(a, null, 0)))
    .join(' ');
  // eslint-disable-next-line no-console
  console[level === 'debug' ? 'log' : level](`${ts()} [${level.toUpperCase()}] ${line}`);
};

const logger = {
  info: (...args) => write('info', args),
  warn: (...args) => write('warn', args),
  error: (...args) => write('error', args),
  debug: (...args) => {
    if (process.env.NODE_ENV !== 'production') write('debug', args);
  },
};

module.exports = logger;
