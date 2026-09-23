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

/**
 * Comparison key for a syllabus topic or subject label.
 *
 * Labels reach us from three places that never agree perfectly: the syllabus
 * the analyser extracted, the roadmap the planner wrote, and the tags the
 * question generator attached. "Current Affairs", "current affairs" and
 * "Current Affairs " are the same topic to a learner, so they must be the same
 * topic to a lookup. Built on the same unicode-safe filter as `fingerprint`,
 * for the same reason: an ASCII-only filter would flatten every Odia label to
 * an empty string and make them all collide.
 */
const topicKey = (s = '') =>
  String(s)
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}\p{M}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

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

module.exports = { slugifyTopic, titleCase, fingerprint, topicKey, clampText, pct, shuffle };
