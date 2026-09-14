const config = require('../config');
const { provider, LLMError } = require('../llm');
const { groundExplanation } = require('../llm/grounding');
const { Analysis, Dataset, Project } = require('../models');
const pythonEngine = require('../analysis/pythonEngine');
const {
  OPERATIONS, AGGREGATIONS, FILTER_OPS, PERIODS, OPERATION_DESCRIPTIONS, PLAN_JSON_SCHEMA,
  PlanValidationError, normalizePlan,
} = require('../analysis/planSchema');
const { analysisQueue } = require('../workers/queue');
const { BadRequestError, NotFoundError } = require('../utils/errors');
const logger = require('../utils/logger');

const MAX_QUESTION_LENGTH = 1000;
const RESULT_ROWS_FOR_EXPLANATION = 40;
const REPLANNABLE_CODES = new Set(['InvalidPlanError', 'UnsupportedOperationError', 'PlanValidationError']);

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

function compactColumns(dataset) {
  return (dataset.columns || []).map((c) => {
    const out = { name: c.name, type: c.data_type };
    const samples = (c.sample_values || []).slice(0, 4).map((v) => (typeof v === 'string' ? v.slice(0, 30) : v));
    if (samples.length) out.examples = samples;
    if (c.currency) out.currency = c.currency;
    if (c.is_percent) out.percent = true;
    if (c.stats && c.data_type === 'number') out.range = [c.stats.min, c.stats.max];
    if (c.stats && c.data_type === 'date') out.range = [c.stats.min, c.stats.max];
    if (c.distinct_estimate !== undefined) out.distinct = c.distinct_estimate;
    return out;
  });
}

function buildDatasetContext(dataset) {
  return {
    name: dataset.name,
    rows: dataset.metadata?.row_count ?? null,
    columns: compactColumns(dataset),
    issues: (dataset.statistics && dataset.statistics.issues) || dataset.metadata?.issues || [],
  };
}

const FEW_SHOT = [
  {
    q: 'What is the total revenue by region?',
    plan: { operation: 'aggregate', group_by: ['Region'], metrics: [{ agg: 'sum', column: 'Revenue', label: 'total_revenue' }], filters: [] },
  },
  {
    q: 'Top 5 customers by number of orders in 2024',
    plan: { operation: 'top', group_by: ['Customer'], metrics: [{ agg: 'count', column: null, label: 'orders' }], limit: 5, order: 'desc',
      filters: [{ column: 'Order Date', op: 'between', value: ['2024-01-01', '2024-12-31'] }] },
  },
  {
    q: 'How did monthly sales trend last year?',
    plan: { operation: 'time_series', date_column: 'Order Date', period: 'month', metrics: [{ agg: 'sum', column: 'Sales', label: 'sales' }], filters: [] },
  },
  {
    q: 'How did the amount trend by month?',
    plan: { operation: 'time_series', date_column: 'Order Date', period: 'month', metrics: [{ agg: 'sum', column: 'Amount', label: 'total_amount' }], filters: [] },
  },
  {
    q: 'How many orders per month?',
    plan: { operation: 'time_series', date_column: 'Order Date', period: 'month', metrics: [{ agg: 'count', column: null, label: 'orders' }], filters: [] },
  },
  {
    q: 'Compare North and South on average deal size',
    plan: { operation: 'compare', compare: { column: 'Region', left: 'North', right: 'South' }, metrics: [{ agg: 'avg', column: 'Deal Size', label: 'avg_deal_size' }], filters: [] },
  },
  {
    q: 'Breakdown of orders by status',
    plan: { operation: 'distribution', group_by: ['Status'], limit: 15, filters: [] },
  },
  {
    q: 'What does this data contain?',
    plan: { operation: 'describe' },
  },
];

function plannerSystemPrompt() {
  return [
    'You are the analysis planner inside a business analytics product. Translate ONE business question into ONE JSON analysis plan.',
    'Rules:',
    '- Use column names EXACTLY as listed in the dataset metadata. Never invent columns or numbers. Never write code.',
    `- "operation" must be one of: ${OPERATIONS.join(', ')}.`,
    ...OPERATIONS.map((op) => `    * ${op}: ${OPERATION_DESCRIPTIONS[op]}`),
    `- "metrics[].agg" must be one of: ${AGGREGATIONS.join(', ')}. Use {"agg":"count","column":null} to count rows.`,
    `- "filters[].op" must be one of: ${FILTER_OPS.join(', ')}. Dates in filters use ISO format YYYY-MM-DD.`,
    `- "period" (time_series only) must be one of: ${PERIODS.join(', ')}.`,
    '- For "top", put the column to rank in group_by and the ranking metric first in metrics. Use order "asc" for lowest/worst.',
    '- For "compare", fill compare.column plus compare.left and compare.right with the two values to compare.',
    '- Prefer a numeric column for sum/avg/min/max/median/std. Text columns can only be counted.',
    '- ALWAYS include a metric for aggregate, top, time_series and compare. When the question names a numeric column ("amount trend", "sales by month") use sum of that column, not a row count. Only count rows when the question asks "how many".',
    '- If the question is a follow-up ("now by month", "same for South"), reuse the previous plan and modify it.',
    '- Add a one-sentence "reasoning" field explaining the mapping from question to plan.',
    'Examples:',
    ...FEW_SHOT.map((ex) => `Q: ${ex.q}\nA: ${JSON.stringify(ex.plan)}`),
    'Return ONLY the JSON object.',
  ].join('\n');
}

function plannerUserPrompt({ question, datasetContext, history }) {
  const parts = ['Dataset metadata:', JSON.stringify(datasetContext)];
  if (history && history.length) {
    parts.push('', 'Previous questions in this conversation (oldest first):');
    for (const h of history) {
      parts.push(`- Q: ${h.question}\n  plan: ${JSON.stringify(h.plan)}${h.summary ? `\n  answer: ${h.summary.slice(0, 200)}` : ''}`);
    }
  }
  parts.push('', `User question: ${question}`);
  return parts.join('\n');
}

function explainerSystemPrompt() {
  return [
    'You are the explanation layer of a business analytics product, writing for a business user.',
    'You receive the question, the executed plan and the deterministic computed results.',
    'Rules:',
    '- Use ONLY numbers that appear in the results. Never estimate, extrapolate or invent figures.',
    '- Round sensibly and add units/currency when the metadata gives them.',
    '- If results are empty, say so plainly and suggest how to rephrase.',
    '- Mention data-quality warnings from the results when they could change the interpretation.',
    '- Keep the summary to 2-4 sentences. Highlights are short factual bullets. KPIs are the 2-4 most important single numbers.',
    'Return JSON with exactly this shape:',
    JSON.stringify({
      summary: 'string',
      highlights: ['string'],
      warnings: ['string'],
      suggested_questions: ['string', 'string', 'string'],
      kpis: [{ label: 'string', value: 'string' }],
    }),
    'Return ONLY the JSON object.',
  ].join('\n');
}

/** Trim result payload so it fits the model context and cannot blow up latency. */
function compactResults(results) {
  const out = { ...results };
  delete out.provenance;
  delete out.plan;
  if (Array.isArray(out.results) && out.results.length > RESULT_ROWS_FOR_EXPLANATION) {
    out.results = out.results.slice(0, RESULT_ROWS_FOR_EXPLANATION);
    out.results_note = `showing first ${RESULT_ROWS_FOR_EXPLANATION} of ${results.results.length} rows`;
  }
  if (out.kind === 'describe' && out.results && Array.isArray(out.results.column_profiles)) {
    out.results = {
      ...out.results,
      column_profiles: out.results.column_profiles.slice(0, 40).map((c) => ({
        name: c.name, data_type: c.data_type, fill_rate: c.fill_rate, distinct: c.distinct, issues: c.issues,
      })),
    };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Deterministic plan repair: the model often forgets the metric on trend/top
// questions. If the question names a numeric column, aggregate that column
// instead of silently counting rows.
// ---------------------------------------------------------------------------

function guessAggregation(question) {
  const q = question.toLowerCase();
  if (/\b(average|avg|mean)\b/.test(q)) return 'avg';
  if (/\b(median)\b/.test(q)) return 'median';
  if (/\b(max|maximum|highest|largest|biggest)\b/.test(q) && !/\b(top|rank)\b/.test(q)) return 'max';
  if (/\b(min|minimum|lowest|smallest)\b/.test(q) && !/\b(top|bottom|rank)\b/.test(q)) return 'min';
  if (/\b(how many|number of|count of)\b/.test(q)) return 'count';
  return 'sum';
}

function inferMissingMetric(plan, question, datasetContext) {
  if (!['aggregate', 'top', 'time_series', 'compare'].includes(plan.operation)) return plan;
  const hasRealMetric = (plan.metrics || []).some((m) => m.column);
  const agg = guessAggregation(question);
  if (hasRealMetric || agg === 'count') return plan;
  const q = ` ${question.toLowerCase().replace(/[^a-z0-9$%]+/g, ' ')} `;
  const numeric = (datasetContext.columns || []).filter((c) => c.type === 'number');
  const named = numeric.filter((c) => {
    const words = c.name.toLowerCase().replace(/[^a-z0-9$%]+/g, ' ').trim();
    return words && q.includes(` ${words} `);
  });
  const column = (named.length === 1 ? named[0] : named.sort((a, b) => b.name.length - a.name.length)[0]) || null;
  if (!column) return plan;
  return { ...plan, metrics: [{ agg, column: column.name }], repaired: true };
}

// ---------------------------------------------------------------------------
// Deterministic fallback explanation (used when the LLM fails)
// ---------------------------------------------------------------------------

function fmt(n) {
  if (n === null || n === undefined) return 'n/a';
  if (typeof n !== 'number') return String(n);
  if (Math.abs(n) >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function buildFallbackExplanation(results) {
  const warnings = (results.warnings || []).map((w) => w.message);
  const kpis = [];
  let summary = 'The analysis completed.';
  const highlights = [];
  const rows = Array.isArray(results.results) ? results.results : [];

  switch (results.kind) {
    case 'scalar_aggregation':
      for (const [k, v] of Object.entries(results.results || {})) kpis.push({ label: k.replace(/_/g, ' '), value: fmt(v) });
      summary = kpis.length ? `${kpis.map((k) => `${k.label}: ${k.value}`).join('; ')} across ${fmt(results.filtered_rows)} rows.` : summary;
      break;
    case 'grouped_aggregation':
    case 'top_n': {
      const metric = results.rank_metric || (results.metrics || [])[0];
      const group = (results.group_by || [])[0];
      if (rows.length && metric && group) {
        const first = rows[0];
        summary = `${rows.length} ${group} groups computed. Highest ${metric.replace(/_/g, ' ')}: ${first[group]} (${fmt(first[metric])}).`;
        if (rows.length > 1) highlights.push(`Lowest shown: ${rows[rows.length - 1][group]} (${fmt(rows[rows.length - 1][metric])}).`);
        kpis.push({ label: `Top ${group}`, value: String(first[group]) });
        kpis.push({ label: metric.replace(/_/g, ' '), value: fmt(first[metric]) });
      } else summary = 'No groups matched the question.';
      break;
    }
    case 'time_series': {
      const metric = (results.metrics || [])[0];
      if (rows.length && metric) {
        const first = rows[0];
        const last = rows[rows.length - 1];
        summary = `${metric.replace(/_/g, ' ')} moved from ${fmt(first[metric])} in ${first.period} to ${fmt(last[metric])} in ${last.period} over ${rows.length} ${results.period}s.`;
        const peak = rows.reduce((a, b) => ((b[metric] ?? -Infinity) > (a[metric] ?? -Infinity) ? b : a), rows[0]);
        highlights.push(`Peak: ${peak.period} (${fmt(peak[metric])}).`);
        kpis.push({ label: 'Latest', value: fmt(last[metric]) }, { label: 'Peak period', value: peak.period });
      } else summary = 'No dated rows were found for this question.';
      break;
    }
    case 'comparison': {
      const c = results.compare || {};
      for (const r of rows) {
        const pct = r.change_pct === null || r.change_pct === undefined ? '' : ` (${(r.change_pct * 100).toFixed(1)}%)`;
        highlights.push(`${r.metric.replace(/_/g, ' ')}: ${c.left} ${fmt(r.left)} vs ${c.right} ${fmt(r.right)}, difference ${fmt(r.difference)}${pct}.`);
      }
      summary = `Compared ${c.left} with ${c.right} on ${c.column}.`;
      if (rows[0]) kpis.push({ label: String(c.left), value: fmt(rows[0].left) }, { label: String(c.right), value: fmt(rows[0].right) });
      break;
    }
    case 'distribution': {
      if (rows.length) {
        const top = rows[0];
        summary = results.mode === 'histogram'
          ? `Values of ${results.column} range from ${fmt(results.summary?.min)} to ${fmt(results.summary?.max)} with a median of ${fmt(results.summary?.median)}.`
          : `${results.distinct} distinct values in ${results.column}. Most common: ${top.value} (${fmt(top.count)} rows, ${(top.share * 100).toFixed(1)}%).`;
        kpis.push({ label: 'Rows', value: fmt(results.total) });
      } else summary = 'The column has no values to summarize.';
      break;
    }
    case 'describe': {
      const r = results.results || {};
      summary = `The dataset has ${fmt(r.rows)} rows and ${fmt(r.columns)} columns.`;
      kpis.push({ label: 'Rows', value: fmt(r.rows) }, { label: 'Columns', value: fmt(r.columns) });
      break;
    }
    default:
      break;
  }
  return { summary, highlights, warnings, suggested_questions: [], kpis, grounded: true, generated_by: 'deterministic' };
}

// ---------------------------------------------------------------------------
// Planning loop: LLM -> normalize -> engine; feed errors back and retry.
// ---------------------------------------------------------------------------

async function planAndExecute({ question, dataset, datasetKey, history, onStage }) {
  const datasetContext = buildDatasetContext(dataset);
  const system = plannerSystemPrompt();
  let user = plannerUserPrompt({ question, datasetContext, history });
  const attempts = [];

  for (let attempt = 1; attempt <= config.planAttempts; attempt += 1) {
    await onStage('planning');
    let plan;
    try {
      const raw = await provider.completeJson(
        [{ role: 'system', content: system }, { role: 'user', content: user }],
        { schema: PLAN_JSON_SCHEMA, temperature: attempt === 1 ? 0.1 : 0.3, maxTokens: 700 },
      );
      plan = inferMissingMetric(normalizePlan(raw), question, datasetContext);
      if (plan.repaired) logger.info({ attempt, metrics: plan.metrics }, 'plan metric inferred from question');
    } catch (err) {
      if (err instanceof PlanValidationError || (err instanceof LLMError && !err.retryable)) {
        attempts.push({ attempt, error: err.message });
        logger.info({ attempt, err: err.message }, 'plan rejected before execution');
        user += `\n\nYour previous plan was rejected: ${err.message} Return a corrected JSON plan.`;
        continue;
      }
      throw err;
    }

    await onStage('computing');
    try {
      const data = await pythonEngine.analyze({
        plan: { ...plan, dataset: datasetKey },
        datasets: [{ sheet_name: datasetKey, path: dataset.storage_path }],
      });
      return { plan: data.plan || plan, results: data, attempts: attempts.length + 1, reasoning: plan.reasoning };
    } catch (err) {
      if (err.isEngine && REPLANNABLE_CODES.has(err.code)) {
        attempts.push({ attempt, error: err.message });
        logger.info({ attempt, err: err.message }, 'plan rejected by engine, re-planning');
        user += `\n\nYour previous plan ${JSON.stringify(plan)} was rejected by the data engine: ${err.message} Return a corrected JSON plan that only uses the listed columns.`;
        continue;
      }
      throw err;
    }
  }
  const last = attempts[attempts.length - 1];
  throw new BadRequestError(
    `I could not turn that question into a valid analysis. ${last ? last.error : ''} Try naming the column you mean.`.trim(),
  );
}

async function explain({ question, plan, results, datasetContext }) {
  try {
    const raw = await provider.completeJson(
      [
        { role: 'system', content: explainerSystemPrompt() },
        {
          role: 'user',
          content: [
            `User question: ${question}`,
            `Dataset columns: ${JSON.stringify(datasetContext.columns.map((c) => ({ name: c.name, type: c.type, currency: c.currency, percent: c.percent })))}`,
            `Executed plan: ${JSON.stringify(plan)}`,
            `Computed results: ${JSON.stringify(compactResults(results))}`,
          ].join('\n'),
        },
      ],
      { temperature: 0.2, maxTokens: 900 },
    );
    const { explanation, removed, flagged } = groundExplanation(raw, results, question);
    if (removed.length || flagged.length) {
      logger.warn({ removed: removed.length, flagged }, 'explanation contained ungrounded numbers');
    }
    // Always surface engine warnings to the user, de-duplicated.
    const engineWarnings = (results.warnings || []).map((w) => w.message);
    explanation.warnings = [...new Set([...engineWarnings, ...explanation.warnings])].slice(0, 6);
    explanation.generated_by = 'llm';
    if (!explanation.summary) explanation.summary = buildFallbackExplanation(results).summary;
    return explanation;
  } catch (err) {
    logger.warn({ err: err.message }, 'explanation generation failed, using deterministic fallback');
    return buildFallbackExplanation(results);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

exports.askQuestion = async ({ projectId, userId, organizationId, question, datasetId }) => {
  const q = typeof question === 'string' ? question.trim() : '';
  if (!q) throw new BadRequestError('Ask a question about your data.');
  if (q.length > MAX_QUESTION_LENGTH) throw new BadRequestError(`Questions are limited to ${MAX_QUESTION_LENGTH} characters.`);

  const project = await Project.findOwnedById({ userId, organizationId, projectId });
  if (!project) throw new NotFoundError('Project not found');

  const datasets = await Dataset.listByProject({ projectId, userId, organizationId });
  const ready = datasets.filter((d) => d.status === 'ready');
  if (!ready.length) throw new BadRequestError('Upload a CSV or Excel file and wait for it to finish processing before asking questions.');

  let active;
  if (datasetId) {
    active = ready.find((d) => d.id === datasetId);
    if (!active) throw new BadRequestError('The selected dataset is not ready or does not belong to this project.');
  } else {
    active = ready[0];
  }

  const analysis = await Analysis.create({ projectId, datasetId: active.id, question: q, status: 'queued' });
  await analysisQueue.add(
    'analyze',
    { analysisId: analysis.id, projectId, userId, organizationId: organizationId || null, question: q, datasetId: active.id },
    { jobId: analysis.id, attempts: 1, removeOnComplete: 500, removeOnFail: 500 },
  );
  Project.touch(projectId).catch(() => {});
  return { analysisId: analysis.id, status: 'queued', datasetId: active.id };
};

exports.completeAnalysis = async ({ analysisId, projectId, userId, organizationId, question, datasetId }) => {
  const onStage = (stage) => Analysis.setStage(analysisId, stage);
  await onStage('planning');
  const startedAt = Date.now();

  try {
    const dataset = await Dataset.findById(datasetId);
    if (!dataset || dataset.project_id !== projectId) throw new NotFoundError('Dataset not found');
    if (!dataset.storage_path) throw new BadRequestError('The dataset source file is no longer available.');
    const datasetKey = dataset.metadata?.sheet_name || 'default';

    const historyRows = await Analysis.recentCompleted({ projectId, datasetId, limit: 5 });
    const history = historyRows.map((h) => ({
      question: h.question,
      plan: h.plan?.plan ? stripPlan(h.plan.plan) : null,
      summary: h.explanation?.summary || '',
    })).filter((h) => h.plan);

    const { plan, results, attempts, reasoning } = await planAndExecute({ question, dataset, datasetKey, history, onStage });

    await onStage('explaining');
    const explanation = await explain({ question, plan, results, datasetContext: buildDatasetContext(dataset) });

    await Analysis.updateResult({
      id: analysisId,
      plan: { validated: true, plan: stripPlan(plan), attempts, reasoning: reasoning || null, model: config.qwenModel || config.llmModel },
      results,
      explanation,
      status: 'completed',
      stage: 'completed',
      error: null,
    });
    logger.info({ analysisId, attempts, durationMs: Date.now() - startedAt, kind: results.kind }, 'analysis completed');
    return { analysisId, status: 'completed' };
  } catch (err) {
    const message = err.isOperational || err.isEngine || err instanceof LLMError
      ? err.message
      : 'I could not complete this analysis. Please try again or rephrase the question.';
    await Analysis.updateResult({
      id: analysisId,
      explanation: { summary: '', highlights: [], warnings: [], suggested_questions: [], kpis: [], error: message },
      status: 'failed',
      stage: 'failed',
      error: message,
    });
    logger.error({ analysisId, err: err.message, stack: err.isOperational ? undefined : err.stack }, 'analysis failed');
    return { analysisId, status: 'failed', error: message };
  }
};

function stripPlan(plan) {
  if (!plan) return plan;
  const { reasoning, repaired, ...rest } = plan;
  return rest;
}

exports.getAnalysis = async ({ projectId, analysisId, userId, organizationId }) => Analysis.findOwnedById({ projectId, analysisId, userId, organizationId });

exports.listAnalyses = async ({ projectId, userId, organizationId, includeResults }) => {
  const project = await Project.findOwnedById({ userId, organizationId, projectId });
  if (!project) throw new NotFoundError('Project not found');
  return Analysis.listByProject({ projectId, userId, organizationId, includeResults });
};

exports.deleteAnalysis = async ({ projectId, analysisId, userId, organizationId }) => {
  const found = await Analysis.findOwnedById({ projectId, analysisId, userId, organizationId });
  if (!found) throw new NotFoundError('Analysis not found');
  await Analysis.delete(analysisId);
};

/** Flatten a result payload to CSV rows for export. */
exports.resultsToCsv = (results) => {
  const escape = (v) => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  let columns = [];
  let rows = [];
  if (results.kind === 'scalar_aggregation') {
    columns = Object.keys(results.results || {});
    rows = [results.results || {}];
  } else if (results.kind === 'describe') {
    columns = ['name', 'data_type', 'fill_rate', 'distinct'];
    rows = results.results?.column_profiles || [];
  } else {
    rows = Array.isArray(results.results) ? results.results : [];
    columns = (results.columns || Object.keys(rows[0] || {})).filter((c) => !String(c).startsWith('_'));
  }
  const lines = [columns.map(escape).join(',')];
  for (const r of rows) lines.push(columns.map((c) => escape(r[c])).join(','));
  return lines.join('\n');
};

exports._internal = { buildFallbackExplanation, compactResults, plannerSystemPrompt, plannerUserPrompt, inferMissingMetric, guessAggregation };
