const { Router } = require('express');
const ctrl = require('../controllers/session.controller.js');
const { protect } = require('../middleware/auth.js');
const { validate } = require('../middleware/validate.js');
const { aiLimiter } = require('../middleware/rateLimit.js');
const { startQuizSchema, startMockSchema, submitSessionSchema } = require('../validators/schemas.js');

const router = Router();
router.use(protect);

router.post('/quiz', aiLimiter, validate(startQuizSchema), ctrl.startQuiz);
router.post('/mock', aiLimiter, validate(startMockSchema), ctrl.startMock);

router.get('/', ctrl.listSessions);
router.get('/:id', ctrl.getSession);
router.post('/:id/submit', validate(submitSessionSchema), ctrl.submitSession);
router.delete('/:id', ctrl.abandonSession);

module.exports = router;
