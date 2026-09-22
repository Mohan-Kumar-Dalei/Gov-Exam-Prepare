const { Router } = require('express');
const ctrl = require('../controllers/learning.controller.js');
const { protect } = require('../middleware/auth.js');
const { validate } = require('../middleware/validate.js');
const { aiLimiter } = require('../middleware/rateLimit.js');
const { lessonQuerySchema } = require('../validators/schemas.js');

const router = Router();
router.use(protect);

router.get('/:examId/lesson', aiLimiter, validate(lessonQuerySchema, 'query'), ctrl.getLesson);
router.get(
  '/:examId/lesson/stream',
  aiLimiter,
  validate(lessonQuerySchema, 'query'),
  ctrl.getLessonStream,
);
router.post('/:examId/lesson/complete', ctrl.completeLesson);
router.get('/:examId/lessons', ctrl.listLessons);
router.get('/:examId/next', ctrl.nextTopic);

module.exports = router;
