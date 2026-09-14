const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const config = require('../config');
const logger = require('../utils/logger');

const PYTHON_BIN = process.env.PYTHON_BIN || 'python';
const MAX_STDOUT_BYTES = 64 * 1024 * 1024;

class EngineError extends Error {
  constructor(message, code = 'EngineError') {
    super(message);
    this.name = 'EngineError';
    this.code = code;
    this.isEngine = true;
  }
}

function killTree(proc) {
  if (proc.killed || proc.exitCode !== null) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      proc.kill('SIGKILL');
    }
  } catch (_) { /* best effort */ }
}

/**
 * Invokes the Python analysis engine via its JSON CLI.
 * stderr is logged, stdout is parsed as JSON. Raw Python output never leaks
 * to the caller. The request file is fully written BEFORE the process starts.
 */
async function runEngine(args, options = {}) {
  const { timeoutMs = config.engineTimeoutMs, inputJson = null } = options;
  const cliArgs = [...args];
  let tempPath = null;

  if (inputJson) {
    tempPath = path.join(os.tmpdir(), `ai-ba-request-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    await fs.promises.writeFile(tempPath, JSON.stringify(inputJson), { mode: 0o600 });
    cliArgs.push('--request', tempPath);
  }

  try {
    return await new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const proc = spawn(PYTHON_BIN, ['-m', 'engine.cli', ...cliArgs], {
        cwd: path.resolve(config.pythonEnginePath),
        env: {
          ...process.env,
          STORAGE_PATH: path.resolve(config.storagePath),
          MAX_FILE_SIZE: String(config.maxFileSize),
          MAX_ROWS: String(config.maxRows),
          LOG_LEVEL: process.env.ENGINE_LOG_LEVEL || 'WARNING',
          PYTHONIOENCODING: 'utf-8',
          PYTHONUTF8: '1',
        },
        windowsHide: true,
      });

      const stdoutChunks = [];
      let stdoutBytes = 0;
      let stderr = '';
      let settled = false;

      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn(value);
      };

      const timer = setTimeout(() => {
        killTree(proc);
        finish(reject, new EngineError('The analysis took too long and was stopped. Try a smaller file or a narrower question.', 'EngineTimeout'));
      }, timeoutMs);

      proc.stdout.on('data', (d) => {
        stdoutBytes += d.length;
        if (stdoutBytes > MAX_STDOUT_BYTES) {
          killTree(proc);
          finish(reject, new EngineError('The analysis produced too much output.', 'EngineOutputTooLarge'));
          return;
        }
        stdoutChunks.push(d);
      });
      proc.stderr.on('data', (d) => {
        stderr += d.toString();
        if (stderr.length > 20000) stderr = stderr.slice(-20000);
      });

      proc.on('error', (err) => {
        logger.error({ err: err.message }, 'python engine could not be started');
        finish(reject, new EngineError('The analysis engine is not available.', 'EngineUnavailable'));
      });

      proc.on('close', (code) => {
        const stdout = Buffer.concat(stdoutChunks).toString('utf8');
        const durationMs = Date.now() - startedAt;
        let parsed = null;
        try {
          parsed = JSON.parse(stdout);
        } catch (_) {
          parsed = null;
        }
        if (stderr.trim()) logger.debug({ stderr: stderr.slice(-2000) }, 'python-engine stderr');

        if (code !== 0) {
          if (parsed && parsed.error && parsed.error.message) {
            logger.info({ code: parsed.error.code, durationMs }, 'python engine returned an error');
            finish(reject, new EngineError(parsed.error.message, parsed.error.code || 'EngineError'));
            return;
          }
          logger.error({ code, durationMs, stderr: stderr.slice(-2000) }, 'python engine failed');
          finish(reject, new EngineError('The analysis engine could not complete the operation.'));
          return;
        }
        if (!parsed || parsed.ok !== true) {
          logger.error({ durationMs, stdout: stdout.slice(0, 500) }, 'python engine returned an invalid response');
          finish(reject, new EngineError('The analysis engine returned an invalid response.'));
          return;
        }
        logger.info({ durationMs, command: args[0] }, 'python engine ok');
        finish(resolve, parsed.data);
      });
    });
  } finally {
    if (tempPath) fs.promises.unlink(tempPath).catch(() => {});
  }
}

module.exports = {
  EngineError,
  inspectFile(filePath) {
    return runEngine(['inspect', '--file', filePath]);
  },
  preview(filePath, { sheet, offset = 0, limit = 50 } = {}) {
    const args = ['preview', '--file', filePath, '--offset', String(offset), '--limit', String(limit)];
    if (sheet) args.push('--sheet', sheet);
    return runEngine(args);
  },
  analyze(request) {
    return runEngine(['analyze'], { inputJson: request });
  },
};
