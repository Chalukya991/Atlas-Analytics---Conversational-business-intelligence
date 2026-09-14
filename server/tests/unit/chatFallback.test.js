process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://u:p@localhost:5432/x';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
process.env.OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
process.env.QWEN_MODEL = process.env.QWEN_MODEL || 'test';
process.env.SECRET_KEY = process.env.SECRET_KEY || 'x'.repeat(40);

jest.mock('../../src/workers/queue', () => ({ analysisQueue: { add: jest.fn() } }));
jest.mock('../../src/models', () => ({ Analysis: {}, Dataset: {}, Project: {} }));
jest.mock('../../src/database', () => ({ query: jest.fn() }));

const { _internal, resultsToCsv } = require('../../src/services/chat');

describe('deterministic fallback explanation', () => {
  test('grouped aggregation', () => {
    const e = _internal.buildFallbackExplanation({
      kind: 'grouped_aggregation', group_by: ['Region'], metrics: ['sum_sales'],
      results: [{ Region: 'North', sum_sales: 1500000 }, { Region: 'West', sum_sales: 3000 }],
      warnings: [{ code: 'x', message: 'One value dropped.' }],
    });
    expect(e.summary).toMatch(/North/);
    expect(e.kpis[0]).toEqual({ label: 'Top Region', value: 'North' });
    expect(e.warnings).toEqual(['One value dropped.']);
    expect(e.generated_by).toBe('deterministic');
  });

  test('comparison and time series', () => {
    const c = _internal.buildFallbackExplanation({
      kind: 'comparison', compare: { column: 'Region', left: 'North', right: 'South' },
      results: [{ metric: 'sum_sales', left: 100, right: 50, difference: -50, change_pct: -0.5 }], warnings: [],
    });
    expect(c.highlights[0]).toMatch(/-50/);
    const t = _internal.buildFallbackExplanation({
      kind: 'time_series', period: 'month', metrics: ['sum_sales'],
      results: [{ period: '2024-01', sum_sales: 10 }, { period: '2024-02', sum_sales: 30 }], warnings: [],
    });
    expect(t.summary).toMatch(/2024-01/);
    expect(t.kpis.find((k) => k.label === 'Peak period').value).toBe('2024-02');
  });
});

describe('inferMissingMetric', () => {
  const ctx = { columns: [{ name: 'Amount', type: 'number' }, { name: 'Order Date', type: 'date' }, { name: 'Region', type: 'text' }, { name: 'Unit Price', type: 'number' }] };

  test('fills sum of the named numeric column when the model omitted metrics', () => {
    const plan = _internal.inferMissingMetric({ operation: 'time_series', date_column: 'Order Date', metrics: [] }, 'How did the amount trend by month?', ctx);
    expect(plan.metrics).toEqual([{ agg: 'sum', column: 'Amount' }]);
    expect(plan.repaired).toBe(true);
  });

  test('picks the aggregation from the wording and matches multi-word columns', () => {
    const plan = _internal.inferMissingMetric({ operation: 'aggregate', group_by: ['Region'], metrics: [{ agg: 'count', column: null }] }, 'Average unit price by region', ctx);
    expect(plan.metrics).toEqual([{ agg: 'avg', column: 'Unit Price' }]);
  });

  test('leaves count-style questions and explicit metrics alone', () => {
    const counted = _internal.inferMissingMetric({ operation: 'time_series', metrics: [{ agg: 'count', column: null }] }, 'How many orders per month by amount?', ctx);
    expect(counted.repaired).toBeUndefined();
    const explicit = _internal.inferMissingMetric({ operation: 'top', metrics: [{ agg: 'sum', column: 'Amount' }] }, 'top customers by amount', ctx);
    expect(explicit.repaired).toBeUndefined();
    const unnamed = _internal.inferMissingMetric({ operation: 'time_series', metrics: [] }, 'trend over time', ctx);
    expect(unnamed.repaired).toBeUndefined();
  });

  test('guessAggregation', () => {
    expect(_internal.guessAggregation('average deal size')).toBe('avg');
    expect(_internal.guessAggregation('highest amount per region')).toBe('max');
    expect(_internal.guessAggregation('top 5 regions by highest amount')).toBe('sum');
    expect(_internal.guessAggregation('how many orders')).toBe('count');
  });
});

describe('compactResults', () => {
  test('caps rows and drops provenance', () => {
    const c = _internal.compactResults({ kind: 'grouped_aggregation', provenance: { a: 1 }, results: Array.from({ length: 100 }, (_, i) => ({ i })) });
    expect(c.provenance).toBeUndefined();
    expect(c.results).toHaveLength(40);
    expect(c.results_note).toMatch(/100/);
  });
});

describe('resultsToCsv', () => {
  test('exports tabular kinds with escaping', () => {
    const csv = resultsToCsv({ kind: 'grouped_aggregation', columns: ['Region', 'sum_sales'], results: [{ Region: 'North, East', sum_sales: 5, _rows: 1 }] });
    expect(csv.split('\n')).toEqual(['Region,sum_sales', '"North, East",5']);
  });
  test('exports scalar and describe kinds', () => {
    expect(resultsToCsv({ kind: 'scalar_aggregation', results: { total: 1 } })).toBe('total\n1');
    expect(resultsToCsv({ kind: 'describe', results: { column_profiles: [{ name: 'A', data_type: 'text', fill_rate: 1, distinct: 2 }] } })).toContain('A,text,1,2');
  });
});
