const { Router } = require('express');
const mongoose = require('mongoose');
const authRoutes = require('./auth.routes.js');
const documentRoutes = require('./document.routes.js');
const examRoutes = require('./exam.routes.js');
const learningRoutes = require('./learning.routes.js');
const testRoutes = require('./test.routes.js');
const analyticsRoutes = require('./analytics.routes.js');
const roadmapRoutes = require('./roadmap.routes.js');
const mentorRoutes = require('./mentor.routes.js');
const apiKeyRoutes = require('./apikey.routes.js');
const { isConfigured } = require('../services/gemini.service.js');


const router = Router();

router.get('/health', async (_req, res) =>
  res.json({
    success: true,
    service: 'ai-exam-coach-api',
    version: '1.0.0',
    env: process.env.NODE_ENV || 'development',
    database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    ai: (await isConfigured()) ? 'configured' : 'no usable API key',
    time: new Date().toISOString(),
  }),
);

router.use('/auth', authRoutes);
router.use('/documents', documentRoutes);
router.use('/exams', examRoutes);
router.use('/learning', learningRoutes);
router.use('/tests', testRoutes);
router.use('/analytics', analyticsRoutes);
router.use('/roadmap', roadmapRoutes);
router.use('/mentor', mentorRoutes);
router.use('/keys', apiKeyRoutes);

module.exports = router;
