const { GoogleGenAI } = require('@google/genai');
const asyncHandler = require('../utils/asyncHandler.js');
const ApiError = require('../utils/ApiError.js');
const { ok, created } = require('../utils/apiResponse.js');
const keyring = require('../services/keyring.service.js');
const logger = require('../utils/logger.js');

/** GET /api/keys — the ring, masked. */
const listKeys = asyncHandler(async (_req, res) => {
  const keys = await keyring.listKeys();
  const fromEnv = keyring.envKey();

  return ok(res, {
    keys,
    // Surfaced so the UI can explain where a working key is coming from when
    // the ring itself is empty.
    envKeyPresent: Boolean(fromEnv),
    usableCount: (await keyring.getUsableKeys({ force: true })).length,
  });
});

/** POST /api/keys — add a key to the ring. */
const addKey = asyncHandler(async (req, res) => {
  const { label, key } = req.body;
  const trimmed = String(key || '').trim();

  if (trimmed.length < 20) {
    throw ApiError.badRequest('That does not look like a Gemini API key.');
  }

  const existing = await keyring.listKeys();
  if (existing.length >= 10) {
    throw ApiError.badRequest('The ring holds at most 10 keys. Remove one first.');
  }

  const record = await keyring.addKey({ label, key: trimmed, addedBy: req.user._id });
  logger.info(`API key "${record.label}" added to the ring`);

  return created(res, { key: record.toClient() }, 'Key added.');
});

/** PATCH /api/keys/:id — rename, reorder, enable or disable. */
const updateKey = asyncHandler(async (req, res) => {
  const patch = {};
  if (req.body.label !== undefined) patch.label = String(req.body.label).trim().slice(0, 60);
  if (req.body.enabled !== undefined) patch.enabled = Boolean(req.body.enabled);
  if (req.body.priority !== undefined) patch.priority = Number(req.body.priority);

  const updated = await keyring.updateKey(req.params.id, patch);
  if (!updated) throw ApiError.notFound('Key not found.');

  return ok(res, { key: updated.toClient() }, 'Key updated.');
});

/** POST /api/keys/:id/revive — clear a parked status after topping up. */
const reviveKey = asyncHandler(async (req, res) => {
  const updated = await keyring.reviveKey(req.params.id);
  if (!updated) throw ApiError.notFound('Key not found.');
  return ok(res, { key: updated.toClient() }, 'Key re-enabled. It will be tried again.');
});

/** DELETE /api/keys/:id */
const removeKey = asyncHandler(async (req, res) => {
  const deleted = await keyring.removeKey(req.params.id);
  if (!deleted) throw ApiError.notFound('Key not found.');
  return ok(res, null, 'Key removed.');
});

/**
 * POST /api/keys/:id/test — one cheap live call, so the operator learns whether
 * a key works before a learner discovers it does not.
 */
const testKey = asyncHandler(async (req, res) => {
  const plain = await keyring.readPlaintext(req.params.id);
  if (!plain) throw ApiError.notFound('Key not found, or it could not be decrypted.');

  const model = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
  const started = Date.now();

  try {
    const ai = new GoogleGenAI({ apiKey: plain });
    await ai.models.generateContent({
      model,
      contents: [{ role: 'user', parts: [{ text: 'Reply with the single word OK' }] }],
      config: { maxOutputTokens: 16, temperature: 0 },
    });

    const updated = await keyring.updateKey(req.params.id, {
      status: 'ok',
      lastError: '',
      cooldownUntil: null,
      lastUsedAt: new Date(),
    });

    return ok(res, { key: updated.toClient(), ms: Date.now() - started }, `Key works on ${model}.`);
  } catch (err) {
    const status = Number(err?.status) || 0;
    const detail = String(err?.message || '');
    const verdict = keyring.classify(status, detail);

    const updated = await keyring.updateKey(req.params.id, {
      status: verdict.status || 'untested',
      lastError: detail.slice(0, 300),
      cooldownUntil: verdict.cooldownMs ? new Date(Date.now() + verdict.cooldownMs) : null,
    });

    // A failed test is a successful diagnosis, so this is a 200 with the verdict.
    return ok(
      res,
      { key: updated.toClient(), ok: false, status, detail: detail.slice(0, 200) },
      'That key could not complete a test call.',
    );
  }
});

module.exports = { listKeys, addKey, updateKey, reviveKey, removeKey, testKey };
