const multer = require('multer');
const path = require('path');
const fs = require('fs');
const fileService = require('../services/file');
const config = require('../config');
const { BadRequestError } = require('../utils/errors');

const uploadDir = path.resolve(config.storagePath, 'tmp');
fs.mkdirSync(uploadDir, { recursive: true });

const ALLOWED_EXT = new Set(['.csv', '.tsv', '.txt', '.xlsx', '.xls', '.xlsm', '.xlsb', '.ods']);

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}`),
  }),
  limits: { fileSize: config.maxFileSize, files: 1 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (!ALLOWED_EXT.has(ext)) return cb(new BadRequestError('Unsupported file type. Upload a CSV, TSV or Excel workbook.'));
    return cb(null, true);
  },
});

exports.uploadMiddleware = upload.single('file');

const ctx = (req) => ({ projectId: req.params.projectId, userId: req.user.id, organizationId: req.user.orgId });

exports.upload = async (req, res, next) => {
  try {
    const result = await fileService.upload({ file: req.file, ...ctx(req) });
    res.status(201).json(result);
  } catch (err) {
    if (req.file && req.file.path) fs.unlink(req.file.path, () => {});
    next(err);
  }
};

exports.list = async (req, res, next) => {
  try {
    res.json({ files: await fileService.list(ctx(req)) });
  } catch (err) {
    next(err);
  }
};

exports.remove = async (req, res, next) => {
  try {
    await fileService.remove({ ...ctx(req), fileId: req.params.fileId });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
};

exports.datasets = async (req, res, next) => {
  try {
    res.json({ datasets: await fileService.datasets(ctx(req)) });
  } catch (err) {
    next(err);
  }
};

exports.preview = async (req, res, next) => {
  try {
    res.json(await fileService.preview({ ...ctx(req), datasetId: req.params.datasetId, offset: req.query.offset, limit: req.query.limit }));
  } catch (err) {
    next(err);
  }
};
