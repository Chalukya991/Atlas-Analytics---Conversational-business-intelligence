const { Queue } = require('bullmq');
const IORedis = require('ioredis');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * BullMQ requires that a Worker use a dedicated Redis connection (its blocking
 * loops cannot share a connection used for other commands).
 */
function createWorkerConnection() {
  const conn = new IORedis(config.redisUrl, { maxRetriesPerRequest: null, enableReadyCheck: false });
  conn.on('error', (err) => logger.error({ err: err.message }, 'redis worker connection error'));
  return conn;
}

const connection = new IORedis(config.redisUrl, { maxRetriesPerRequest: null, enableReadyCheck: false });
connection.on('error', (err) => logger.error({ err: err.message }, 'redis queue connection error'));

const defaultJobOptions = { removeOnComplete: 1000, removeOnFail: 1000 };

const analysisQueue = new Queue('analysis', { connection, defaultJobOptions });
const reportQueue = new Queue('reports', { connection, defaultJobOptions });
const inspectQueue = new Queue('inspect-file', { connection, defaultJobOptions });

for (const q of [analysisQueue, reportQueue, inspectQueue]) {
  q.on('error', (err) => logger.error({ queue: q.name, err: err.message }, 'queue error'));
}

async function closeQueues() {
  await Promise.allSettled([analysisQueue.close(), reportQueue.close(), inspectQueue.close()]);
  connection.disconnect();
}

module.exports = { analysisQueue, reportQueue, inspectQueue, createWorkerConnection, closeQueues, connection };
