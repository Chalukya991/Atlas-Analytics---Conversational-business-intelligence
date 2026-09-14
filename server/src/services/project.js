const fs = require('fs');
const path = require('path');
const config = require('../config');
const { Project } = require('../models');
const { NotFoundError, ForbiddenError, BadRequestError } = require('../utils/errors');
const logger = require('../utils/logger');

exports.create = async ({ name, description, userId, organizationId }) => {
  if (!name || !name.trim()) throw new BadRequestError('Project name is required');
  return Project.create({ name: name.trim(), description: description ? String(description).trim() : null, userId, organizationId });
};

exports.list = async ({ userId, organizationId }) => Project.findOwned({ userId, organizationId });

exports.get = async ({ userId, organizationId, projectId }) => {
  const project = await Project.findOwnedById({ userId, organizationId, projectId });
  if (!project) throw new NotFoundError('Project not found');
  return project;
};

exports.update = async ({ userId, organizationId, projectId, name, description }) => {
  await exports.get({ userId, organizationId, projectId });
  if (name !== undefined && !String(name).trim()) throw new BadRequestError('Project name cannot be empty');
  return Project.update({ projectId, name: name !== undefined ? String(name).trim() : undefined, description });
};

exports.remove = async ({ userId, organizationId, projectId }) => {
  await exports.get({ userId, organizationId, projectId });
  const paths = await Project.delete(projectId);
  const root = path.resolve(config.storagePath);
  for (const p of paths) {
    const resolved = path.resolve(p);
    if (resolved.startsWith(root + path.sep)) fs.promises.unlink(resolved).catch(() => {});
  }
  logger.info({ projectId, files: paths.length }, 'project deleted');
};

exports.assertAccess = async ({ userId, organizationId, projectId }) => {
  const project = await Project.findOwnedById({ userId, organizationId, projectId });
  if (!project) throw new ForbiddenError('You do not have access to this project');
  return project;
};
