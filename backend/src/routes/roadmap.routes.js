const { Router } = require('express');
const ctrl = require('../controllers/roadmap.controller.js');
const { protect } = require('../middleware/auth.js');
const { validate } = require('../middleware/validate.js');
const { aiLimiter } = require('../middleware/rateLimit.js');
const { roadmapSchema, roadmapDaySchema } = require('../validators/schemas.js');

const router = Router();
router.use(protect);

router.post('/', aiLimiter, validate(roadmapSchema), ctrl.generate);
router.get('/', ctrl.getRoadmap);
router.get('/today', ctrl.today);
router.patch('/:id/day/:day', validate(roadmapDaySchema), ctrl.markDay);
router.delete('/:id', ctrl.deleteRoadmap);

module.exports = router;
