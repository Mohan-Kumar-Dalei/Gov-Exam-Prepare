const crypto = require('node:crypto');

/**
 * Symmetric encryption for secrets held in the database.
 *
 * API keys are the operator's money, so they are never stored in plaintext and
 * never sent back to the browser. The encryption key is derived from
 * JWT_SECRET, which the deployment already has to keep safe — that avoids
 * introducing yet another secret to manage, at the cost of tying the two
 * together: rotating JWT_SECRET makes stored keys undecryptable, which is
 * handled by marking them invalid rather than crashing.
 */

const ALGORITHM = 'aes-256-gcm';
const SALT = 'ai-exam-coach.apikey.v1';

let cachedKey = null;
let cachedFrom = null;

function derivedKey() {
  const source = process.env.JWT_SECRET || 'dev_only_insecure_secret_change_me';
  if (cachedKey && cachedFrom === source) return cachedKey;
  cachedKey = crypto.scryptSync(source, SALT, 32);
  cachedFrom = source;
  return cachedKey;
}

/** @returns {{ cipherText: string, iv: string, tag: string }} */
function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, derivedKey(), iv);
  const cipherText = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return {
    cipherText: cipherText.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
}

/** Returns null when the payload cannot be decrypted, rather than throwing. */
function decrypt({ cipherText, iv, tag }) {
  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, derivedKey(), Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(cipherText, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return null;
  }
}

/** What the UI is allowed to see: enough to recognise a key, not to use it. */
const maskKey = (key = '') => {
  const s = String(key);
  if (s.length <= 8) return '••••';
  return `${s.slice(0, 4)}••••${s.slice(-4)}`;
};

module.exports = { encrypt, decrypt, maskKey };
