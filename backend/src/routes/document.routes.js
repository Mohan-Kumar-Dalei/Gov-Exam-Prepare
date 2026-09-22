const { Router } = require('express');
const ctrl = require('../controllers/document.controller.js');
const { protect } = require('../middleware/auth.js');
const { handlePdfUpload } = require('../middleware/upload.js');
const { uploadLimiter, aiLimiter } = require('../middleware/rateLimit.js');

const router = Router();
router.use(protect);

router.post('/upload', uploadLimiter, handlePdfUpload, ctrl.uploadAndAnalyze);
router.post('/:id/reanalyze', aiLimiter, ctrl.reanalyze);

router.get('/:id/status', ctrl.getStatus);
router.get('/', ctrl.listDocuments);
router.get('/:id', ctrl.getDocument);
router.get('/:id/text', ctrl.getDocumentText);
router.delete('/:id', ctrl.deleteDocument);

module.exports = router;
