/**
 * LLM output hardening.
 * Gemini is asked for `application/json`, but fenced blocks, prose preambles and
 * trailing commas still leak through often enough to be worth defending against.
 */

const stripFences = (text) =>
  text
    .replace(/^\uFEFF/, '')
    .replace(/```(?:json|JSON)?\s*/g, '')
    .replace(/```/g, '')
    .trim();

/** Returns the first balanced {...} or [...] slice, ignoring braces inside strings. */
function sliceBalanced(text) {
  const start = text.search(/[[{]/);
  if (start === -1) return null;

  const open = text[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

const repair = (text) =>
  text
    .replace(/,\s*([}\]])/g, '$1') // trailing commas
    .replace(/[\u201C\u201D]/g, '"') // smart quotes
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\bNaN\b/g, 'null')
    .replace(/\bUndefined\b|\bundefined\b/g, 'null');

/**
 * @param {string} raw model text
 * @returns {any} parsed JSON
 * @throws {SyntaxError} when nothing parseable is present
 */
function extractJson(raw) {
  if (raw == null) throw new SyntaxError('Empty model response');
  if (typeof raw === 'object') return raw;

  const cleaned = stripFences(String(raw));
  const candidates = [cleaned, sliceBalanced(cleaned), repair(cleaned)].filter(Boolean);
  const balancedRepaired = sliceBalanced(repair(cleaned));
  if (balancedRepaired) candidates.push(balancedRepaired);

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      /* try the next candidate */
    }
  }
  throw new SyntaxError(`Model did not return valid JSON: ${cleaned.slice(0, 300)}`);
}

/** Never throws — returns `fallback` when parsing fails. */
function safeExtractJson(raw, fallback = null) {
  try {
    return extractJson(raw);
  } catch {
    return fallback;
  }
}

module.exports = extractJson;
Object.assign(module.exports, { extractJson, safeExtractJson });
