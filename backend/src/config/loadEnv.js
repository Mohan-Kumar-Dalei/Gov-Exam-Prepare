const fs = require('node:fs');
const path = require('node:path');

/**
 * Loads .env from wherever it actually is.
 *
 * `dotenv.config()` with no argument resolves against the working directory,
 * so running from a different folder — or moving the file — silently yields no
 * variables at all, and the app then falls back to defaults that may point
 * somewhere unintended. Checking a few known locations makes that impossible.
 *
 * @returns {string|null} the file that was loaded
 */
function loadEnv() {
  const candidates = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(__dirname, '../../.env'), // backend/.env
    path.resolve(__dirname, '../.env'), // backend/src/.env
  ];

  for (const file of candidates) {
    if (fs.existsSync(file)) {
      require('dotenv').config({ path: file });
      return file;
    }
  }
  return null;
}

module.exports = { loadEnv };
