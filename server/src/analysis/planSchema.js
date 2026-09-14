/**
 * Shared analysis-plan contract.
 *
 * This is the single source of truth (mirrored in python_engine/engine/analysis/plan.py)
 * for what the planner LLM may produce. Node does structural validation and
 * light alias normalization; the Python engine resolves columns and does the
 * semantic validation, returning user-safe messages that can be fed back to
 * the model for a retry.
 */
const OPERATIONS = ['describe', 'aggregate', 'top', 'time_series', 'compare', 'distribution'];
const AGGREGATIONS = ['sum', 'avg', 'min', 'max', 'median', 'count', 'count_unique', 'std'];
const FILTER_OPS = ['eq', 'neq', 'gt', 'lt', 'gte', 'lte', 'contains', 'in', 'not_in', 'between', 'is_null', 'not_null'];
const PERIODS = ['day', 'week', 'month', 'quarter', 'year'];

const OPERATION_DESCRIPTIONS = {
  describe: 'overview of the dataset: rows, columns, types, data quality. Use for "what is in this data", "give me an overview", "what columns are there".',
  aggregate: 'totals/averages/counts, optionally grouped by one or more category columns. Use for "total sales", "average price by category", "how many orders per region".',
  top: 'rank groups by a metric and keep the top/bottom N. Use for "top 5 customers by revenue", "best selling products", "which region has the lowest sales".',
  time_series: 'a metric over time bucketed by day/week/month/quarter/year using a date column. Use for "trend", "over time", "monthly", "growth".',
  compare: 'compare exactly two values of one column side by side with difference and % change. Use for "North vs South", "2023 compared to 2024", "A versus B".',
  distribution: 'frequency of values in a column (or a histogram for numeric columns). Use for "breakdown of status", "how are orders distributed", "spread of prices".',
};

/** JSON schema handed to the model as a structured-output constraint. */
const PLAN_JSON_SCHEMA = {
  type: 'object',
  properties: {
    operation: { type: 'string', enum: OPERATIONS },
    group_by: { type: 'array', items: { type: 'string' } },
    metrics: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          agg: { type: 'string', enum: AGGREGATIONS },
          column: { type: ['string', 'null'] },
          label: { type: 'string' },
        },
        required: ['agg'],
      },
    },
    filters: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          column: { type: 'string' },
          op: { type: 'string', enum: FILTER_OPS },
          value: {},
        },
        required: ['column', 'op'],
      },
    },
    date_column: { type: ['string', 'null'] },
    period: { type: 'string', enum: PERIODS },
    limit: { type: 'integer' },
    order: { type: 'string', enum: ['asc', 'desc'] },
    compare: {
      type: ['object', 'null'],
      properties: {
        column: { type: 'string' },
        left: {},
        right: {},
      },
    },
    reasoning: { type: 'string' },
  },
  required: ['operation'],
};

const AGG_ALIASES = {
  average: 'avg', mean: 'avg', total: 'sum', distinct: 'count_unique', unique: 'count_unique',
  nunique: 'count_unique', count_distinct: 'count_unique', stdev: 'std', stddev: 'std',
};
const OP_ALIASES = {
  '==': 'eq', '=': 'eq', '!=': 'neq', '<>': 'neq', '>': 'gt', '<': 'lt', '>=': 'gte', '<=': 'lte',
  equals: 'eq', not_equals: 'neq', greater_than: 'gt', less_than: 'lt', like: 'contains',
  notin: 'not_in', isnull: 'is_null', notnull: 'not_null', is_not_null: 'not_null',
};
const OPERATION_ALIASES = {
  summarize: 'aggregate', summary: 'aggregate', aggregation: 'aggregate', group: 'aggregate', groupby: 'aggregate',
  rank: 'top', ranking: 'top', top_n: 'top', bottom: 'top',
  trend: 'time_series', timeseries: 'time_series', 'time-series': 'time_series', over_time: 'time_series',
  comparison: 'compare', versus: 'compare',
  frequency: 'distribution', breakdown: 'distribution', histogram: 'distribution',
  overview: 'describe', profile: 'describe', schema: 'describe',
};

class PlanValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PlanValidationError';
  }
}

function asArray(v) {
  if (v === null || v === undefined || v === '') return [];
  return Array.isArray(v) ? v.filter((x) => x !== null && x !== undefined && x !== '') : [v];
}

/**
 * Normalize aliases and coerce shapes. Throws PlanValidationError with a
 * message suitable for feeding back to the model.
 */
function normalizePlan(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new PlanValidationError('The plan must be a JSON object.');
  }
  const plan = { ...input };

  if (typeof plan.operation === 'string') {
    const op = plan.operation.trim().toLowerCase();
    plan.operation = OPERATION_ALIASES[op] || op;
  }
  if (!OPERATIONS.includes(plan.operation)) {
    throw new PlanValidationError(`"operation" must be one of: ${OPERATIONS.join(', ')}.`);
  }

  plan.group_by = asArray(plan.group_by ?? plan.groups).map(String);

  plan.metrics = asArray(plan.metrics).map((m) => {
    if (typeof m === 'string') return { agg: 'sum', column: m };
    if (!m || typeof m !== 'object') throw new PlanValidationError('Each metric must be an object with "agg" and "column".');
    let agg = String(m.agg || m.aggregation || 'sum').toLowerCase();
    agg = AGG_ALIASES[agg] || agg;
    if (!AGGREGATIONS.includes(agg)) {
      throw new PlanValidationError(`Metric aggregation "${agg}" is not allowed. Use one of: ${AGGREGATIONS.join(', ')}.`);
    }
    const column = m.column === '*' || m.column === '' ? null : m.column ?? null;
    if (column === null && agg !== 'count') {
      throw new PlanValidationError(`Metric "${agg}" needs a "column".`);
    }
    return { agg, column, label: typeof m.label === 'string' ? m.label : undefined };
  });

  // Legacy flat fields.
  if (!plan.metrics.length && (plan.metric_column || plan.value_column)) {
    plan.metrics = [{ agg: AGG_ALIASES[plan.agg] || plan.agg || 'sum', column: plan.metric_column || plan.value_column }];
  }
  delete plan.metric_column;
  delete plan.value_column;
  delete plan.agg;

  plan.filters = asArray(plan.filters).map((f) => {
    if (!f || typeof f !== 'object') throw new PlanValidationError('Each filter must be an object with "column", "op" and "value".');
    let op = String(f.op || f.operator || 'eq').toLowerCase();
    op = OP_ALIASES[op] || op;
    if (!FILTER_OPS.includes(op)) {
      throw new PlanValidationError(`Filter operator "${op}" is not allowed. Use one of: ${FILTER_OPS.join(', ')}.`);
    }
    const column = f.column || f.field;
    if (!column) throw new PlanValidationError('Each filter needs a "column".');
    return { column: String(column), op, value: f.value };
  });

  if (plan.date_column === '') plan.date_column = null;
  if (plan.period) {
    const p = String(plan.period).toLowerCase();
    plan.period = { daily: 'day', weekly: 'week', monthly: 'month', quarterly: 'quarter', yearly: 'year', annual: 'year' }[p] || p;
    if (!PERIODS.includes(plan.period)) {
      throw new PlanValidationError(`"period" must be one of: ${PERIODS.join(', ')}.`);
    }
  }
  if (plan.limit !== undefined && plan.limit !== null) {
    const n = Number(plan.limit);
    plan.limit = Number.isFinite(n) ? Math.max(1, Math.min(Math.round(n), 500)) : 10;
  }
  if (plan.order) {
    const o = String(plan.order).toLowerCase();
    plan.order = { ascending: 'asc', descending: 'desc', top: 'desc', bottom: 'asc' }[o] || o;
    if (!['asc', 'desc'].includes(plan.order)) throw new PlanValidationError('"order" must be "asc" or "desc".');
  }

  if (plan.compare && typeof plan.compare === 'object') {
    plan.compare = {
      column: plan.compare.column || plan.group_by[0] || null,
      left: plan.compare.left ?? plan.compare.a ?? null,
      right: plan.compare.right ?? plan.compare.b ?? null,
    };
  } else if (plan.left_value !== undefined || plan.right_value !== undefined) {
    plan.compare = { column: plan.group_by[0] || null, left: plan.left_value ?? null, right: plan.right_value ?? null };
  } else {
    plan.compare = null;
  }
  delete plan.left_value;
  delete plan.right_value;

  // Operation-level sanity that does not need column knowledge.
  if (plan.operation === 'describe' && plan.metrics.length && plan.group_by.length) {
    plan.operation = 'aggregate';
  }
  if (plan.operation === 'time_series' && !plan.date_column) {
    throw new PlanValidationError('A time_series plan needs "date_column" set to the date column name.');
  }
  if (plan.operation === 'compare' && (!plan.compare || plan.compare.left === null || plan.compare.right === null)) {
    throw new PlanValidationError('A compare plan needs "compare": {"column": ..., "left": ..., "right": ...} with both values present.');
  }
  if (plan.operation === 'top' && !plan.group_by.length) {
    throw new PlanValidationError('A top plan needs "group_by" with the column to rank.');
  }
  if (plan.operation === 'distribution' && !plan.group_by.length && !plan.column) {
    throw new PlanValidationError('A distribution plan needs "group_by" with the column to break down.');
  }
  if (typeof plan.reasoning === 'string') plan.reasoning = plan.reasoning.slice(0, 500);
  return plan;
}

module.exports = {
  OPERATIONS,
  AGGREGATIONS,
  FILTER_OPS,
  PERIODS,
  OPERATION_DESCRIPTIONS,
  PLAN_JSON_SCHEMA,
  PlanValidationError,
  normalizePlan,
};
