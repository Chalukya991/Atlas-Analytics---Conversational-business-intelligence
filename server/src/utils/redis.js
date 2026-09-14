const IORedis = require('ioredis');
const config = require('../config');
const logger = require('../utils/logger');

let shared = null;

/** Shared, non-blocking Redis connection for small key/value needs. */
function getRedis() {
  if (!shared) {
    shared = new IORedis(config.redisUrl, {
      maxRetriesPerRequest: 2,
      enableReadyCheck: false,
      lazyConnect: false,
    });
    shared.on('error', (err) => logger.error({ err: err.message }, 'redis error'));
  }
  return shared;
}

module.exports = { getRedis };
