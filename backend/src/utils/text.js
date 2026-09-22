const slugifyTopic = (s = '') =>
  String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const titleCase = (s = '') =>
  String(s)
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * Stable fingerprint for dedupe: normalised question text.
 *
 * Must keep letters from every script. An ASCII-only filter would reduce an
 * Odia question to an empty string, so every Odia question would collide with
 * every other one and be discarded as a duplicate.
 */
const fingerprint = (s = '') =>
  String(s)
    .toLowerCase()
    .normalize('NFKC')
    // \p{M} keeps Indic vowel signs, which carry meaning and must not be stripped.
    .replace(/[^\p{L}\p{N}\p{M}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 220);

/** Clamp long PDF text so a single prompt stays inside a sane token budget. */
const clampText = (text = '', maxChars = 120000) => {
  const t = String(text).replace(/\u0000/g, '').replace(/[ \t]+/g, ' ');
  if (t.length <= maxChars) return t;
  const head = t.slice(0, Math.floor(maxChars * 0.7));
  const tail = t.slice(-Math.floor(maxChars * 0.3));
  return `${head}\n\n...[TRUNCATED ${t.length - maxChars} CHARACTERS]...\n\n${tail}`;
};

const pct = (num, den) => (den > 0 ? Math.round((num / den) * 1000) / 10 : 0);

const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

module.exports = { slugifyTopic, titleCase, fingerprint, clampText, pct, shuffle };
