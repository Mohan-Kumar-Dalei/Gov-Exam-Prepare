/**
 * Shaping and vetting for a generated previous-year paper.
 *
 * Kept apart from ai.service.js because the vetting here is stricter than
 * anywhere else in the app, and the reason is worth stating once: a question
 * labelled as coming from a real past paper carries an authority an ordinary
 * practice question does not. A learner will trust it, revise it, and assume
 * the marked answer is the official key. So a paper is allowed to come back
 * shorter, or admit that most of it is reconstructed, but it is never allowed
 * to pass off a low-confidence guess as the real thing.
 */
const logger = require('../utils/logger.js');

const arr = (v) => (Array.isArray(v) ? v : []);
const str = (v) => (typeof v === 'string' ? v.trim() : '');
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

/**
 * Confidence floor for a past-paper question.
 *
 * Higher than the practice-question floor on purpose. A shaky practice
 * question wastes a minute; a shaky question presented as the real 2023 paper
 * teaches a wrong fact the learner has no reason to double-check.
 */
const MIN_PAPER_CONFIDENCE = Number(process.env.MIN_PAPER_CONFIDENCE || 75);

/** Normalises one raw question, or returns null when it cannot be trusted. */
function shapeQuestion(q, index) {
  const options = arr(q.options).map(str).filter(Boolean);
  let answerIndex = num(q.answerIndex, -1);

  // Some responses name the answer rather than indexing it.
  if (answerIndex < 0 || answerIndex >= options.length) {
    answerIndex = options.findIndex((o) => o.toLowerCase() === str(q.answer).toLowerCase());
  }
  if (answerIndex < 0 || options.length < 2) return null;

  const question = str(q.question);
  if (!question) return null;

  return {
    questionNumber: num(q.questionNumber, index + 1),
    question,
    options,
    answerIndex,
    answer: options[answerIndex],
    explanation: str(q.explanation),
    subject: str(q.subject),
    topic: str(q.topic),
    marks: num(q.marks, 1),
    // Anything the model did not explicitly mark as recalled is treated as
    // reconstructed. The claim that carries weight is the one that must be
    // made deliberately, not the one that wins by default.
    provenance: q.provenance === 'recalled' ? 'recalled' : 'reconstructed',
    factualConfidence: Math.min(100, Math.max(0, num(q.factualConfidence, 100))),
  };
}

/**
 * Turns a raw model response into a storable paper.
 *
 * @returns {{ questions: object[], sourceBasis: string, dropped: number }}
 */
function shapePaper(data, { year }) {
  const shaped = arr(data?.questions)
    .map(shapeQuestion)
    .filter(Boolean);

  const trusted = shaped.filter((q) => q.factualConfidence >= MIN_PAPER_CONFIDENCE);
  const dropped = shaped.length - trusted.length;

  if (dropped) {
    logger.warn(
      `Previous paper ${year}: dropped ${dropped} question(s) below ${MIN_PAPER_CONFIDENCE}% confidence`,
    );
  }

  // Renumber after dropping, so the learner does not see gaps that look like
  // missing questions from the original paper.
  const questions = trusted.map((q, i) => ({ ...q, questionNumber: i + 1 }));

  const recalled = questions.filter((q) => q.provenance === 'recalled').length;
  logger.info(
    `Previous paper ${year}: ${questions.length} question(s), ${recalled} recalled, ` +
      `${questions.length - recalled} reconstructed`,
  );

  return { questions, sourceBasis: str(data?.sourceBasis), dropped };
}

module.exports = { shapePaper, shapeQuestion, MIN_PAPER_CONFIDENCE };
Object.assign(module.exports, { shapePaper, shapeQuestion, MIN_PAPER_CONFIDENCE });
