const { Router } = require('express');
const ctrl = require('../controllers/previousPaper.controller.js');
const { protect } = require('../middleware/auth.js');
const { validate } = require('../middleware/validate.js');
const { aiLimiter } = require('../middleware/rateLimit.js');
const { previousPaperSchema } = require('../validators/schemas.js');

const router = Router();
router.use(protect);

router.get('/:examId', ctrl.listPapers);
router.get('/:examId/:paperId', ctrl.getPaper);
router.post('/:examId', aiLimiter, validate(previousPaperSchema), ctrl.buildPaper);
router.delete('/:examId/:paperId', ctrl.deletePaper);

module.exports = router;
