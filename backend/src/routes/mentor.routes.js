const { Router } = require('express');
const ctrl = require('../controllers/mentor.controller.js');
const { protect } = require('../middleware/auth.js');
const { validate } = require('../middleware/validate.js');
const { aiLimiter } = require('../middleware/rateLimit.js');
const { mentorSchema } = require('../validators/schemas.js');

const router = Router();
router.use(protect);

router.post('/chat', aiLimiter, validate(mentorSchema), ctrl.chat);
router.post('/stream', aiLimiter, validate(mentorSchema), ctrl.chatStream);
router.get('/conversations', ctrl.listConversations);
router.get('/conversations/:conversationId', ctrl.getConversation);
router.delete('/conversations/:conversationId', ctrl.deleteConversation);

module.exports = router;
