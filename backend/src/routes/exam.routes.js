const { Router } = require('express');
const ctrl = require('../controllers/exam.controller.js');
const { protect } = require('../middleware/auth.js');

const router = Router();
router.use(protect);

router.get('/', ctrl.listExams);
router.get('/:id', ctrl.getExam);
router.get('/:id/syllabus', ctrl.getSyllabus);
router.post('/:id/activate', ctrl.setActiveExam);
router.patch('/:id', ctrl.updateExam);
router.delete('/:id', ctrl.deleteExam);

module.exports = router;
