require('dotenv').config();

const int = (v, d) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
};

const isProd = process.env.NODE_ENV === 'production';

const config = {
  env: process.env.NODE_ENV || 'development',
  isProd,
  port: int(process.env.PORT, 4000),
  databaseUrl: process.env.DATABASE_URL,
  redisUrl: process.env.REDIS_URL,

  // LLM
  llmProvider: process.env.LLM_PROVIDER || 'ollama',
  ollamaUrl: process.env.OLLAMA_URL,
  qwenModel: process.env.QWEN_MODEL || process.env.LLM_MODEL,
  llmBaseUrl: process.env.LLM_BASE_URL,
  llmModel: process.env.LLM_MODEL || process.env.QWEN_MODEL,
  llmApiKey: process.env.LLM_API_KEY || process.env.OLLAMA_API_KEY,
  llmTimeoutMs: int(process.env.LLM_TIMEOUT_MS, 120000),
  llmNumCtx: int(process.env.LLM_NUM_CTX, 8192),
  planAttempts: int(process.env.PLAN_ATTEMPTS, 3),

  // Auth
  secretKey: process.env.SECRET_KEY,
  tokenTtl: process.env.TOKEN_TTL || '12h',

  // Storage / engine
  storagePath: process.env.STORAGE_PATH || './storage',
  pythonEnginePath: process.env.PYTHON_ENGINE_PATH || '../python_engine',
  engineTimeoutMs: int(process.env.ENGINE_TIMEOUT_MS, 180000),
  maxFileSize: int(process.env.MAX_FILE_SIZE, 104857600),
  maxFilesPerAnalysis: int(process.env.MAX_FILES_PER_ANALYSIS, 20),
  maxRows: int(process.env.MAX_ROWS, 1000000),

  corsOrigin: (process.env.CORS_ORIGIN || 'http://localhost:5173').split(',').map((s) => s.trim()),
  trustProxy: process.env.TRUST_PROXY === 'true',
  runWorkers: process.env.RUN_WORKERS !== 'false',
  analysisConcurrency: int(process.env.ANALYSIS_CONCURRENCY, 2),
};

function validateConfig() {
  const missing = ['databaseUrl', 'redisUrl', 'secretKey'].filter((k) => !config[k]);
  if (config.llmProvider === 'openai') {
    if (!config.llmBaseUrl) missing.push('llmBaseUrl (LLM_BASE_URL)');
    if (!config.llmModel) missing.push('llmModel (LLM_MODEL)');
  } else {
    if (!config.ollamaUrl) missing.push('ollamaUrl (OLLAMA_URL)');
    if (!config.qwenModel) missing.push('qwenModel (QWEN_MODEL)');
  }
  if (missing.length) {
    throw new Error(`Missing required configuration: ${missing.join(', ')}`);
  }
  if (isProd && (!config.secretKey || config.secretKey.length < 32 || /your-very-secret/i.test(config.secretKey))) {
    throw new Error('SECRET_KEY must be a strong random value of at least 32 characters in production.');
  }
}

config.validate = validateConfig;
module.exports = config;
