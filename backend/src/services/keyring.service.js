const ApiKey = require('../models/ApiKey.js');
const { encrypt, decrypt, maskKey } = require('../utils/secretBox.js');
const logger = require('../utils/logger.js');

/**
 * The rotation ring for Gemini API keys.
 *
 * Every ring belongs to one learner. Each account adds its own keys and spends
 * its own quota, so every read here is scoped by owner — an unscoped read
 * would let one account burn another's credits, which is a billing failure
 * rather than an untidy one. Within an owner's ring, keys are tried in
 * priority order.
 *
 * The environment key is the operator's own, so it is offered only to an admin
 * account. Handing it to every signed-up learner would spend the operator's
 * quota silently, and the whole point of the ring is that people bring their
 * own.
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
/** Keyed by owner: one learner's burst must not serve another's keys. */
const cache = new Map();

/**
 * The environment key has no database row, so its health is parked in memory.
 *
 * Without this a spent env key is retried on every single request — each one
 * paying a round trip to learn what the last one already discovered.
 */
const ENV_PARK_MS = { exhausted: 60 * 60 * 1000, invalid: 60 * 60 * 1000, rate_limited: RATE_LIMIT_COOLDOWN_MS };
let envState = { status: 'untested', until: 0, lastError: '' };

const envKey = () => (process.env.GEMINI_API_KEY || '').trim();

const envKeyAvailable = () => Boolean(envKey()) && Date.now() >= envState.until;

/** Drops one owner's cached ring, or every owner's when called bare. */
function invalidate(userId) {
  if (userId) cache.delete(String(userId));
  else cache.clear();
}

/**
 * Hands an account the keys it added before keys had owners.
 *
 * Rows from the shared-ring era carry `addedBy` but no `user`, so a scoped
 * read cannot see them and their owner is told they have no key. The row
 * already records who added it, so there is nothing to decide — and only rows
 * this exact account added are ever touched, so one account can never adopt
 * another's key. Running it on read means the owner only has to sign in,
 * rather than someone having to reach a shell on the server.
 *
 * @returns {Promise<number>} how many rows were adopted
 */
async function adoptLegacyKeys(owner) {
  const adopted = await ApiKey.updateMany(
    { user: { $exists: false }, addedBy: owner },
    { $set: { user: owner } },
  );
  if (adopted.modifiedCount) {
    logger.info(`Adopted ${adopted.modifiedCount} key(s) this account added before keys had owners`);
  }
  return adopted.modifiedCount || 0;
}

/**
 * Re-files keys that an earlier misclassification parked as out of credits.
 *
 * Until recently a 429 was read as depleted credits, because Google's quota
 * message mentions "billing details". Those keys were parked with no cooldown,
 * so they stay dead until someone revives each one by hand — and the owner is
 * told to top up an account that has nothing wrong with it.
 *
 * That was this app's mistake, so this app undoes it rather than leaving a
 * cleanup chore behind. Only rows whose stored error is visibly a 429 are
 * touched; a genuine billing failure keeps its status, because that one really
 * does need paying.
 *
 * @returns {Promise<number>} how many rows were re-filed
 */
const LOOKS_LIKE_429 = /"code"\s*:\s*429|RESOURCE_EXHAUSTED|docs\/rate-limits/i;

async function reclassifyMisparkedKeys(owner) {
  const rows = await ApiKey.find({ user: owner, status: 'exhausted' }).select('label lastError');

  let fixed = 0;
  for (const row of rows) {
    const detail = row.lastError || '';
    if (!LOOKS_LIKE_429.test(detail)) continue;
    if (classify(0, detail).status === 'exhausted') continue; // really is billing

    await ApiKey.updateOne(
      { _id: row._id },
      {
        status: 'rate_limited',
        cooldownUntil: new Date(Date.now() + rateLimitCooldown(detail)),
      },
    ).catch(() => {});
    fixed += 1;
  }

  if (fixed) {
    logger.info(
      `Re-filed ${fixed} key(s) from "out of credits" to "quota exceeded" — they hit a usage ` +
        'limit rather than running out of credit, and will be retried automatically.',
    );
  }
  return fixed;
}

/**
 * One owner's keys to try, in order, as `{ id, key, label }`.
 * `id` is null for the environment key, which has no database row.
 *
 * @param {object}  opts
 * @param {string}  opts.userId  whose ring to read — required
 * @param {boolean} opts.isAdmin whether the environment key may be offered
 */
async function getUsableKeys({ userId, isAdmin = false, force = false, healed = false } = {}) {
  if (!userId) return [];

  const owner = String(userId);
  const now = Date.now();
  const hit = cache.get(owner);
  if (!force && hit && hit.keys.length && now - hit.at < CACHE_MS) return hit.keys;

  const read = () =>
    ApiKey.find({ user: owner, enabled: true })
      .select('+cipherText +iv +tag')
      .sort({ priority: 1, createdAt: 1 });

  let rows = [];
  try {
    rows = await read();

    // Nothing visible may just mean the rows predate ownership.
    if (!rows.length && (await adoptLegacyKeys(owner))) rows = await read();
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

  // Every key filed as dead may just be mis-filed. Re-check once, only when
  // there is nothing left to try, so the normal path costs nothing.
  if (!usable.length && !healed) {
    try {
      if (await reclassifyMisparkedKeys(owner)) {
        cache.delete(owner);
        // `healed` stops this recursing: a re-filed key is no longer
        // "exhausted", so a second pass would find nothing anyway, but the
        // flag makes that a guarantee rather than a consequence.
        return getUsableKeys({ userId, isAdmin, force: true, healed: true });
      }
    } catch (err) {
      logger.warn(`Could not re-check parked keys: ${err.message}`);
    }
  }

  // The operator's own key, offered only to the operator.
  const fromEnv = envKey();
  if (isAdmin && fromEnv && envKeyAvailable() && !usable.some((k) => k.key === fromEnv)) {
    usable.push({ id: null, key: fromEnv, label: 'GEMINI_API_KEY (env)' });
  }

  cache.set(owner, { at: now, keys: usable });
  return usable;
}

/**
 * Keys stored before the ring became per-account, so they have no owner.
 *
 * Scoped reads cannot see them, which to their owner looks exactly like the
 * key having vanished. Counted here so the failure can say so instead of
 * claiming no key was ever added. Read through the driver rather than the
 * model, because `user` is required on the schema now and a model query would
 * filter out precisely the rows being looked for.
 */
async function countOwnerlessKeys() {
  try {
    return await ApiKey.collection.countDocuments({ user: { $exists: false } });
  } catch {
    return 0;
  }
}

/**
 * How long a 429 should sit out.
 *
 * Google returns RESOURCE_EXHAUSTED for two very different things: a
 * per-minute burst limit, which clears in a moment, and a daily quota, which
 * does not clear until the quota resets. Treating both as five minutes means
 * hammering a key that cannot answer until tomorrow.
 *
 * The response often carries a retryDelay; when it does, that is the most
 * reliable answer available and it wins.
 */
const DAILY_QUOTA = /per\s*day|perday|requests per day|daily limit|quota_?metric.*day/i;

const retryDelayMs = (detail) => {
  const m = detail.match(/retry\s*-?\s*delay"?\s*[:=]\s*"?(\d+(?:\.\d+)?)\s*s/i);
  return m ? Math.ceil(Number(m[1]) * 1000) : 0;
};

/**
 * Milliseconds until the free-tier daily quota resets.
 *
 * Google resets it at midnight America/Los_Angeles, which is not a fixed
 * offset from here, so the current Pacific wall-clock time is asked for
 * directly rather than computed from a hardcoded offset that breaks twice a
 * year.
 */
function msUntilQuotaReset(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(now);

  const [h, m, sec] = parts.split(':').map(Number);
  const elapsed = (((h % 24) * 60 + m) * 60 + sec) * 1000;
  return 24 * 60 * 60 * 1000 - elapsed;
}

function rateLimitCooldown(detail) {
  const told = retryDelayMs(detail);
  // Cap it: a malformed or absurd delay must not park a key for days.
  if (told) return Math.min(told + 1000, 6 * 60 * 60 * 1000);
  if (DAILY_QUOTA.test(detail)) return msUntilQuotaReset();
  return RATE_LIMIT_COOLDOWN_MS;
}

/** Classifies an upstream status into what it means for the key that produced it. */
function classify(status, detail = '') {
  // Only a real billing failure counts as exhausted: a 402, or a message that
  // actually says the credits are gone.
  //
  // This used to match the bare word "billing", which Google puts in the body
  // of every 429 — "check your plan and billing details". So an ordinary quota
  // limit was filed as a dead card, shown as "Out of credits", and parked
  // until someone revived it by hand. A quota comes back on its own; credits
  // do not. Confusing the two tells the owner to go and pay for something that
  // would have fixed itself.
  if (
    status === 402 ||
    /prepayment credits are depleted|credits? (are|is) (depleted|exhausted)/i.test(detail)
  ) {
    return { status: 'exhausted', parks: true, cooldownMs: 0 };
  }
  if (status === 429) {
    return { status: 'rate_limited', parks: true, cooldownMs: rateLimitCooldown(detail) };
  }
  if (status === 401 || status === 403 || /api key not valid|invalid api key/i.test(detail)) {
    return { status: 'invalid', parks: true, cooldownMs: 0 };
  }
  // 503, 500, 404: not the key's fault.
  return { status: null, parks: false, cooldownMs: 0 };
}

/** Records a key-attributable failure. Returns true when the key was parked. */
async function reportFailure(id, status, detail = '', userId = null) {
  const verdict = classify(status, detail);
  if (!verdict.parks) return false;
  if (!id) {
    // No database row to park, so its health is held in memory instead.
    const parkFor = ENV_PARK_MS[verdict.status] ?? RATE_LIMIT_COOLDOWN_MS;
    envState = { status: verdict.status, until: Date.now() + parkFor, lastError: detail.slice(0, 300) };
    logger.warn(
      `Environment API key ${verdict.status}; skipping it for ${Math.round(parkFor / 60000)} min`,
    );
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

  invalidate(userId);
  logger.warn(`API key parked as ${verdict.status}`);
  return true;
}

async function reportSuccess(id) {
  if (!id) {
    envState = { status: 'ok', until: 0, lastError: '' };
    return;
  }
  await ApiKey.updateOne(
    { _id: id },
    { status: 'ok', lastError: '', cooldownUntil: null, lastUsedAt: new Date(), $inc: { successCount: 1 } },
  ).catch(() => {});
}

/* ------------------------------------------------------------------ */
/* Management                                                          */
/* ------------------------------------------------------------------ */

/*
 * Every management call below takes the owner and filters on it. The id alone
 * is never enough: an id is guessable, and a lookup by id alone would let one
 * account read, disable or delete another account's key.
 */

async function addKey({ userId, label, key }) {
  const trimmed = String(key).trim();
  const last = await ApiKey.findOne({ user: userId })
    .sort({ priority: -1 })
    .select('priority')
    .lean();

  const created = await ApiKey.create({
    user: userId,
    label: label?.trim() || `Key ${(last?.priority ?? 0) + 2}`,
    ...encrypt(trimmed),
    masked: maskKey(trimmed),
    priority: (last?.priority ?? -1) + 1,
    addedBy: userId,
  });

  invalidate(userId);
  return created;
}

async function listKeys(userId) {
  const read = () => ApiKey.find({ user: userId }).sort({ priority: 1, createdAt: 1 });

  let rows = await read();
  // Same adoption as the read path, so the Settings page shows a key the
  // moment its owner opens it rather than after some other request ran.
  if (!rows.length && (await adoptLegacyKeys(userId))) rows = await read();

  return rows.map((r) => r.toClient());
}

async function removeKey(id, userId) {
  const deleted = await ApiKey.findOneAndDelete({ _id: id, user: userId });
  invalidate(userId);
  return deleted;
}

async function updateKey(id, userId, patch) {
  const updated = await ApiKey.findOneAndUpdate({ _id: id, user: userId }, patch, { new: true });
  invalidate(userId);
  return updated;
}

/** Clears a parked status so the owner can retry after topping up. */
async function reviveKey(id, userId) {
  return updateKey(id, userId, {
    status: 'untested',
    lastError: '',
    cooldownUntil: null,
    enabled: true,
  });
}

/** Reads one key's plaintext, for the "test this key" action only. */
async function readPlaintext(id, userId) {
  const row = await ApiKey.findOne({ _id: id, user: userId }).select('+cipherText +iv +tag');
  if (!row) return null;
  return decrypt({ cipherText: row.cipherText, iv: row.iv, tag: row.tag });
}

/** The env key's live state, for the Settings page. */
const envKeyState = () => ({
  present: Boolean(envKey()),
  status: envState.status,
  available: envKeyAvailable(),
  lastError: envState.lastError,
  retryAt: envState.until ? new Date(envState.until) : null,
});

/** Clears the in-memory park, for the "revive" action. */
const reviveEnvKey = () => {
  envState = { status: 'untested', until: 0, lastError: '' };
  invalidate();
};

module.exports = {
  getUsableKeys,
  reclassifyMisparkedKeys,
  msUntilQuotaReset,
  rateLimitCooldown,
  countOwnerlessKeys,
  adoptLegacyKeys,
  envKeyState,
  reviveEnvKey,
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
