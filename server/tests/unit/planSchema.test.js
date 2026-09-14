const { normalizePlan, PlanValidationError, OPERATIONS } = require('../../src/analysis/planSchema');

describe('normalizePlan', () => {
  test('accepts the canonical shape untouched', () => {
    const plan = normalizePlan({
      operation: 'aggregate',
      group_by: ['Region'],
      metrics: [{ agg: 'sum', column: 'Sales', label: 'total_sales' }],
      filters: [{ column: 'Status', op: 'eq', value: 'won' }],
    });
    expect(plan.operation).toBe('aggregate');
    expect(plan.group_by).toEqual(['Region']);
    expect(plan.metrics).toEqual([{ agg: 'sum', column: 'Sales', label: 'total_sales' }]);
    expect(plan.filters).toEqual([{ column: 'Status', op: 'eq', value: 'won' }]);
    expect(plan.compare).toBeNull();
  });

  test('maps aliases the model commonly produces', () => {
    const plan = normalizePlan({
      operation: 'Summarize',
      group_by: 'Region',
      metrics: [{ agg: 'average', column: 'Sales' }, 'Cost'],
      filters: [{ field: 'Region', operator: '!=', value: 'North' }],
      period: 'Monthly',
      order: 'descending',
      limit: '5',
    });
    expect(plan.operation).toBe('aggregate');
    expect(plan.group_by).toEqual(['Region']);
    expect(plan.metrics[0].agg).toBe('avg');
    expect(plan.metrics[1]).toEqual({ agg: 'sum', column: 'Cost', label: undefined });
    expect(plan.filters[0].op).toBe('neq');
    expect(plan.period).toBe('month');
    expect(plan.order).toBe('desc');
    expect(plan.limit).toBe(5);
  });

  test('folds legacy metric_column/agg into metrics', () => {
    const plan = normalizePlan({ operation: 'top', group_by: ['Customer'], metric_column: 'Sales', agg: 'avg' });
    expect(plan.metrics).toEqual([{ agg: 'avg', column: 'Sales' }]);
    expect(plan.metric_column).toBeUndefined();
  });

  test('count without a column is allowed, other aggs are not', () => {
    expect(normalizePlan({ operation: 'aggregate', metrics: [{ agg: 'count' }] }).metrics[0].column).toBeNull();
    expect(() => normalizePlan({ operation: 'aggregate', metrics: [{ agg: 'sum' }] })).toThrow(PlanValidationError);
  });

  test('rejects unknown operations, aggregations and filter ops with guidance', () => {
    expect(() => normalizePlan({ operation: 'delete' })).toThrow(/operation/);
    expect(() => normalizePlan({ operation: "__import__('os')" })).toThrow(PlanValidationError);
    expect(() => normalizePlan({ operation: 'aggregate', metrics: [{ agg: 'variance', column: 'x' }] })).toThrow(/variance/);
    expect(() => normalizePlan({ operation: 'aggregate', filters: [{ column: 'x', op: 'regex' }] })).toThrow(/regex/);
  });

  test('operation-level requirements', () => {
    expect(() => normalizePlan({ operation: 'time_series' })).toThrow(/date_column/);
    expect(() => normalizePlan({ operation: 'top' })).toThrow(/group_by/);
    expect(() => normalizePlan({ operation: 'compare', group_by: ['Region'] })).toThrow(/compare/);
    expect(() => normalizePlan({ operation: 'distribution' })).toThrow(/group_by/);
  });

  test('compare accepts nested and legacy shapes', () => {
    const nested = normalizePlan({ operation: 'compare', compare: { column: 'Region', left: 'North', right: 'South' } });
    expect(nested.compare).toEqual({ column: 'Region', left: 'North', right: 'South' });
    const legacy = normalizePlan({ operation: 'compare', group_by: ['Region'], left_value: 'A', right_value: 'B' });
    expect(legacy.compare).toEqual({ column: 'Region', left: 'A', right: 'B' });
  });

  test('describe with metrics and group_by becomes aggregate', () => {
    const plan = normalizePlan({ operation: 'describe', group_by: ['Region'], metrics: [{ agg: 'sum', column: 'Sales' }] });
    expect(plan.operation).toBe('aggregate');
  });

  test('limit is clamped', () => {
    expect(normalizePlan({ operation: 'describe', limit: 99999 }).limit).toBe(500);
    expect(normalizePlan({ operation: 'describe', limit: -3 }).limit).toBe(1);
  });

  test('every operation has a description', () => {
    const { OPERATION_DESCRIPTIONS } = require('../../src/analysis/planSchema');
    OPERATIONS.forEach((op) => expect(typeof OPERATION_DESCRIPTIONS[op]).toBe('string'));
  });
});
