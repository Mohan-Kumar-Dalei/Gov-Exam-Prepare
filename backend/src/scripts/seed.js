/**
 * Seeds a demo account with one fully-formed exam, so the UI can be explored
 * without a Gemini key or a notification PDF.
 *
 *   npm run seed
 *   login: demo@examcoach.dev / demo1234
 *
 * Re-running wipes and recreates the demo user's data only.
 */
// This script is its own entry point, so it loads .env itself.
const { loadEnv } = require('../config/loadEnv.js');

const envFile = loadEnv();

const mongoose = require('mongoose');
const { connectDB, disconnectDB } = require('../config/db.js');
const { User, Exam, Question, Progress, Lesson, Roadmap, TestSession, Document, } = require('../models/index.js');
const { seedProgress } = require('../services/roadmap.service.js');
const { fingerprint } = require('../utils/text.js');
const logger = require('../utils/logger.js');

const DEMO_EMAIL = 'demo@examcoach.dev';
const DEMO_PASSWORD = 'demo1234';

const SYLLABUS = [
  {
    subject: 'General Knowledge',
    weightage: 20,
    topics: [
      { name: 'Indian Polity', importance: 'high', subtopics: ['Constitution', 'Parliament'] },
      { name: 'Indian History', importance: 'medium', subtopics: ['Freedom Struggle'] },
      { name: 'Geography of India', importance: 'medium', subtopics: ['Rivers', 'Climate'] },
      { name: 'Current Affairs', importance: 'high', subtopics: ['National', 'International'] },
    ],
  },
  {
    subject: 'Reasoning',
    weightage: 20,
    topics: [
      { name: 'Coding Decoding', importance: 'high', subtopics: [] },
      { name: 'Blood Relations', importance: 'medium', subtopics: [] },
      { name: 'Series Completion', importance: 'high', subtopics: [] },
      { name: 'Syllogism', importance: 'medium', subtopics: [] },
    ],
  },
  {
    subject: 'Mathematics',
    weightage: 25,
    topics: [
      { name: 'Percentage', importance: 'high', subtopics: [] },
      { name: 'Profit and Loss', importance: 'high', subtopics: [] },
      { name: 'Time and Work', importance: 'medium', subtopics: [] },
      { name: 'Simple and Compound Interest', importance: 'medium', subtopics: [] },
    ],
  },
  {
    subject: 'English',
    weightage: 15,
    topics: [
      { name: 'Synonyms and Antonyms', importance: 'medium', subtopics: [] },
      { name: 'Error Spotting', importance: 'high', subtopics: [] },
      { name: 'Reading Comprehension', importance: 'high', subtopics: [] },
    ],
  },
  {
    subject: 'Computer Fundamentals',
    weightage: 20,
    topics: [
      { name: 'MS Excel', importance: 'high', subtopics: ['Formulas', 'Charts'] },
      { name: 'MS Word', importance: 'medium', subtopics: [] },
      { name: 'Computer Networks', importance: 'medium', subtopics: [] },
      { name: 'Operating Systems', importance: 'low', subtopics: [] },
    ],
  },
];

const SAMPLE_QUESTIONS = [
  {
    subject: 'Computer Fundamentals',
    topic: 'MS Excel',
    question: 'In MS Excel, which function returns the number of cells in a range that contain numbers?',
    options: ['COUNTA', 'COUNT', 'COUNTIF', 'SUM'],
    answerIndex: 1,
    explanation:
      'COUNT counts only numeric entries. COUNTA counts every non-empty cell including text, which is the distractor most people pick.',
    difficulty: 'easy',
    type: 'computer',
  },
  {
    subject: 'Computer Fundamentals',
    topic: 'MS Excel',
    question: 'What does the $ symbol do in the Excel cell reference $B$4?',
    options: [
      'Formats the cell as currency',
      'Makes the reference absolute so it does not shift when copied',
      'Marks the cell as protected',
      'Converts the value to text',
    ],
    answerIndex: 1,
    explanation:
      'A dollar sign locks the column and row, so copying the formula keeps pointing at B4. Currency formatting is applied from the ribbon, not inside a reference.',
    difficulty: 'medium',
    type: 'computer',
  },
  {
    subject: 'Mathematics',
    topic: 'Percentage',
    question: 'If a number is increased by 20% and then decreased by 20%, the net change is:',
    options: ['No change', '4% increase', '4% decrease', '2% decrease'],
    answerIndex: 2,
    explanation:
      'Successive change = 20 - 20 - (20 x 20)/100 = -4. The decrease acts on the larger number, so a 4% net decrease results.',
    difficulty: 'medium',
    type: 'aptitude',
  },
  {
    subject: 'Reasoning',
    topic: 'Coding Decoding',
    question: 'If TEACHER is coded as VGCEJGT, how is STUDENT coded?',
    options: ['UVWFGPV', 'UVWFGVP', 'UWVFGPV', 'UVWGFPV'],
    answerIndex: 0,
    explanation: 'Each letter moves two places forward: S becomes U, T becomes V, and so on.',
    difficulty: 'medium',
    type: 'reasoning',
  },
  {
    subject: 'General Knowledge',
    topic: 'Indian Polity',
    question: 'Which article of the Indian Constitution deals with the Right to Equality?',
    options: ['Article 14', 'Article 19', 'Article 21', 'Article 32'],
    answerIndex: 0,
    explanation:
      'Article 14 guarantees equality before the law. Article 19 covers freedoms, Article 21 life and liberty, Article 32 constitutional remedies.',
    difficulty: 'easy',
    type: 'gk',
  },
  {
    subject: 'English',
    topic: 'Error Spotting',
    question: 'Identify the part containing an error: "Neither of the two answers (A) / are (B) / correct (C) / no error (D)".',
    options: ['A', 'B', 'C', 'D'],
    answerIndex: 1,
    explanation: '"Neither" is singular, so the verb must be "is", not "are".',
    difficulty: 'medium',
    type: 'english',
  },
];

async function run() {
  await connectDB();

  const existing = await User.findOne({ email: DEMO_EMAIL });
  if (existing) {
    logger.info('Removing the previous demo data');
    const scope = { user: existing._id };
    await Promise.all([
      Exam.deleteMany(scope),
      Question.deleteMany(scope),
      Progress.deleteMany(scope),
      Lesson.deleteMany(scope),
      Roadmap.deleteMany(scope),
      TestSession.deleteMany(scope),
      Document.deleteMany(scope),
    ]);
    await existing.deleteOne();
  }

  const user = await User.create({
    name: 'Demo Aspirant',
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
  });

  const exam = await Exam.create({
    user: user._id,
    examName: 'Junior Clerk cum Computer Assistant',
    organization: 'District Court Recruitment Board',
    postName: 'Junior Clerk cum Computer Assistant',
    vacancies: {
      total: 120,
      raw: '120 posts',
      breakdown: [
        { category: 'UR', count: 52 },
        { category: 'OBC', count: 32 },
        { category: 'SC', count: 20 },
        { category: 'ST', count: 16 },
      ],
    },
    eligibility: {
      educational: ['Bachelor degree from a recognised university', 'Basic computer knowledge (DCA or equivalent)'],
      ageLimit: { min: 18, max: 32, relaxation: 'As per government norms', asOnDate: '01-01-2026' },
      nationality: 'Indian',
      other: ['Typing speed of 40 wpm in English'],
    },
    selectionProcess: [
      { stage: 'Written Examination (CBT)', description: 'Objective type, 100 marks' },
      { stage: 'Typing Test', description: 'Qualifying in nature' },
      { stage: 'Document Verification', description: 'Final stage before appointment' },
    ],
    examPattern: {
      mode: 'CBT',
      totalQuestions: 100,
      totalMarks: 100,
      durationMinutes: 90,
      negativeMarking: 0.25,
      sections: [
        { section: 'General Knowledge', questions: 20, marks: 20, durationMinutes: 0, negativeMarking: 0.25 },
        { section: 'Reasoning', questions: 20, marks: 20, durationMinutes: 0, negativeMarking: 0.25 },
        { section: 'Mathematics', questions: 25, marks: 25, durationMinutes: 0, negativeMarking: 0.25 },
        { section: 'English', questions: 15, marks: 15, durationMinutes: 0, negativeMarking: 0.25 },
        { section: 'Computer Fundamentals', questions: 20, marks: 20, durationMinutes: 0, negativeMarking: 0.25 },
      ],
    },
    syllabus: SYLLABUS,
    subjects: SYLLABUS.map((s) => s.subject),
    importantDates: [
      { event: 'Notification released', date: '12 August 2026' },
      { event: 'Online application starts', date: '20 August 2026' },
      { event: 'Last date to apply', date: '18 September 2026' },
      { event: 'Written examination', date: '3rd week of November 2026' },
    ],
    applicationFee: [
      { category: 'General / OBC', amount: 'Rs. 600' },
      { category: 'SC / ST / PwD', amount: 'Rs. 300' },
    ],
    aiConfidence: 100,
    aiNotes: 'Seeded demo data — not extracted from a real notification.',
  });

  user.activeExam = exam._id;
  user.touchStreak();
  await user.save();

  await seedProgress(user._id, exam);

  await Question.insertMany(
    SAMPLE_QUESTIONS.map((q) => ({
      ...q,
      user: user._id,
      exam: exam._id,
      answer: q.options[q.answerIndex],
      fingerprint: fingerprint(q.question),
      language: 'en',
      sourceBasis: 'Seeded sample — standard clerk-level pattern',
      factualConfidence: 100,
      source: 'manual',
    })),
  );

  // Give a couple of topics real history so the adaptive engine has something to
  // weight against on the very first quiz.
  const weakExcel = await Progress.findOne({ user: user._id, exam: exam._id, topic: 'MS Excel' });
  Object.assign(weakExcel, { attempted: 12, correct: 4, wrong: 8, mistakeCount: 8, lastAttemptedAt: new Date() });
  await weakExcel.recompute().save();

  const strongPolity = await Progress.findOne({ user: user._id, exam: exam._id, topic: 'Indian Polity' });
  Object.assign(strongPolity, { attempted: 15, correct: 14, wrong: 1, mistakeCount: 1, lastAttemptedAt: new Date() });
  await strongPolity.recompute().save();

  logger.info('Seed complete');
  logger.info(`  Login with ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
  logger.info(`  Exam: ${exam.examName} (${exam.topicCount} topics)`);
  logger.info('  Set GEMINI_API_KEY in backend/.env to enable lessons, quizzes and the mentor.');

  await disconnectDB();
  await mongoose.disconnect().catch(() => {});
}

run().catch(async (err) => {
  logger.error('Seed failed', err.message);
  await disconnectDB().catch(() => {});
  process.exit(1);
});
