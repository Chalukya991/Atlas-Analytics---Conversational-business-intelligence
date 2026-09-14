const winston = require('winston');

const isProd = process.env.NODE_ENV === 'production';

const base = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json(),
  ),
  defaultMeta: { service: process.env.SERVICE_NAME || 'ai-ba-api' },
  transports: [
    new winston.transports.Console({
      format: isProd
        ? winston.format.json()
        : winston.format.combine(
          winston.format.colorize(),
          winston.format.printf(({ level, message, timestamp, service, ...meta }) => {
            const rest = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
            return `${timestamp} ${level}: ${message}${rest}`;
          }),
        ),
    }),
  ],
});

/**
 * Accept both winston-style `(message, meta)` and pino-style `(meta, message)`
 * calls so structured context is never flattened to "[object Object]".
 */
function normalize(args) {
  const [a, b, ...rest] = args;
  if (a && typeof a === 'object' && !(a instanceof Error)) {
    const meta = a.err instanceof Error ? { ...a, err: a.err.message, stack: a.err.stack } : a;
    if (typeof b === 'string') return [b, meta, ...rest];
    return [meta.msg || meta.message || 'log', meta, ...rest];
  }
  if (a instanceof Error) return [a.message, { stack: a.stack, ...(typeof b === 'object' ? b : {}) }];
  if (b instanceof Error) return [a, { err: b.message, stack: b.stack }, ...rest];
  return args;
}

const logger = {};
for (const level of ['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly']) {
  logger[level] = (...args) => base[level](...normalize(args));
}
logger.child = (meta) => base.child(meta);

module.exports = logger;
