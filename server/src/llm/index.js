require('dotenv').config();

const config = require('../config');
const logger = require('../utils/logger');

/**
 * LLMProvider abstraction.
 *
 * The rest of the application only depends on this interface:
 *   complete(messages, options)      -> Promise<string>
 *   completeJson(messages, options)  -> Promise<object>   (options.schema = JSON schema)
 *
 * Providers:
 *   - OllamaProvider          (default; /api/chat, supports structured output via "format")
 *   - OpenAICompatibleProvider (/v1/chat/completions; vLLM, LM Studio, Together, OpenAI ...)
 *
 * Select with LLM_PROVIDER=ollama|openai. Both retry transient network errors
 * with exponential backoff and never leak raw provider errors to callers.
 */
class LLMProvider {
  async complete() {
    throw new Error('LLMProvider.complete() not implemented');
  }

  async completeJson() {
    throw new Error('LLMProvider.completeJson() not implemented');
  }
}

class LLMError extends Error {
  constructor(message, { retryable = false, cause } = {}) {
    super(message);
    this.name = 'LLMError';
    this.retryable = retryable;
    if (cause) this.cause = cause;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Extract the first balanced JSON object from free text. */
function extractJsonObject(text) {
  if (!text) return null;
  const cleaned = text.replace(/```(?:json)?/gi, '').trim();
  try {
    const direct = JSON.parse(cleaned);
    if (direct && typeof direct === 'object') return direct;
  } catch (_) { /* fall through */ }

  const start = cleaned.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < cleaned.length; i += 1) {
    const ch = cleaned[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(cleaned.slice(start, i + 1));
        } catch (_) {
          return null;
        }
      }
    }
  }
  return null;
}

async function withRetries(fn, { attempts = 3, baseDelayMs = 500 } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn(i);
    } catch (err) {
      lastErr = err;
      if (!(err instanceof LLMError) || !err.retryable || i === attempts - 1) throw err;
      await sleep(baseDelayMs * 2 ** i);
    }
  }
  throw lastErr;
}

async function fetchWithTimeout(url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (err.name === 'AbortError') throw new LLMError('The AI model took too long to respond.', { retryable: true, cause: err });
    throw new LLMError('The AI model could not be reached.', { retryable: true, cause: err });
  } finally {
    clearTimeout(timer);
  }
}

class OllamaProvider extends LLMProvider {
  constructor({ baseUrl, model, apiKey, timeoutMs = 120000, numCtx = 8192 }) {
    super();
    if (!baseUrl || !model) throw new Error('OllamaProvider requires baseUrl and model');
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.model = model;
    this.apiKey = apiKey;
    this.timeoutMs = timeoutMs;
    this.numCtx = numCtx;
  }

  headers() {
    const h = { 'Content-Type': 'application/json' };
    if (this.apiKey) h.Authorization = `Bearer ${this.apiKey}`;
    return h;
  }

  async request(messages, options) {
    const startedAt = Date.now();
    const body = {
      model: this.model,
      messages,
      stream: false,
      think: false,
      options: {
        temperature: options.temperature ?? 0.1,
        num_ctx: options.numCtx ?? this.numCtx,
        num_predict: options.maxTokens ?? 1500,
      },
    };
    if (options.json) body.format = options.schema || 'json';

    return withRetries(async () => {
      const res = await fetchWithTimeout(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(body),
      }, this.timeoutMs);
      if (res.status === 429 || res.status >= 500) {
        throw new LLMError(`The AI service is temporarily unavailable (HTTP ${res.status}).`, { retryable: true });
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        logger.error({ status: res.status, body: text.slice(0, 500) }, 'ollama error');
        throw new LLMError('The AI service rejected the request.');
      }
      const payload = await res.json();
      logger.info({
        msg: 'llm.complete',
        provider: 'ollama',
        model: this.model,
        durationMs: Date.now() - startedAt,
        promptTokens: payload.prompt_eval_count,
        completionTokens: payload.eval_count,
      });
      return payload.message?.content ?? '';
    });
  }

  complete(messages, options = {}) {
    return this.request(messages, options);
  }

  async completeJson(messages, options = {}) {
    const raw = await this.request(messages, { ...options, json: true });
    const obj = extractJsonObject(raw);
    if (!obj) throw new LLMError('The AI model did not return a valid JSON object.');
    return obj;
  }
}

class OpenAICompatibleProvider extends LLMProvider {
  constructor({ baseUrl, model, apiKey, timeoutMs = 120000 }) {
    super();
    if (!baseUrl || !model) throw new Error('OpenAICompatibleProvider requires baseUrl and model');
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.model = model;
    this.apiKey = apiKey;
    this.timeoutMs = timeoutMs;
  }

  async request(messages, options) {
    const startedAt = Date.now();
    const body = {
      model: this.model,
      messages,
      temperature: options.temperature ?? 0.1,
      max_tokens: options.maxTokens ?? 1500,
    };
    if (options.json) {
      body.response_format = options.schema
        ? { type: 'json_schema', json_schema: { name: 'plan', schema: options.schema } }
        : { type: 'json_object' };
    }
    const headers = { 'Content-Type': 'application/json' };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;

    return withRetries(async () => {
      const res = await fetchWithTimeout(`${this.baseUrl}/chat/completions`, {
        method: 'POST', headers, body: JSON.stringify(body),
      }, this.timeoutMs);
      if (res.status === 429 || res.status >= 500) {
        throw new LLMError(`The AI service is temporarily unavailable (HTTP ${res.status}).`, { retryable: true });
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        logger.error({ status: res.status, body: text.slice(0, 500) }, 'openai-compatible error');
        throw new LLMError('The AI service rejected the request.');
      }
      const payload = await res.json();
      logger.info({
        msg: 'llm.complete',
        provider: 'openai',
        model: this.model,
        durationMs: Date.now() - startedAt,
        promptTokens: payload.usage?.prompt_tokens,
        completionTokens: payload.usage?.completion_tokens,
      });
      return payload.choices?.[0]?.message?.content ?? '';
    });
  }

  complete(messages, options = {}) {
    return this.request(messages, options);
  }

  async completeJson(messages, options = {}) {
    const raw = await this.request(messages, { ...options, json: true });
    const obj = extractJsonObject(raw);
    if (!obj) throw new LLMError('The AI model did not return a valid JSON object.');
    return obj;
  }
}

function createProvider() {
  const kind = (config.llmProvider || 'ollama').toLowerCase();
  if (kind === 'openai') {
    return new OpenAICompatibleProvider({
      baseUrl: config.llmBaseUrl,
      model: config.llmModel,
      apiKey: config.llmApiKey,
      timeoutMs: config.llmTimeoutMs,
    });
  }
  return new OllamaProvider({
    baseUrl: config.ollamaUrl,
    model: config.qwenModel,
    apiKey: config.llmApiKey,
    timeoutMs: config.llmTimeoutMs,
    numCtx: config.llmNumCtx,
  });
}

const provider = createProvider();

module.exports = { LLMProvider, LLMError, OllamaProvider, OpenAICompatibleProvider, provider, extractJsonObject };
