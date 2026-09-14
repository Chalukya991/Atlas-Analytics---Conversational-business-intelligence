const reportService = require('../services/report');

const ctx = (req) => ({ projectId: req.params.projectId, userId: req.user.id, organizationId: req.user.orgId });

exports.generate = async (req, res, next) => {
  try {
    const result = await reportService.requestGeneration({
      ...ctx(req),
      name: req.body.name,
      format: req.body.format || 'pdf',
      analysisIds: req.body.analysisIds,
    });
    res.status(202).json(result);
  } catch (err) {
    next(err);
  }
};

exports.list = async (req, res, next) => {
  try {
    res.json({ reports: await reportService.list(ctx(req)) });
  } catch (err) {
    next(err);
  }
};

exports.get = async (req, res, next) => {
  try {
    res.json(await reportService.get({ ...ctx(req), reportId: req.params.reportId }));
  } catch (err) {
    next(err);
  }
};

exports.download = async (req, res, next) => {
  try {
    const info = await reportService.downloadInfo({ ...ctx(req), reportId: req.params.reportId });
    res.setHeader('Content-Type', info.mime);
    res.download(info.path, info.filename);
  } catch (err) {
    next(err);
  }
};

exports.remove = async (req, res, next) => {
  try {
    await reportService.remove({ ...ctx(req), reportId: req.params.reportId });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
};
