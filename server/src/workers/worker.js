const { Worker } = require('bullmq');
const config = require('../config');
const { createWorkerConnection } = require('./queue');
const chatService = require('../services/chat');
const reportService = require('../services/report');
const fileService = require('../services/file');
const logger = require('../utils/logger');

async function processAnalysis(job) {
  const { analysisId, projectId, userId, organizationId, question, datasetId } = job.data;
  logger.info({ jobId: job.id, analysisId }, 'processing analysis job');
  // completeAnalysis records its own failure state; it never throws for user-level errors.
  return chatService.completeAnalysis({ analysisId, projectId, userId, organizationId, question, datasetId });
}

async function processInspect(job) {
  const { fileId, storagePath, projectId, originalName } = job.data;
  logger.info({ jobId: job.id, fileId }, 'processing inspection job');
  return fileService.inspectAndStore({ fileId, storagePath, projectId, originalName });
}

async function processReport(job) {
  const { reportId, projectId, format, userId, organizationId } = job.data;
  logger.info({ jobId: job.id, reportId }, 'processing report job');
  return reportService.generate({ reportId, projectId, format, userId, organizationId });
}

const workers = [
  new Worker('analysis', processAnalysis, { connection: createWorkerConnection(), concurrency: config.analysisConcurrency, lockDuration: 10 * 60 * 1000 }),
  new Worker('reports', processReport, { connection: createWorkerConnection(), concurrency: 1 }),
  new Worker('inspect-file', processInspect, { connection: createWorkerConnection(), concurrency: 2, lockDuration: 5 * 60 * 1000 }),
];

for (const w of workers) {
  w.on('completed', (job) => logger.info({ queue: w.name, jobId: job.id }, 'job completed'));
  w.on('failed', (job, err) => logger.error({ queue: w.name, jobId: job && job.id, err: err.message }, 'job failed'));
  w.on('error', (err) => logger.error({ queue: w.name, err: err.message }, 'worker error'));
}

async function shutdown(signal) {
  logger.info({ signal }, 'workers shutting down');
  await Promise.allSettled(workers.map((w) => w.close()));
  if (require.main === module) process.exit(0);
}

if (require.main === module) {
  config.validate();
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  logger.info('worker process started');
}

module.exports = { workers, shutdown };
