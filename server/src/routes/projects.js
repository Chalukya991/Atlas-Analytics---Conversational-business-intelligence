const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { validateBody, validateParams } = require('../middleware/validate');
const projectsController = require('../controllers/projects');
const filesController = require('../controllers/files');
const chatController = require('../controllers/chat');
const reportsController = require('../controllers/reports');
const { FORMATS } = require('../services/report');

router.use(authenticateToken);

const projectBody = validateBody({
  name: { type: 'string', min: 1, max: 120, label: 'Project name' },
  description: { type: 'string', max: 2000 },
});

router.post('/', validateBody({ name: { type: 'string', required: true, min: 1, max: 120, label: 'Project name' }, description: { type: 'string', max: 2000 } }), projectsController.create);
router.get('/', projectsController.list);
router.get('/:projectId', validateParams(['projectId']), projectsController.get);
router.patch('/:projectId', validateParams(['projectId']), projectBody, projectsController.update);
router.delete('/:projectId', validateParams(['projectId']), projectsController.remove);

router.get('/:projectId/files', validateParams(['projectId']), filesController.list);
router.post('/:projectId/files', validateParams(['projectId']), filesController.uploadMiddleware, filesController.upload);
router.delete('/:projectId/files/:fileId', validateParams(['projectId', 'fileId']), filesController.remove);

router.get('/:projectId/datasets', validateParams(['projectId']), filesController.datasets);
router.get('/:projectId/datasets/:datasetId/preview', validateParams(['projectId', 'datasetId']), filesController.preview);

router.post(
  '/:projectId/chat',
  validateParams(['projectId']),
  validateBody({ question: { type: 'string', required: true, min: 1, max: 1000, label: 'Question' }, datasetId: { type: 'uuid' } }),
  chatController.ask,
);
router.get('/:projectId/analyses', validateParams(['projectId']), chatController.listAnalyses);
router.get('/:projectId/analyses/:analysisId', validateParams(['projectId', 'analysisId']), chatController.getAnalysis);
router.get('/:projectId/analyses/:analysisId/export.csv', validateParams(['projectId', 'analysisId']), chatController.exportCsv);
router.delete('/:projectId/analyses/:analysisId', validateParams(['projectId', 'analysisId']), chatController.deleteAnalysis);

router.get('/:projectId/reports', validateParams(['projectId']), reportsController.list);
router.post(
  '/:projectId/reports',
  validateParams(['projectId']),
  validateBody({
    name: { type: 'string', max: 120 },
    format: { type: 'enum', values: FORMATS, default: 'pdf' },
    analysisIds: { type: 'array', items: 'uuid', max: 100 },
  }),
  reportsController.generate,
);
router.get('/:projectId/reports/:reportId', validateParams(['projectId', 'reportId']), reportsController.get);
router.get('/:projectId/reports/:reportId/download', validateParams(['projectId', 'reportId']), reportsController.download);
router.delete('/:projectId/reports/:reportId', validateParams(['projectId', 'reportId']), reportsController.remove);

module.exports = router;
