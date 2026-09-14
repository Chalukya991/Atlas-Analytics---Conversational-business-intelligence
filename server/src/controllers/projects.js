const projectService = require('../services/project');

const ctx = (req) => ({ userId: req.user.id, organizationId: req.user.orgId });

exports.create = async (req, res, next) => {
  try {
    res.status(201).json(await projectService.create({ name: req.body.name, description: req.body.description, ...ctx(req) }));
  } catch (err) {
    next(err);
  }
};

exports.list = async (req, res, next) => {
  try {
    res.json({ projects: await projectService.list(ctx(req)) });
  } catch (err) {
    next(err);
  }
};

exports.get = async (req, res, next) => {
  try {
    res.json(await projectService.get({ ...ctx(req), projectId: req.params.projectId }));
  } catch (err) {
    next(err);
  }
};

exports.update = async (req, res, next) => {
  try {
    res.json(await projectService.update({ ...ctx(req), projectId: req.params.projectId, name: req.body.name, description: req.body.description }));
  } catch (err) {
    next(err);
  }
};

exports.remove = async (req, res, next) => {
  try {
    await projectService.remove({ ...ctx(req), projectId: req.params.projectId });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
};
