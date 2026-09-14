/**
 * Numeric grounding for LLM narratives.
 *
 * The explanation layer is only allowed to repeat numbers that exist in the
 * deterministic results (or trivially derive from them: percentages of shares,
 * rounded values, counts of rows). Anything else is removed from highlights or
 * flagged in warnings, so a hallucinated figure never reaches the user as fact.
 */

const YEAR_MIN = 1900;
const YEAR_MAX = 2100;

function collectNumbers(value, out = new Set()) {
  if (value === null || value === undefined) return out;
  if (typeof value === 'number' && Number.isFinite(value)) {
    out.add(value);
    return out;
  }
  if (typeof value === 'string') {
    // Period keys such as "2024-03" or "2024-Q1" contribute their components.
    const parts = value.match(/-?\d+(?:\.\d+)?/g);
    if (parts && value.length <= 12) parts.forEach((p) => out.add(Number(p)));
    return out;
  }
  if (Array.isArray(value)) {
    out.add(value.length);
    value.forEach((v) => collectNumbers(v, out));
    return out;
  }
  if (typeof value === 'object') {
    Object.values(value).forEach((v) => collectNumbers(v, out));
  }
  return out;
}

/** Build the set of values a narrative may legitimately mention. */
function allowedNumbers(results) {
  const base = collectNumbers(results);
  const allowed = new Set();
  for (const n of base) {
    allowed.add(n);
    allowed.add(Math.round(n));
    allowed.add(Math.round(n * 100) / 100);
    // Shares and change ratios are usually reported as percentages.
    if (Math.abs(n) <= 10) {
      allowed.add(n * 100);
      allowed.add(Math.round(n * 100));
      allowed.add(Math.round(n * 1000) / 10);
    }
    // Large numbers get reported in thousands / millions.
    if (Math.abs(n) >= 1000) {
      allowed.add(n / 1000);
      allowed.add(Math.round(n / 1000));
      allowed.add(Math.round(n / 100) / 10);
    }
    if (Math.abs(n) >= 1e6) {
      allowed.add(n / 1e6);
      allowed.add(Math.round(n / 1e6));
      allowed.add(Math.round(n / 1e5) / 10);
      allowed.add(Math.round(n / 1e4) / 100);
    }
  }
  return allowed;
}

function parseNumberToken(token) {
  const cleaned = token.replace(/[,$€£₹%]/g, '').replace(/\s+/g, '');
  const m = cleaned.match(/^(-?\d+(?:\.\d+)?)([kKmMbB])?$/);
  if (!m) return null;
  let n = Number(m[1]);
  const suffix = (m[2] || '').toLowerCase();
  if (suffix === 'k') n *= 1e3;
  if (suffix === 'm') n *= 1e6;
  if (suffix === 'b') n *= 1e9;
  return Number.isFinite(n) ? n : null;
}

function extractNumberTokens(text) {
  if (!text) return [];
  // Numbers with optional currency, thousands separators, decimals, %, k/m/b suffix.
  const re = /[-$€£₹]?\d[\d,]*(?:\.\d+)?\s?(?:%|[kKmMbB]\b)?/g;
  return (text.match(re) || []).map((t) => t.trim());
}

function isClose(a, b) {
  if (a === b) return true;
  const tol = Math.max(Math.abs(b) * 0.01, 0.51); // 1 % or rounding to integer
  return Math.abs(a - b) <= tol;
}

function isGrounded(n, allowed, questionNumbers) {
  if (Number.isInteger(n) && n >= YEAR_MIN && n <= YEAR_MAX) return true; // years / periods
  if (Number.isInteger(n) && n >= 0 && n <= 12) return true; // ordinals, months, small counts
  if (questionNumbers.has(n)) return true;
  for (const a of allowed) {
    if (isClose(n, a)) return true;
  }
  return false;
}

function ungroundedIn(text, allowed, questionNumbers) {
  const out = [];
  for (const token of extractNumberTokens(text)) {
    const n = parseNumberToken(token);
    if (n === null) continue;
    if (!isGrounded(n, allowed, questionNumbers)) out.push(token);
  }
  return out;
}

/**
 * Validate and sanitize an explanation object in place.
 * Returns { explanation, removed: [...], flagged: [...] }.
 */
function groundExplanation(explanation, results, question = '') {
  const allowed = allowedNumbers(results);
  const questionNumbers = new Set(extractNumberTokens(question).map(parseNumberToken).filter((n) => n !== null));
  const removed = [];
  const flagged = [];

  const out = { ...explanation };
  out.highlights = (Array.isArray(out.highlights) ? out.highlights : [])
    .filter((h) => typeof h === 'string' && h.trim())
    .filter((h) => {
      const bad = ungroundedIn(h, allowed, questionNumbers);
      if (bad.length) {
        removed.push({ text: h, numbers: bad });
        return false;
      }
      return true;
    });

  out.kpis = (Array.isArray(out.kpis) ? out.kpis : [])
    .filter((k) => k && typeof k === 'object' && k.label !== undefined && k.value !== undefined)
    .filter((k) => {
      const bad = ungroundedIn(String(k.value), allowed, questionNumbers);
      if (bad.length) {
        removed.push({ text: `${k.label}: ${k.value}`, numbers: bad });
        return false;
      }
      return true;
    })
    .slice(0, 6);

  if (typeof out.summary === 'string') {
    const bad = ungroundedIn(out.summary, allowed, questionNumbers);
    if (bad.length) flagged.push(...bad);
  } else {
    out.summary = '';
  }

  out.warnings = Array.isArray(out.warnings) ? out.warnings.filter((w) => typeof w === 'string' && w.trim()) : [];
  out.suggested_questions = (Array.isArray(out.suggested_questions) ? out.suggested_questions : [])
    .filter((q) => typeof q === 'string' && q.trim())
    .slice(0, 4);

  if (flagged.length) {
    out.warnings.unshift('Some figures in the summary could not be verified against the computed results; rely on the table and KPIs below.');
  }
  out.grounded = flagged.length === 0 && removed.length === 0;
  return { explanation: out, removed, flagged };
}

module.exports = { groundExplanation, allowedNumbers, extractNumberTokens, parseNumberToken, collectNumbers };
