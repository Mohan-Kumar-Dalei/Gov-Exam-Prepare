const SUBJECT_CANON = [
  'General Knowledge',
  'Reasoning',
  'Mathematics',
  'English',
  'Computer Fundamentals',
  'General Awareness',
  'Current Affairs',
  'Quantitative Aptitude',
];

const DIFFICULTIES = ['easy', 'medium', 'hard'];

const QUESTION_TYPES = ['mcq', 'reasoning', 'aptitude', 'gk', 'computer', 'english'];

const SESSION_MODES = ['practice', 'quiz', 'mock', 'adaptive'];

const MASTERY = {
  WEAK: 45,
  AVERAGE: 70,
  STRONG: 85,
};

/** Adaptive weighting: share of a batch devoted to weak topics, by weakness severity. */
const ADAPTIVE_WEIGHTS = {
  critical: 0.8, // accuracy < 40%
  weak: 0.7, // accuracy < 55%
  moderate: 0.5, // accuracy < 70%
  balanced: 0.3, // otherwise
};

const ROADMAP_DAYS = 60;

module.exports = { SUBJECT_CANON, DIFFICULTIES, QUESTION_TYPES, SESSION_MODES, MASTERY, ADAPTIVE_WEIGHTS, ROADMAP_DAYS };
