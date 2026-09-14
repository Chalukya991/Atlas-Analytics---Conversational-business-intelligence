const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const config = require('./config');
const logger = require('./utils/logger');
const authRoutes = require('./routes/auth');
const projectRoutes = require('./routes/projects');
const db = require('./database');

const app = express();

if (config.trustProxy) app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || config.corsOrigin.includes(origin) || config.corsOrigin.includes('*')) return cb(null, true);
    return cb(new Error('Not allowed by CORS'));
  },
  credentials: false,
  exposedHeaders: ['Content-Disposition'],
}));
app.use(express.json({ limit: '1mb' }));
app.use(morgan(config.isProd ? 'combined' : 'dev', {
  stream: { write: (message) => logger.info(message.trim()) },
  skip: (req) => req.path === '/health',
}));

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: { status: 'error', message: 'Too many requests. Slow down and try again shortly.' },
});
app.use('/api', apiLimiter);

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/projects', projectRoutes);

app.get('/health', async (req, res) => {
  const checks = { db: 'ok', redis: 'ok' };
  try {
    await db.query('SELECT 1');
  } catch (_) {
    checks.db = 'down';
  }
  try {
    const { getRedis } = require('./utils/redis');
    await getRedis().ping();
  } catch (_) {
    checks.redis = 'down';
  }
  const healthy = Object.values(checks).every((v) => v === 'ok');
  res.status(healthy ? 200 : 503).json({ status: healthy ? 'ok' : 'degraded', checks, version: require('../package.json').version });
});

app.use((req, res) => {
  res.status(404).json({ status: 'error', message: 'Route not found' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.isOperational) {
    res.status(err.statusCode).json({ status: 'error', message: err.message });
    return;
  }
  if (err instanceof multer.MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE'
      ? `File is too large. The limit is ${Math.round(config.maxFileSize / 1048576)} MB.`
      : 'The upload could not be processed.';
    res.status(413).json({ status: 'error', message });
    return;
  }
  if (err.message === 'Not allowed by CORS') {
    res.status(403).json({ status: 'error', message: 'Origin not allowed.' });
    return;
  }
  if (err.type === 'entity.parse.failed') {
    res.status(400).json({ status: 'error', message: 'The request body is not valid JSON.' });
    return;
  }
  logger.error({ err: err.message, stack: err.stack, method: req.method, url: req.originalUrl });
  res.status(500).json({ status: 'error', message: 'Something went wrong on our side. Please try again.' });
});

const startServer = async () => {
  try {
    config.validate();
    // Start queue workers in-process for local dev; in production run `npm run worker` separately.
    let workers = null;
    if (config.runWorkers) workers = require('./workers/worker');

    const server = app.listen(config.port, () => {
      logger.info({ port: config.port, env: config.env, workers: Boolean(workers) }, 'API server started');
    });

    const shutdown = async (signal) => {
      logger.info({ signal }, 'shutting down');
      server.close(async () => {
        try {
          if (workers) await workers.shutdown(signal);
          const { closeQueues } = require('./workers/queue');
          await closeQueues();
          await db.end();
        } finally {
          process.exit(0);
        }
      });
      setTimeout(() => process.exit(1), 15000).unref();
    };
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('unhandledRejection', (reason) => logger.error({ reason: reason && reason.message ? reason.message : String(reason) }, 'unhandled rejection'));
  } catch (err) {
    logger.error({ err: err.message }, 'failed to start server');
    process.exit(1);
  }
};

if (require.main === module) {
  startServer();
}

module.exports = app;
