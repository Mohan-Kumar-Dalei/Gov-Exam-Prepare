const { GoogleGenAI, ApiError: GenAIApiError } = require('@google/genai');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
/**
 * Tried in order when the primary model is overloaded or retired.
 *
 * Gemma sits last on purpose. It is free rather than metered, so it is the one
 * model still reachable once a key's paid quota is spent — but it is an open
 * model with no system-instruction field, no JSON response mode, no search
 * grounding and no thinking control, so every request to it is reshaped (see
 * capabilitiesOf) and answers are weaker. It is a floor, not a peer.
 */
const GEMINI_FALLBACK_MODELS = (
  process.env.GEMINI_FALLBACK_MODELS ??
  'gemini-3.8-flash,gemini-3.7-flash,gemini-3-flash-preview,gemini-3.5-flash,gemma-4-31b-it'
)
  .split(',')
  .map((m) => m.trim())
  .filter(Boolean);
/**
 * How long the model deliberates before answering: minimal | low | medium | high.
 * Output throughput is this app's bottleneck, so short deliberation is the
 * default. Empty string leaves the model's own default in place.
 */
const GEMINI_THINKING_LEVEL = process.env.GEMINI_THINKING_LEVEL ?? 'low';
const logger = require('../utils/logger.js');
const ApiError = require('../utils/ApiError.js');
const { extractJson } = require('../utils/jsonExtract.js');
const keyring = require('./keyring.service.js');

/**
 * Transport for every Gemini call.
 *
 * The official @google/genai SDK owns the HTTP, retries of its own, streaming
 * frame parsing and the resumable upload protocol. Layered on top of it here is
 * the part the SDK does not provide and this app depends on: a model fallback
 * chain, status-aware backoff, and error messages a learner can act on.
 */

/** Transient failures worth a retry with backoff. */
const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);

/**
 * Statuses where a different model is worth trying instead of giving up.
 * 402 is deliberately absent: depleted credits affect every model on the key,
 * so walking the chain would just add delay before the same failure.
 */
const FALLBACK_WORTHY = new Set([404, 429, 500, 503]);

/**
 * Backoff depends on whether another model is available.
 *
 * Capacity spikes are per-model, so when a fallback exists the fastest route is
 * to switch almost immediately rather than sleep. Waiting the full ladder only
 * makes sense on the last model, when there is nothing else to try.
 */
const backoffMs = (status, attempt, hasSomewhereElse) => {
  if (status !== 503 && status !== 429) return 2 ** attempt * 800;
  if (hasSomewhereElse) return 1200; // one quick retry, then move on
  return [4000, 12000, 30000][attempt] ?? 30000;
};

/**
 * Attempts to spend here before moving on.
 *
 * "Somewhere else" means another model OR another key — waiting out the long
 * ladder only makes sense on the very last option, when there is nothing left
 * to try. Counting models alone used to cost ~46s before the ring was reached.
 */
const attemptsFor = (hasSomewhereElse, retries) => (hasSomewhereElse ? 2 : retries);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** One SDK client per distinct key, so rotation does not rebuild them each call. */
const clients = new Map();
/** Set by tests to bypass both the key ring and the SDK. */
let injectedClient = null;
/**
 * Test seam: builds the client for a given key. Overriding this exercises the
 * real rotation loop while standing in for the SDK, which cannot be patched on
 * its own module object.
 */
let clientFactory = (apiKey) => new GoogleGenAI({ apiKey });

function clientFor(apiKey) {
  if (injectedClient) return injectedClient;
  if (!clients.has(apiKey)) clients.set(apiKey, clientFactory(apiKey));
  return clients.get(apiKey);
}

/**
 * The keys to try for one request, best first.
 *
 * The ring lives in the database and is managed from the UI; the environment
 * key is appended as a last resort so a fresh install works before anything
 * has been configured.
 */
async function resolveKeys() {
  if (injectedClient) return [{ id: null, key: 'injected', label: 'injected' }];

  const keys = await keyring.getUsableKeys();
  if (!keys.length) {
    throw ApiError.internal(
      'No usable Gemini API key. Add one under Settings, or set GEMINI_API_KEY in backend/.env. ' +
        'If your keys are parked, they ran out of credits or hit a rate limit.',
    );
  }
  return keys;
}

/** The SDK reports HTTP status on its ApiError; fall back to duck-typing. */
const statusOf = (err) => {
  if (err instanceof GenAIApiError) return err.status;
  return Number(err?.status ?? err?.code ?? err?.response?.status) || 0;
};

const detailOf = (err) => String(err?.message || '');

/** Turns an upstream failure into something a user can act on. */
function upstreamError(status, detail, model) {
  // Google retires model ids over time; say so plainly instead of leaking a raw
  // 404 that looks like a bug in this app.
  if (status === 404 && /no longer available|not found/i.test(detail)) {
    const suggested = detail.match(/models\/([a-z0-9.-]+) for the latest/i)?.[1];
    return ApiError.upstream(
      `The model "${model}" is no longer available on this API key.` +
        (suggested ? ` Google suggests "${suggested}".` : '') +
        ' Set GEMINI_MODEL in backend/.env to a current model and restart the server.',
    );
  }
  if (status === 402 || /prepayment credits are depleted|billing/i.test(detail)) {
    return ApiError.upstream(
      'Your Gemini prepaid credits are exhausted, so no AI features can run. ' +
        'Top up at aistudio.google.com under Billing (or the API keys page), then try again. ' +
        'Already-generated lessons and banked questions still work in the meantime.',
    );
  }
  if (status === 503) {
    return ApiError.upstream(
      'Gemini is experiencing high demand and none of the configured models responded. ' +
        'This is temporary — please try again in a minute.',
    );
  }
  if (status === 429) {
    return ApiError.upstream(
      'Gemini rate limit reached for this API key. Wait a minute, or check your quota in Google AI Studio.',
    );
  }
  return ApiError.upstream(`Gemini request failed${status ? ` (${status})` : ''}: ${detail.slice(0, 400)}`);
}

/* ------------------------------------------------------------------ */
/* Files                                                               */
/* ------------------------------------------------------------------ */

/**
 * Uploads bytes once and returns a reference to pass into `generate`.
 *
 * Inlining a large PDF works, but it re-sends the whole payload on every retry
 * and pushes the request toward the 20MB body ceiling. A file reference keeps
 * each generate call small, so retries are cheap.
 *
 * Uploaded files are deleted by Google after 48 hours.
 *
 * @returns {Promise<{ uri: string, mimeType: string, name: string }>}
 */
async function uploadFile({ buffer, mimeType = 'application/pdf', displayName = 'upload' }) {
  const [first] = await resolveKeys();
  const ai = clientFor(first.key);

  let file;
  try {
    file = await ai.files.upload({
      file: new Blob([buffer], { type: mimeType }),
      config: { displayName },
    });
  } catch (err) {
    await keyring.reportFailure(first.id, statusOf(err), detailOf(err));
    throw upstreamError(statusOf(err), detailOf(err), GEMINI_MODEL);
  }

  // Large PDFs are processed asynchronously; they cannot be referenced until ACTIVE.
  for (let i = 0; i < 20 && file.state === 'PROCESSING'; i += 1) {
    await sleep(1500);
    try {
      file = await ai.files.get({ name: file.name });
    } catch {
      break;
    }
  }

  if (file.state === 'FAILED') {
    throw ApiError.unprocessable('Gemini could not process this file. It may be corrupt.');
  }
  if (!file.uri) throw ApiError.upstream('Gemini did not return a file reference.');

  logger.info(`Uploaded ${(buffer.length / 1048576).toFixed(1)}MB to Gemini as ${file.name}`);
  return { uri: file.uri, mimeType: file.mimeType || mimeType, name: file.name };
}

/** Best-effort cleanup — Google expires these after 48h anyway. */
async function deleteFile(name) {
  if (!name) return;
  try {
    const [first] = await resolveKeys();
    await clientFor(first.key).files.delete({ name });
  } catch {
    /* it expires on its own */
  }
}

/* ------------------------------------------------------------------ */
/* Request building                                                    */
/* ------------------------------------------------------------------ */

const SAFETY_SETTINGS = [
  'HARM_CATEGORY_HARASSMENT',
  'HARM_CATEGORY_HATE_SPEECH',
  'HARM_CATEGORY_SEXUALLY_EXPLICIT',
  'HARM_CATEGORY_DANGEROUS_CONTENT',
].map((category) => ({ category, threshold: 'BLOCK_ONLY_HIGH' }));

/**
 * What a given model will actually accept.
 *
 * Gemma is served through the same endpoint as Gemini but is a plainer model:
 * it rejects a separate system instruction, a pinned JSON response type, server
 * tools and a thinking budget. Sending any of those turns a working request
 * into a 400, so the request is shaped per model instead.
 *
 * Losing the JSON response type is safe here because `utils/jsonExtract.js`
 * already recovers JSON from fenced or chatty output — that parser was written
 * for grounded calls, which have the same restriction.
 */
function capabilitiesOf(model) {
  const isGemma = /^gemma/i.test(model);
  return {
    systemInstruction: !isGemma,
    jsonMimeType: !isGemma,
    tools: !isGemma,
    thinking: !isGemma,
  };
}

/**
 * Free models draw on a separate allowance from the metered ones.
 *
 * That makes them the one thing still worth trying on a key whose paid quota
 * is gone — a distinction the fallback chain depends on.
 */
const isFreeModel = (model) => /^gemma/i.test(model);

/** Index of the next free model at or after `from`, or -1. */
const nextFreeModelIndex = (models, from) => models.findIndex((m, i) => i >= from && isFreeModel(m));

function buildRequest({
  model,
  prompt,
  system,
  json,
  schema,
  temperature,
  maxOutputTokens,
  history,
  files,
  fileUris,
  grounding,
}) {
  const can = capabilitiesOf(model);

  // A model with no system-instruction field still needs the instruction, so
  // it goes in front of the prompt instead of being dropped.
  const instruction = system && !can.systemInstruction ? `${system}\n\n---\n\n` : '';

  // Documents go before the instruction: the model attends to them, then the task.
  const userParts = [
    ...fileUris.map((f) => ({
      fileData: { mimeType: f.mimeType || 'application/pdf', fileUri: f.uri },
    })),
    ...files.map((f) => ({
      inlineData: { mimeType: f.mimeType || 'application/pdf', data: f.data },
    })),
    { text: `${instruction}${prompt}` },
  ];

  const contents = [
    ...history.map((h) => ({
      role: h.role === 'assistant' ? 'model' : h.role,
      parts: [{ text: h.text ?? h.content ?? '' }],
    })),
    { role: 'user', parts: userParts },
  ];

  // Google Search grounding and a pinned JSON response mime type are mutually
  // exclusive, so a grounded call returns loose text and relies on the parser
  // in utils/jsonExtract.js instead.
  const pinJsonMime = json && !grounding && can.jsonMimeType;
  const useTools = grounding && can.tools;

  const config = {
    temperature,
    topP: 0.95,
    maxOutputTokens,
    safetySettings: SAFETY_SETTINGS,
    ...(system && can.systemInstruction ? { systemInstruction: system } : {}),
    ...(pinJsonMime ? { responseMimeType: 'application/json' } : {}),
    ...(pinJsonMime && schema ? { responseSchema: schema } : {}),
    ...(useTools ? { tools: [{ googleSearch: {} }] } : {}),
    // Flash models reason before answering by default. Output throughput is the
    // bottleneck here, so keep deliberation short unless a caller asks otherwise.
    ...(GEMINI_THINKING_LEVEL && can.thinking
      ? { thinkingConfig: { thinkingLevel: GEMINI_THINKING_LEVEL } }
      : {}),
  };

  return { contents, config };
}

const groundingSourcesOf = (candidate) =>
  (candidate?.groundingMetadata?.groundingChunks || [])
    .map((c) => c.web?.uri)
    .filter(Boolean);

/* ------------------------------------------------------------------ */
/* Generation                                                          */
/* ------------------------------------------------------------------ */

/**
 * Single call to the configured Gemini model, with model fallback.
 *
 * @param {object} opts
 * @param {string} opts.prompt            user turn
 * @param {string} [opts.system]          system instruction
 * @param {boolean} [opts.json]           request application/json back
 * @param {object} [opts.schema]          responseSchema for structured output
 * @param {number} [opts.temperature]
 * @param {number} [opts.maxOutputTokens]
 * @param {Array}  [opts.history]         prior turns: [{ role: 'user'|'model', text }]
 * @param {Array}  [opts.files]           inline documents: [{ mimeType, data (base64) }]
 * @param {Array}  [opts.fileUris]        uploaded documents: [{ mimeType, uri }]
 * @param {boolean} [opts.grounding]      back the answer with Google Search
 * @returns {Promise<{ text: string, model: string, usage: object }>}
 */
async function generate({
  prompt,
  system,
  json = false,
  schema,
  temperature = 0.6,
  maxOutputTokens = 8192,
  history = [],
  files = [],
  fileUris = [],
  grounding = false,
  retries = 4,
} = {}) {
  // The request is shaped per model — Gemma and Gemini accept different
  // fields — so it is built inside the loop rather than once up front.
  const requestFor = (model) =>
    buildRequest({
      model,
      prompt,
      system,
      json,
      schema,
      temperature,
      maxOutputTokens,
      history,
      files,
      fileUris,
      grounding,
    });

  // Capacity spikes hit individual models, not the whole service, so an
  // overloaded primary falls through to the next configured model.
  const models = [GEMINI_MODEL, ...GEMINI_FALLBACK_MODELS].filter(
    (m, i, all) => m && all.indexOf(m) === i,
  );
  const keys = await resolveKeys();

  let lastError;

  // Keys are the outer loop: a billing or quota failure belongs to the key, so
  // there is no point walking the model chain again on a key that cannot pay.
  for (let ki = 0; ki < keys.length; ki += 1) {
    const activeKey = keys[ki];
    const hasAnotherKey = ki < keys.length - 1;
    const ai = clientFor(activeKey.key);
    let tryNextKey = false;

  for (let mi = 0; mi < models.length && !tryNextKey; mi += 1) {
    const model = models[mi];
    const hasFallback = mi < models.length - 1;
    const hasSomewhereElse = hasFallback || hasAnotherKey;
    const maxAttempts = attemptsFor(hasSomewhereElse, retries);
    let tryNextModel = false;

    for (let attempt = 0; attempt < maxAttempts && !tryNextModel && !tryNextKey; attempt += 1) {
      try {
        const { contents, config } = requestFor(model);
        const res = await ai.models.generateContent({ model, contents, config });

        const candidate = res.candidates?.[0];
        if (!candidate) {
          const reason = res.promptFeedback?.blockReason || 'no candidates returned';
          throw ApiError.upstream(`Gemini returned no output (${reason})`);
        }
        if (candidate.finishReason === 'SAFETY') {
          throw ApiError.upstream('Gemini blocked this request for safety reasons.');
        }

        const text = (res.text ?? '').trim();
        if (!text) throw ApiError.upstream('Gemini returned an empty response.');

        if (mi > 0) logger.info(`Served by fallback model ${model}`);
        if (ki > 0) logger.info(`Served by key "${activeKey.label}"`);
        keyring.reportSuccess(activeKey.id);

        return {
          text,
          model,
          key: activeKey.label,
          groundingSources: groundingSourcesOf(candidate),
          finishReason: candidate.finishReason,
          usage: {
            promptTokens: res.usageMetadata?.promptTokenCount || 0,
            outputTokens: res.usageMetadata?.candidatesTokenCount || 0,
            totalTokens: res.usageMetadata?.totalTokenCount || 0,
          },
        };
      } catch (err) {
        // Errors this layer raised deliberately are already final.
        if (err instanceof ApiError) {
          lastError = err;
          throw err;
        }

        const status = statusOf(err);
        const detail = detailOf(err);
        lastError = upstreamError(status, detail, model);

        // Billing, quota and bad-key failures belong to the key, not the model.
        const verdict = keyring.classify(status, detail);
        if (verdict.parks) {
          await keyring.reportFailure(activeKey.id, status, detail);
          if (hasAnotherKey) {
            logger.warn(
              `Key "${activeKey.label}" ${verdict.status}; switching to "${keys[ki + 1].label}"`,
            );
            tryNextKey = true;
            continue;
          }

          // No key left with metered quota. A free model bills against a
          // different allowance, so it is still reachable on this same key —
          // and it is the only thing standing between the learner and a dead
          // app once their quota runs out. Credentials that are simply invalid
          // are excluded: nothing on that key will answer.
          const freeIdx = verdict.status === 'invalid' ? -1 : nextFreeModelIndex(models, mi + 1);
          if (freeIdx !== -1) {
            logger.warn(
              `Key "${activeKey.label}" ${verdict.status}; dropping to the free model ${models[freeIdx]}`,
            );
            mi = freeIdx - 1; // the loop's own increment lands on freeIdx
            tryNextModel = true;
            continue;
          }
          throw lastError;
        }

        if (RETRYABLE.has(status) && attempt < maxAttempts - 1) {
          const wait = backoffMs(status, attempt, hasSomewhereElse);
          logger.warn(`Gemini ${status} on ${model}; retrying in ${(wait / 1000).toFixed(1)}s`);
          await sleep(wait);
          continue;
        }
        if ((FALLBACK_WORTHY.has(status) || status === 0) && hasFallback) {
          logger.warn(`${model} unavailable (${status || err.name}); falling back to ${models[mi + 1]}`);
          tryNextModel = true;
          continue;
        }

        // Every model on this key is exhausted. A 503 is a model-capacity
        // problem rather than a key problem, but another key may be routed to
        // different capacity, so it is worth one try before giving up.
        if (hasAnotherKey) {
          logger.warn(`All models failed on "${activeKey.label}"; trying the next key`);
          tryNextKey = true;
          continue;
        }
        throw lastError;
      }
    }
  }
  }

  throw lastError instanceof ApiError ? lastError : ApiError.upstream('Gemini call failed');
}

/**
 * Streaming generation: yields text chunks as the model writes them.
 *
 * Total time is unchanged, but the learner sees the first words in about a
 * second instead of staring at a spinner until the whole answer exists.
 *
 * Falls through the same model chain as `generate`, but without mid-stream
 * failover: once text has been emitted, switching models would restart the
 * answer in front of the user.
 *
 * @returns {AsyncGenerator<string>}
 */
async function* generateStream({
  prompt,
  system,
  temperature = 0.7,
  maxOutputTokens = 4096,
  history = [],
} = {}) {
  const requestFor = (model) =>
    buildRequest({
      model,
      prompt,
      system,
      json: false,
      temperature,
      maxOutputTokens,
      history,
      files: [],
      fileUris: [],
      grounding: false,
    });

  const models = [GEMINI_MODEL, ...GEMINI_FALLBACK_MODELS].filter(
    (m, i, all) => m && all.indexOf(m) === i,
  );
  const keys = await resolveKeys();

  let lastError;

  // Every (key, model) pair, flattened: a stream has no partial state to lose
  // before its first chunk, so it can move freely across both dimensions.
  const attempts = keys.flatMap((k) => models.map((m) => ({ key: k, model: m })));

  for (const { key: activeKey, model } of attempts) {
    const ai = clientFor(activeKey.key);
    let emitted = false;
    try {
      const { contents, config } = requestFor(model);
      const stream = await ai.models.generateContentStream({ model, contents, config });

      for await (const chunk of stream) {
        const text = chunk.text;
        if (text) {
          emitted = true;
          yield text;
        }
      }

      if (!emitted) throw ApiError.upstream('Gemini returned an empty stream.');
      return;
    } catch (err) {
      // Never restart a stream the learner has already begun reading.
      if (emitted) throw err instanceof ApiError ? err : upstreamError(statusOf(err), detailOf(err), model);

      const status = statusOf(err);
      const detail = detailOf(err);
      lastError = err instanceof ApiError ? err : upstreamError(status, detail, model);

      // Park a key that failed for billing or quota reasons before moving on,
      // so later requests do not start on it again.
      const verdict = keyring.classify(status, detail);
      if (verdict.parks) await keyring.reportFailure(activeKey.id, status, detail);

      if (verdict.parks || FALLBACK_WORTHY.has(status) || status === 0) {
        logger.warn(`Stream unavailable on ${model} via "${activeKey.label}" (${status || err.name})`);
        continue;
      }
      throw lastError;
    }
  }

  throw lastError instanceof ApiError ? lastError : ApiError.upstream('Gemini stream failed');
}

/**
 * JSON-mode generation that recovers from a malformed response.
 *
 * Recovery order matters. Regenerating from the original context yields a
 * complete answer; patching the broken text does not, because a model asked to
 * "fix" a truncated structure will simply close it early and silently drop
 * whatever was missing. Text repair is therefore the last resort, not the first.
 */
async function generateJson(opts) {
  const budget = opts.maxOutputTokens ?? 8192;
  const first = await generate({ ...opts, json: true, temperature: opts.temperature ?? 0.4 });

  try {
    return {
      data: extractJson(first.text),
      usage: first.usage,
      raw: first.text,
      groundingSources: first.groundingSources || [],
    };
  } catch (parseError) {
    const truncated = first.finishReason === 'MAX_TOKENS';
    logger.warn(
      `Gemini JSON parse failed (${truncated ? 'output truncated' : 'malformed'}); regenerating`,
    );

    // 1. Regenerate with the full original context, deterministically — and with
    //    a bigger budget if the first answer was cut off mid-structure.
    const second = await generate({
      ...opts,
      json: true,
      temperature: 0.1,
      maxOutputTokens: truncated ? Math.min(budget * 2, 65536) : budget,
    });

    try {
      return {
        data: extractJson(second.text),
        usage: second.usage,
        raw: second.text,
        groundingSources: second.groundingSources || [],
      };
    } catch {
      logger.warn('Regeneration also failed to parse; attempting text repair');
    }

    // 2. Last resort: hand the model its own broken output. This can lose data,
    //    so it only runs after a clean regeneration has already failed.
    const repair = await generate({
      ...opts,
      json: true,
      temperature: 0.1,
      maxOutputTokens: Math.min(budget * 2, 65536),
      // The repair turn only needs the broken text — never re-send the document.
      files: [],
      fileUris: [],
      prompt: [
        'The following text was supposed to be valid JSON but could not be parsed.',
        'Return ONLY the corrected, valid JSON. No markdown fences, no commentary.',
        'Preserve every field and array element that is present — do not shorten or drop anything.',
        '',
        '--- BROKEN OUTPUT ---',
        second.text.slice(0, 40000),
      ].join('\n'),
    });

    try {
      return { data: extractJson(repair.text), usage: repair.usage, raw: repair.text };
    } catch {
      throw ApiError.upstream(`AI returned unparseable JSON: ${parseError.message}`);
    }
  }
}

/** True when at least one key is configured — env or ring. */
async function isConfigured() {
  if (Boolean(GEMINI_API_KEY)) return true;
  try {
    const keys = await keyring.getUsableKeys({ force: true });
    return keys.length > 0;
  } catch {
    return false;
  }
}

/** Test seam: drop the memoised client so a new key takes effect. */
const resetClient = () => {
  clients.clear();
  injectedClient = null;
  keyring.invalidate();
};

/**
 * Test seam: inject a stand-in for the SDK client.
 *
 * The SDK assigns `models` and `files` as instance properties, so they cannot
 * be patched on the prototype. Injecting the whole client is the honest way to
 * exercise this layer's fallback and error handling without network calls.
 */
const setClient = (stub) => {
  injectedClient = stub;
};

/** Test seam: route each key to a stand-in client. Pass null to restore the SDK. */
const setClientFactory = (factory) => {
  clientFactory = factory || ((apiKey) => new GoogleGenAI({ apiKey }));
  clients.clear();
};

module.exports = {
  capabilitiesOf,
  generate,
  generateStream,
  generateJson,
  uploadFile,
  deleteFile,
  isConfigured,
  resetClient,
  setClient,
  setClientFactory,
};
Object.assign(module.exports, { capabilitiesOf, isConfigured, resetClient, setClient, setClientFactory, uploadFile, deleteFile, generate, generateStream, generateJson });
