const { Router } = require('express');
const ctrl = require('../controllers/apikey.controller.js');
const { protect, restrictTo } = require('../middleware/auth.js');

const router = Router();

// API keys are the operator's billing, not a learner's setting.
router.use(protect, restrictTo('admin'));

router.get('/', ctrl.listKeys);
router.post('/', ctrl.addKey);
router.patch('/:id', ctrl.updateKey);
router.post('/:id/revive', ctrl.reviveKey);
router.post('/:id/test', ctrl.testKey);
router.delete('/:id', ctrl.removeKey);

module.exports = router;
