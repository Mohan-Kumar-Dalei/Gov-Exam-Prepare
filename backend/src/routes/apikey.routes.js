const { Router } = require('express');
const ctrl = require('../controllers/apikey.controller.js');
const { protect } = require('../middleware/auth.js');

const router = Router();

// Open to every account: each learner brings their own key and spends their
// own quota, so this is a personal setting rather than an operator one. Each
// handler scopes its work to req.user, so one account can never see, test or
// delete another's key.
router.use(protect);

router.get('/', ctrl.listKeys);
router.post('/', ctrl.addKey);
// Declared before the :id routes so 'env' is not mistaken for an id.
router.post('/env/revive', ctrl.reviveEnvKey);

router.patch('/:id', ctrl.updateKey);
router.post('/:id/revive', ctrl.reviveKey);
router.post('/:id/test', ctrl.testKey);
router.delete('/:id', ctrl.removeKey);

module.exports = router;
