const { Router } = require('express');
const ctrl = require('../controllers/analytics.controller.js');
const { protect } = require('../middleware/auth.js');

const router = Router();
router.use(protect);

router.get('/dashboard', ctrl.dashboard);
router.get('/topics', ctrl.topics);
router.get('/subjects', ctrl.subjects);
router.get('/trend', ctrl.trend);
router.get('/activity', ctrl.activity);
router.get('/readiness', ctrl.readiness);
router.get('/weak-topics', ctrl.weakTopics);
router.get('/exams', ctrl.examSummaries);

module.exports = router;
