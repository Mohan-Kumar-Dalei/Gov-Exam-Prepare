const crypto = require('node:crypto');
const asyncHandler = require('../utils/asyncHandler.js');
const ApiError = require('../utils/ApiError.js');
const { ok } = require('../utils/apiResponse.js');
const { ChatMessage, Roadmap } = require('../models/index.js');
const { loadOwnedExam } = require('./exam.controller.js');
const { learnerSnapshot } = require('../services/analytics.service.js');
const { askMentor, askMentorStream } = require('../services/ai.service.js');
const logger = require('../utils/logger.js');
const { normaliseLanguage } = require('../config/languages.js');

/** How many prior turns are replayed to the model. */
const HISTORY_TURNS = 10;

/**
 * Follow-ups and action buttons, computed from the learner's own data.
 *
 * Asking the model for these would mean either a JSON envelope (which cannot be
 * streamed usefully) or a second round trip. Both cost the learner seconds for
 * something we can derive exactly.
 */
function deriveAffordances({ snapshot, todayPlan }) {
  const weakest = snapshot.weakTopics?.[0];
  const todayTopic = todayPlan?.studyTopics?.[0];

  const actions = [];
  if (todayTopic) {
    actions.push({
      label: `Study ${todayTopic.topic}`,
      type: 'study',
      subject: todayTopic.subject,
      topic: todayTopic.topic,
    });
  }
  if (weakest) {
    actions.push({
      label: `Drill ${weakest.topic}`,
      type: 'quiz',
      subject: weakest.subject,
      topic: weakest.topic,
    });
  }
  if (todayPlan?.mockTest) {
    actions.push({ label: 'Take today\'s mock', type: 'mock', subject: '', topic: '' });
  }
  actions.push({ label: 'Open roadmap', type: 'roadmap', subject: '', topic: '' });

  const suggestions = [
    'What should I study today?',
    weakest ? `Why am I weak in ${weakest.topic}?` : 'Which topics should I start with?',
    'Am I on track to clear this exam?',
    'Give me a plan for this week.',
  ];

  return {
    actions: actions.slice(0, 4),
    suggestions,
    focusTopics: (snapshot.weakTopics || []).slice(0, 3).map((t) => t.topic),
  };
}

/** Builds the full mentor context once, shared by the streaming and JSON routes. */
async function buildMentorContext(req, examId, convId) {
  const exam = await loadOwnedExam(req.user._id, examId);

  const [snapshot, roadmap, priorTurns] = await Promise.all([
    learnerSnapshot({ userId: req.user._id, exam }),
    Roadmap.findOne({ user: req.user._id, exam: exam._id, isActive: true }).lean(),
    ChatMessage.find({ user: req.user._id, conversationId: convId })
      .sort({ createdAt: -1 })
      .limit(HISTORY_TURNS)
      .lean(),
  ]);

  let todayPlan = null;
  if (roadmap) {
    const day = Math.min(
      Math.max(1, Math.floor((Date.now() - new Date(roadmap.startDate).getTime()) / 86400000) + 1),
      roadmap.totalDays,
    );
    const plan = roadmap.days.find((d) => d.day === day);
    todayPlan = {
      day,
      totalDays: roadmap.totalDays,
      studyTopics: plan?.studyTopics || [],
      revisionTopics: plan?.revisionTopics || [],
      quizCount: plan?.quizCount || 0,
      mockTest: plan?.mockTest || false,
      completedDays: roadmap.days.filter((d) => d.completed).length,
    };
  }

  const context = {
    learner: {
      name: req.user.name,
      streak: req.user.streak,
      dailyStudyMinutes: req.user.preferences?.dailyStudyMinutes,
      dailyQuizTarget: req.user.preferences?.dailyQuizTarget,
    },
    ...snapshot,
    todayPlan,
    dateToday: new Date().toISOString().slice(0, 10),
  };

  const history = priorTurns
    .reverse()
    .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', text: m.content }));

  return { exam, context, history, snapshot, todayPlan };
}

/**
 * POST /api/mentor/stream — Server-Sent Events.
 *
 * The learner sees the first words in about a second instead of waiting for the
 * whole reply to be written.
 */
const chatStream = asyncHandler(async (req, res) => {
  const { message, conversationId } = req.body;
  const examId = req.body.examId || req.user.activeExam;
  if (!examId) throw ApiError.badRequest('Upload a notification PDF before chatting with your mentor.');

  const convId = conversationId || crypto.randomUUID();
  const { exam, context, history, snapshot, todayPlan } = await buildMentorContext(
    req,
    examId,
    convId,
  );
  const language = normaliseLanguage(req.body.language, req.user.preferences?.language);
  const affordances = deriveAffordances({ snapshot, todayPlan });

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // stops proxies buffering the stream away
  });

  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  send('start', { conversationId: convId, ...affordances });

  let full = '';
  try {
    for await (const chunk of askMentorStream({ context, question: message, history, language })) {
      full += chunk;
      send('chunk', { text: chunk });
    }
  } catch (err) {
    logger.error('Mentor stream failed', err.message);
    send('error', { message: err.message });
    return res.end();
  }

  send('done', { conversationId: convId });
  res.end();

  // Persist after the stream closes so a slow write never delays the learner.
  ChatMessage.insertMany([
    { user: req.user._id, exam: exam._id, conversationId: convId, role: 'user', content: message },
    {
      user: req.user._id,
      exam: exam._id,
      conversationId: convId,
      role: 'assistant',
      content: full,
      payload: affordances,
    },
  ]).catch((err) => logger.error('Could not save mentor turn', err.message));

  return undefined;
});

/** POST /api/mentor/chat */
const chat = asyncHandler(async (req, res) => {
  const { message, conversationId } = req.body;
  const examId = req.body.examId || req.user.activeExam;
  if (!examId) throw ApiError.badRequest('Upload a notification PDF before chatting with your mentor.');

  const exam = await loadOwnedExam(req.user._id, examId);
  const convId = conversationId || crypto.randomUUID();

  const [snapshot, roadmap, priorTurns] = await Promise.all([
    learnerSnapshot({ userId: req.user._id, exam }),
    Roadmap.findOne({ user: req.user._id, exam: exam._id, isActive: true }).lean(),
    ChatMessage.find({ user: req.user._id, conversationId: convId })
      .sort({ createdAt: -1 })
      .limit(HISTORY_TURNS)
      .lean(),
  ]);

  let todayPlan = null;
  if (roadmap) {
    const day = Math.min(
      Math.max(1, Math.floor((Date.now() - new Date(roadmap.startDate).getTime()) / 86400000) + 1),
      roadmap.totalDays,
    );
    const plan = roadmap.days.find((d) => d.day === day);
    todayPlan = {
      day,
      totalDays: roadmap.totalDays,
      studyTopics: plan?.studyTopics || [],
      revisionTopics: plan?.revisionTopics || [],
      quizCount: plan?.quizCount || 0,
      mockTest: plan?.mockTest || false,
      completedDays: roadmap.days.filter((d) => d.completed).length,
    };
  }

  const context = {
    learner: {
      name: req.user.name,
      streak: req.user.streak,
      dailyStudyMinutes: req.user.preferences?.dailyStudyMinutes,
      dailyQuizTarget: req.user.preferences?.dailyQuizTarget,
    },
    ...snapshot,
    todayPlan,
    dateToday: new Date().toISOString().slice(0, 10),
  };

  const history = priorTurns
    .reverse()
    .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', text: m.content }));

  const language = normaliseLanguage(req.body.language, req.user.preferences?.language);
  const answer = await askMentor({ context, question: message, history, language });

  await ChatMessage.insertMany([
    { user: req.user._id, exam: exam._id, conversationId: convId, role: 'user', content: message },
    {
      user: req.user._id,
      exam: exam._id,
      conversationId: convId,
      role: 'assistant',
      content: answer.reply,
      payload: {
        suggestions: answer.suggestions,
        actions: answer.actions,
        focusTopics: answer.focusTopics,
      },
    },
  ]);

  return ok(res, { conversationId: convId, ...answer });
});

/** GET /api/mentor/conversations */
const listConversations = asyncHandler(async (req, res) => {
  const rows = await ChatMessage.aggregate([
    { $match: { user: req.user._id } },
    { $sort: { createdAt: -1 } },
    {
      $group: {
        _id: '$conversationId',
        lastMessage: { $first: '$content' },
        lastRole: { $first: '$role' },
        updatedAt: { $first: '$createdAt' },
        messages: { $sum: 1 },
      },
    },
    { $sort: { updatedAt: -1 } },
    { $limit: 30 },
    { $project: { _id: 0, conversationId: '$_id', lastMessage: 1, lastRole: 1, updatedAt: 1, messages: 1 } },
  ]);

  return ok(res, rows);
});

/** GET /api/mentor/conversations/:conversationId */
const getConversation = asyncHandler(async (req, res) => {
  const messages = await ChatMessage.find({
    user: req.user._id,
    conversationId: req.params.conversationId,
  })
    .sort({ createdAt: 1 })
    .lean();

  if (!messages.length) throw ApiError.notFound('Conversation not found.');
  return ok(res, { conversationId: req.params.conversationId, messages });
});

/** DELETE /api/mentor/conversations/:conversationId */
const deleteConversation = asyncHandler(async (req, res) => {
  const { deletedCount } = await ChatMessage.deleteMany({
    user: req.user._id,
    conversationId: req.params.conversationId,
  });
  if (!deletedCount) throw ApiError.notFound('Conversation not found.');
  return ok(res, null, 'Conversation deleted.');
});

module.exports = { chat, chatStream, listConversations, getConversation, deleteConversation };
Object.assign(module.exports, { chatStream, chat, listConversations, getConversation, deleteConversation });
