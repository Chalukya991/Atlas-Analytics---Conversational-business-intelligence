const { groundExplanation, extractNumberTokens, parseNumberToken } = require('../../src/llm/grounding');

const results = {
  kind: 'grouped_aggregation',
  results: [
    { Region: 'North', sum_sales: 1500000, _rows: 2 },
    { Region: 'West', sum_sales: 3000, _rows: 1 },
    { Region: 'South', sum_sales: 2000, _rows: 1 },
  ],
  group_by: ['Region'],
  metrics: ['sum_sales'],
  filtered_rows: 4,
  warnings: [],
};

describe('grounding', () => {
  test('parses number tokens with separators, currency and suffixes', () => {
    expect(parseNumberToken('$1,500,000')).toBe(1500000);
    expect(parseNumberToken('1.5M')).toBe(1500000);
    expect(parseNumberToken('12.5%')).toBe(12.5);
    expect(extractNumberTokens('North made $1,500,000 (99.7%) in 2024')).toEqual(['$1,500,000', '99.7%', '2024']);
  });

  test('keeps highlights whose numbers exist in the results', () => {
    const { explanation, removed } = groundExplanation({
      summary: 'North leads with $1,500,000 in sales across 4 rows.',
      highlights: ['West totals 3,000.', 'North is 1.5M.', 'South contributes 2,000.'],
      kpis: [{ label: 'Top region', value: 'North' }, { label: 'North sales', value: '1,500,000' }],
      suggested_questions: ['Break down North by month'],
    }, results, 'total sales by region');
    expect(removed).toHaveLength(0);
    expect(explanation.highlights).toHaveLength(3);
    expect(explanation.kpis).toHaveLength(2);
    expect(explanation.grounded).toBe(true);
  });

  test('removes hallucinated highlights and KPIs and flags the summary', () => {
    const { explanation, removed, flagged } = groundExplanation({
      summary: 'Total sales reached 9,999,999 this year.',
      highlights: ['West totals 3,000.', 'East totals 42,000.'],
      kpis: [{ label: 'Total', value: '$7.2M' }],
    }, results);
    expect(removed).toHaveLength(2);
    expect(explanation.highlights).toEqual(['West totals 3,000.']);
    expect(explanation.kpis).toHaveLength(0);
    expect(flagged).toEqual(['9,999,999']);
    expect(explanation.grounded).toBe(false);
    expect(explanation.warnings[0]).toMatch(/could not be verified/);
  });

  test('allows years, small ordinals, percentages derived from shares and numbers from the question', () => {
    const r = { kind: 'top_n', results: [{ Customer: 'A', sum_sales: 800, share: 0.4 }, { Customer: 'B', sum_sales: 1200, share: 0.6 }] };
    const { explanation } = groundExplanation({
      summary: 'In 2024 the top 2 customers split sales 40% / 60%. You asked about the top 5.',
      highlights: ['B holds 60% of the total.'],
    }, r, 'top 5 customers in 2024');
    expect(explanation.grounded).toBe(true);
    expect(explanation.highlights).toHaveLength(1);
  });

  test('tolerates rounding of computed values', () => {
    const r = { kind: 'scalar_aggregation', results: { avg_sales: 501666.6667 } };
    const { explanation } = groundExplanation({ summary: 'Average sales are about 501,667.', highlights: ['Roughly 501.7k on average.'] }, r);
    expect(explanation.grounded).toBe(true);
  });

  test('handles malformed explanation objects', () => {
    const { explanation } = groundExplanation({ summary: 42, highlights: 'nope', kpis: [null, { label: 'x' }] }, results);
    expect(explanation.summary).toBe('');
    expect(explanation.highlights).toEqual([]);
    expect(explanation.kpis).toEqual([]);
  });
});
