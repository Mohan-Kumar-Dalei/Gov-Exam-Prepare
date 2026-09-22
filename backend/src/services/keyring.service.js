const ApiKey = require('../models/ApiKey.js');
const { encrypt, decrypt, maskKey } = require('../utils/secretBox.js');
const logger = require('../utils/logger.js');

/**
 * The rotation ring for Gemini API keys.
 *
 * Keys added through the UI are tried in priority order. The key from the
 * environment, when present, is always available as a last resort so the app
 * keeps working before anyone has configured the ring — and if every stored
 * key is exhausted.
 *
 * Failures are classified rather than treated alike:
 *   402 depleted credits -> park the key until the operator tops it up
 *   429 rate limit       -> cool the key for a few minutes
 *   400/403 bad key      -> mark invalid; retrying will never help
 * A 503 is a model capacity problem shared by every key, so it does not park
 * anything — the model chain handles it first.
 */

/** How long a rate-limited key sits out before being retried. */
const RATE_LIMIT_COOLDOWN_MS = 5 * 60 * 1000;

/** Short cache so a burst of calls does not re-read the collection each time. */
const CACHE_MS = 5000;
let cache = { at: 0, keys: [] };

const envKey = () => (process.env.GEMINI_API_KEY || '').trim();

function invalidate() {
  cache = { at: 0, keys: [] };
}

/**
 * Keys to try, in order, as `{ id, key, label }`.
 * `id` is null for the environment key, which has no database row.
 */
async function getUsableKeys({ force = false } = {}) {
  const now = Date.now();
  if (!force && cache.keys.length && now - cache.at < CACHE_MS) return cache.keys;

  let rows = [];
  try {
    rows = await ApiKey.find({ enabled: true })
      .select('+cipherText +iv +tag')
      .sort({ priority: 1, createdAt: 1 });
  } catch (err) {
    // A database hiccup must not take AI down when an env key exists.
    logger.warn(`Could not read the key ring: ${err.message}`);
  }

  const usable = [];
  for (const row of rows) {
    if (!row.isAvailable()) continue;
    const plain = decrypt({ cipherText: row.cipherText, iv: row.iv, tag: row.tag });
    if (!plain) {
      // Undecryptable almost always means JWT_SECRET changed under it.
      await ApiKey.updateOne(
        { _id: row._id },
        { status: 'invalid', lastError: 'Could not be decrypted — JWT_SECRET may have changed.' },
      ).catch(() => {});
      continue;
    }
    usable.push({ id: String(row._id), key: plain, label: row.label });
  }

  const fromEnv = envKey();
  if (fromEnv && !usable.some((k) => k.key === fromEnv)) {
    usable.push({ id: null, key: fromEnv, label: 'GEMINI_API_KEY (.env)' });
  }

  cache = { at: now, keys: usable };
  return usable;
}

/** Classifies an upstream status into what it means for the key that produced it. */
function classify(status, detail = '') {
  if (status === 402 || /prepayment credits are depleted|billing/i.test(detail)) {
    return { status: 'exhausted', parks: true, cooldownMs: 0 };
  }
  if (status === 429) {
    return { status: 'rate_limited', parks: true, cooldownMs: RATE_LIMIT_COOLDOWN_MS };
  }
  if (status === 401 || status === 403 || /api key not valid|invalid api key/i.test(detail)) {
    return { status: 'invalid', parks: true, cooldownMs: 0 };
  }
  // 503, 500, 404: not the key's fault.
  return { status: null, parks: false, cooldownMs: 0 };
}

/** Records a key-attributable failure. Returns true when the key was parked. */
async function reportFailure(id, status, detail = '') {
  const verdict = classify(status, detail);
  if (!verdict.parks) return false;
  if (!id) {
    // The env key cannot be parked in the database, but the caller still moves on.
    logger.warn(`Environment API key reported ${verdict.status}`);
    invalidate();
    return true;
  }

  await ApiKey.updateOne(
    { _id: id },
    {
      status: verdict.status,
      lastError: detail.slice(0, 300),
      cooldownUntil: verdict.cooldownMs ? new Date(Date.now() + verdict.cooldownMs) : null,
      $inc: { failureCount: 1 },
    },
  ).catch(() => {});

  invalidate();
  logger.warn(`API key parked as ${verdict.status}`);
  return true;
}

async function reportSuccess(id) {
  if (!id) return;
  await ApiKey.updateOne(
    { _id: id },
    { status: 'ok', lastError: '', cooldownUntil: null, lastUsedAt: new Date(), $inc: { successCount: 1 } },
  ).catch(() => {});
}

/* ------------------------------------------------------------------ */
/* Management                                                          */
/* ------------------------------------------------------------------ */

async function addKey({ label, key, addedBy }) {
  const trimmed = String(key).trim();
  const last = await ApiKey.findOne().sort({ priority: -1 }).select('priority').lean();

  const created = await ApiKey.create({
    label: label?.trim() || `Key ${(last?.priority ?? 0) + 1}`,
    ...encrypt(trimmed),
    masked: maskKey(trimmed),
    priority: (last?.priority ?? -1) + 1,
    addedBy,
  });

  invalidate();
  return created;
}

async function listKeys() {
  const rows = await ApiKey.find().sort({ priority: 1, createdAt: 1 });
  return rows.map((r) => r.toClient());
}

async function removeKey(id) {
  const deleted = await ApiKey.findByIdAndDelete(id);
  invalidate();
  return deleted;
}

async function updateKey(id, patch) {
  const updated = await ApiKey.findByIdAndUpdate(id, patch, { new: true });
  invalidate();
  return updated;
}

/** Clears a parked status so the operator can retry after topping up. */
async function reviveKey(id) {
  return updateKey(id, { status: 'untested', lastError: '', cooldownUntil: null, enabled: true });
}

/** Reads one key's plaintext, for the "test this key" action only. */
async function readPlaintext(id) {
  const row = await ApiKey.findById(id).select('+cipherText +iv +tag');
  if (!row) return null;
  return decrypt({ cipherText: row.cipherText, iv: row.iv, tag: row.tag });
}

module.exports = {
  getUsableKeys,
  reportFailure,
  reportSuccess,
  classify,
  addKey,
  listKeys,
  removeKey,
  updateKey,
  reviveKey,
  readPlaintext,
  invalidate,
  envKey,
};
