const fs = require('fs');
const path = require('path');
const config = require('../config');
const { Report, Project, Analysis, Dataset } = require('../models');
const { reportQueue } = require('../workers/queue');
const { BadRequestError, NotFoundError } = require('../utils/errors');
const logger = require('../utils/logger');

const FORMATS = ['pdf', 'xlsx', 'docx'];
const MIME = {
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

function reportDir() {
  const dir = path.join(path.resolve(config.storagePath), 'reports');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function safeFilename(name, ext) {
  const base = String(name || 'report').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'report';
  return `${base}.${ext}`;
}

exports.FORMATS = FORMATS;

exports.requestGeneration = async ({ projectId, name, format, analysisIds, userId, organizationId }) => {
  const project = await Project.findOwnedById({ userId, organizationId, projectId });
  if (!project) throw new NotFoundError('Project not found');
  if (!FORMATS.includes(format)) throw new BadRequestError('Choose PDF, Excel or Word as the report format.');

  const completed = await Analysis.listCompletedByIds({ projectId, analysisIds });
  if (!completed.length) {
    throw new BadRequestError(analysisIds && analysisIds.length
      ? 'None of the selected analyses have completed results.'
      : 'Run at least one analysis before generating a report.');
  }

  const version = await Report.nextVersion(projectId);
  const report = await Report.create({
    projectId,
    name: (name && name.trim()) || `${project.name} Report`,
    format,
    version,
    createdBy: userId,
    analysisIds: analysisIds && analysisIds.length ? analysisIds : null,
  });

  await reportQueue.add(
    'generate-report',
    { reportId: report.id, projectId, format, userId, organizationId },
    { jobId: report.id, attempts: 2, backoff: { type: 'fixed', delay: 3000 }, removeOnComplete: 500, removeOnFail: 500 },
  );
  return { reportId: report.id, status: 'queued', version, name: report.name, format };
};

exports.generate = async ({ reportId, projectId, format, userId, organizationId }) => {
  const report = await Report.findOwnedById({ projectId, reportId, userId, organizationId });
  if (!report) throw new NotFoundError('Report not found');

  try {
    const analyses = await Analysis.listCompletedByIds({ projectId, analysisIds: report.analysis_ids });
    if (!analyses.length) throw new BadRequestError('There are no completed analyses to include in the report.');
    const datasets = await Dataset.listByProject({ projectId, userId, organizationId });

    const content = {
      reportId,
      projectId,
      version: report.version,
      name: report.name,
      datasets: [...new Set(analyses.map((a) => a.dataset_name).filter(Boolean))],
      analyses: analyses.map((a) => ({
        id: a.id,
        question: a.question,
        dataset_name: a.dataset_name,
        plan: a.plan,
        results: a.results,
        explanation: a.explanation,
      })),
      datasetSummary: datasets.filter((d) => d.status === 'ready').map((d) => ({ name: d.name, rows: d.metadata?.row_count })),
    };

    const storagePath = path.join(reportDir(), `${reportId}.${format}`);
    const renderer = require('../reports/renderer');
    const impl = { pdf: renderer.PDF, xlsx: renderer.Xlsx, docx: renderer.Docx }[format];
    if (!impl) throw new BadRequestError('Unsupported report format.');
    await impl.renderToFile(storagePath, content, report);

    const { size } = await fs.promises.stat(storagePath);
    const updated = await Report.markReady({ id: reportId, storagePath, size });
    logger.info({ reportId, storagePath, size }, 'report generated');
    return updated;
  } catch (err) {
    const message = err.isOperational ? err.message : 'The report could not be generated.';
    await Report.markFailed({ id: reportId, error: message });
    logger.error({ reportId, err: err.message }, 'report generation failed');
    throw err;
  }
};

exports.list = async ({ projectId, userId, organizationId }) => {
  const project = await Project.findOwnedById({ userId, organizationId, projectId });
  if (!project) throw new NotFoundError('Project not found');
  return Report.listByProject({ projectId, userId, organizationId });
};

exports.get = async ({ projectId, reportId, userId, organizationId }) => {
  const report = await Report.findOwnedById({ projectId, reportId, userId, organizationId });
  if (!report) throw new NotFoundError('Report not found');
  return {
    id: report.id, name: report.name, format: report.format, version: report.version, status: report.status,
    error: report.error, size: report.size, created_at: report.created_at, downloadable: Boolean(report.storage_path),
  };
};

exports.downloadInfo = async ({ projectId, reportId, userId, organizationId }) => {
  const report = await Report.findOwnedById({ projectId, reportId, userId, organizationId });
  if (!report) throw new NotFoundError('Report not found');
  if (!report.storage_path) throw new NotFoundError(report.status === 'failed' ? 'The report failed to generate.' : 'The report is still being generated.');
  const root = path.resolve(config.storagePath);
  const resolved = path.resolve(report.storage_path);
  if (!resolved.startsWith(root + path.sep)) throw new NotFoundError('Report file not found');
  return { path: resolved, filename: safeFilename(`${report.name}-v${report.version}`, report.format), mime: MIME[report.format] };
};

exports.remove = async ({ projectId, reportId, userId, organizationId }) => {
  const report = await Report.findOwnedById({ projectId, reportId, userId, organizationId });
  if (!report) throw new NotFoundError('Report not found');
  const storagePath = await Report.delete(reportId);
  if (storagePath) {
    const root = path.resolve(config.storagePath);
    const resolved = path.resolve(storagePath);
    if (resolved.startsWith(root + path.sep)) fs.promises.unlink(resolved).catch(() => {});
  }
};
