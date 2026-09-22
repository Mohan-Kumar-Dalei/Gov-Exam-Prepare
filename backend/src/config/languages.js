/**
 * Output languages for every AI-generated surface: questions, options,
 * explanations, lessons and the mentor.
 *
 * Exam vocabulary stays in English even inside Odia and Hinglish output,
 * because that is how it appears in the real question paper — translating
 * "negative marking" or "Preamble" would actively mislead the learner.
 */

const LANGUAGES = ['en', 'hinglish', 'od'];

const LANGUAGE_LABELS = {
  en: 'English',
  hinglish: 'Hinglish',
  od: 'ଓଡ଼ିଆ (Odia)',
};

const DIRECTIVES = {
  en: `LANGUAGE: English.
Write everything in clear, simple English suitable for a first-time aspirant.
Avoid heavy vocabulary; short sentences are better than impressive ones.`,

  hinglish: `LANGUAGE: Hinglish.
Write in Hinglish — Hindi written in the Roman (Latin) alphabet, mixed naturally with English, the way Indian students actually talk and coaching teachers actually explain.
- NEVER use Devanagari script. Write "kya", not "क्या".
- Keep all exam terminology, subject names, formulas, units, proper nouns and option values in English.
- Natural: "Agar ek number ko 20% badhaya jaye aur phir 20% ghataya jaye, toh net change kya hoga?"
- Unnatural: do not translate technical words into Hindi just to sound more Hindi.`,

  od: `LANGUAGE: Odia (ଓଡ଼ିଆ).
Write in the Odia script. The audience is Odisha-based aspirants who read Odia more comfortably than English.
- Use correct, natural Odia — not a word-by-word translation of English.
- Keep exam terminology, subject names, formulas, units, abbreviations and proper nouns in English (for example: Article 14, MS Excel, COUNT, CBT, Preamble). These appear in English in the real question paper, so translating them would mislead the learner.
- Numbers may stay in Arabic numerals.
- Explanations must be in Odia, not English.`,
};

const isLanguage = (value) => LANGUAGES.includes(value);

const normaliseLanguage = (value, fallback = 'en') =>
  (isLanguage(value) ? value : fallback);

/** The block injected into every prompt that produces learner-facing text. */
const languageDirective = (language = 'en') =>
  DIRECTIVES[normaliseLanguage(language)];

module.exports = { LANGUAGES, LANGUAGE_LABELS, languageDirective, normaliseLanguage, isLanguage };
Object.assign(module.exports, { LANGUAGES, LANGUAGE_LABELS, isLanguage, normaliseLanguage, languageDirective });
