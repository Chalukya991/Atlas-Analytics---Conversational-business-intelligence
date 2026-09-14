const fs = require('fs');
const path = require('path');
const config = require('../config');
const { v4: uuidv4 } = require('uuid');
const { File, Dataset, Project } = require('../models');
const pythonEngine = require('../analysis/pythonEngine');
const { inspectQueue } = require('../workers/queue');
const logger = require('../utils/logger');
const { BadRequestError, NotFoundError, ForbiddenError } = require('../utils/errors');

const SUPPORTED_EXTENSIONS = ['.csv', '.tsv', '.txt', '.xlsx', '.xls', '.xlsm', '.xlsb', '.ods'];
const MAX_SHEETS_PER_FILE = 20;

function storageRoot() {
  const root = path.resolve(config.storagePath);
  for (const dir of ['uploads', 'reports', 'tmp', 'cache']) {
    fs.mkdirSync(path.join(root, dir), { recursive: true });
  }
  return root;
}

function safeUnlink(p) {
  if (!p) return;
  fs.promises.unlink(p).catch(() => {});
}

/** Prevent path traversal: every stored path must live under the storage root. */
function assertInsideStorage(p) {
  const root = storageRoot();
  const resolved = path.resolve(p);
  if (!resolved.startsWith(root + path.sep)) throw new ForbiddenError('Invalid storage path.');
  return resolved;
}

exports.upload = async ({ file, projectId, userId, organizationId }) => {
  if (!file) throw new BadRequestError('Choose a file to upload.');

  const ext = path.extname(file.originalname || '').toLowerCase();
  if (!SUPPORTED_EXTENSIONS.includes(ext)) {
    safeUnlink(file.path);
    throw new BadRequestError('Unsupported file type. Upload a CSV, TSV or Excel workbook.');
  }
  if (!file.size) {
    safeUnlink(file.path);
    throw new BadRequestError('The uploaded file is empty.');
  }

  const project = await Project.findOwnedById({ userId, organizationId, projectId });
  if (!project) {
    safeUnlink(file.path);
    throw new ForbiddenError('You do not have access to this project');
  }

  const root = storageRoot();
  const destPath = path.join(root, 'uploads', `${uuidv4()}${ext}`);
  try {
    await fs.promises.rename(file.path, destPath);
  } catch (_) {
    await fs.promises.copyFile(file.path, destPath);
    safeUnlink(file.path);
  }

  const stored = await File.create({
    originalName: path.basename(file.originalname).slice(0, 255),
    storagePath: destPath,
    size: file.size,
    mimeType: file.mimetype,
    projectId,
  });

  await inspectQueue.add(
    'inspect-file',
    { fileId: stored.id, storagePath: destPath, projectId, originalName: stored.original_name },
    { jobId: stored.id, attempts: 2, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: 500, removeOnFail: 500 },
  );
  Project.touch(projectId).catch(() => {});
  logger.info({ fileId: stored.id, projectId, size: file.size }, 'file uploaded, inspection queued');
  return { file: stored };
};

exports.list = async ({ projectId, userId, organizationId }) => {
  const project = await Project.findOwnedById({ userId, organizationId, projectId });
  if (!project) throw new ForbiddenError('You do not have access to this project');
  return File.listByProject({ projectId, userId, organizationId });
};

exports.get = async ({ projectId, fileId, userId, organizationId }) => {
  const found = await File.findOwnedByProject({ projectId, fileId, userId, organizationId });
  if (!found) throw new NotFoundError('File not found');
  return found;
};

exports.remove = async ({ projectId, fileId, userId, organizationId }) => {
  const found = await File.findOwnedByProject({ projectId, fileId, userId, organizationId });
  if (!found) throw new NotFoundError('File not found');
  const storagePath = await File.delete(fileId);
  if (storagePath) {
    try {
      safeUnlink(assertInsideStorage(storagePath));
    } catch (_) { /* never delete outside storage */ }
  }
  Project.touch(projectId).catch(() => {});
};

exports.datasets = async ({ projectId, userId, organizationId }) => {
  const project = await Project.findOwnedById({ userId, organizationId, projectId });
  if (!project) throw new ForbiddenError('You do not have access to this project');
  return Dataset.listByProject({ projectId, userId, organizationId });
};

exports.preview = async ({ projectId, datasetId, userId, organizationId, offset, limit }) => {
  const dataset = await Dataset.findOwnedById({ projectId, datasetId, userId, organizationId });
  if (!dataset) throw new NotFoundError('Dataset not found');
  if (dataset.status !== 'ready' || !dataset.storage_path) throw new BadRequestError('The dataset is not ready yet.');
  const page = await pythonEngine.preview(dataset.storage_path, {
    sheet: dataset.metadata?.sheet_name,
    offset: Math.max(0, parseInt(offset, 10) || 0),
    limit: Math.min(200, Math.max(1, parseInt(limit, 10) || 50)),
  });
  return { datasetId: dataset.id, name: dataset.name, ...page };
};

/**
 * Worker entry: inspect a stored file and create one dataset per sheet.
 * Failures are recorded on the file (and as a failed dataset row) so the UI
 * can show what went wrong instead of spinning forever.
 */
exports.inspectAndStore = async ({ fileId, storagePath, projectId, originalName }) => {
  try {
    const inspection = await pythonEngine.inspectFile(storagePath);
    const sheets = (inspection.sheets || []).filter((s) => s.row_count > 0 && s.column_count > 0).slice(0, MAX_SHEETS_PER_FILE);
    if (!sheets.length) throw new BadRequestError('The file contains no readable rows. Check that the first sheet has a header row and data.');

    const baseName = originalName || path.basename(storagePath);
    const created = [];
    for (const sheet of sheets) {
      const isCsv = sheet.name === 'default';
      const name = isCsv || sheets.length === 1 ? baseName : `${baseName} · ${sheet.name}`;
      const record = await Dataset.create({
        fileId,
        projectId,
        name,
        metadata: {
          sheet_name: sheet.name,
          sheets: inspection.sheets.map((s) => s.name),
          row_count: sheet.row_count,
          column_count: sheet.column_count,
          merged_ranges: sheet.merged_ranges,
          header_row: sheet.header_row,
          truncated: sheet.truncated,
          issues: sheet.issues,
          preview: sheet.preview,
        },
        columns: sheet.columns,
        statistics: { issues: sheet.issues },
        status: 'ready',
      });
      created.push(record.id);
    }
    await File.setStatus({ id: fileId, status: 'ready' });
    logger.info({ fileId, datasets: created.length }, 'dataset inspection complete');
    return created;
  } catch (err) {
    const message = err.isOperational || err.isEngine ? err.message : 'The file could not be processed.';
    await File.setStatus({ id: fileId, status: 'failed', error: message });
    await Dataset.create({
      fileId, projectId, name: originalName || path.basename(storagePath),
      metadata: {}, columns: [], statistics: {}, status: 'failed', error: message,
    });
    logger.error({ fileId, err: err.message }, 'file inspection failed');
    throw err;
  }
};
