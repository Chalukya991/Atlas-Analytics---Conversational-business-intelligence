const fs = require('fs');
const os = require('os');
const path = require('path');
const { tabulate, formatCell, PDF, Xlsx, Docx } = require('../../src/reports/renderer');

const analyses = [
  { id: 'a1', question: 'Total sales', results: { kind: 'scalar_aggregation', results: { sum_sales: 1505000, count_rows: 4 } }, explanation: { summary: 'Sales total 1,505,000.', kpis: [{ label: 'Sales', value: '1,505,000' }] } },
  { id: 'a2', question: 'Sales by region', results: { kind: 'grouped_aggregation', group_by: ['Region'], metrics: ['sum_sales'], columns: ['Region', 'sum_sales'], results: Array.from({ length: 60 }, (_, i) => ({ Region: `R${i}`, sum_sales: i * 100, _rows: 1 })) }, explanation: { summary: 'Sixty regions.', highlights: ['R59 leads.'], warnings: ['1 blank value ignored.'] } },
  { id: 'a3', question: 'Top customers', results: { kind: 'top_n', group_by: ['Customer'], metrics: ['sum_sales'], rank_metric: 'sum_sales', columns: ['rank', 'Customer', 'sum_sales', 'share'], results: [{ rank: 1, Customer: 'A', sum_sales: 500, share: 0.5 }, { rank: 2, Customer: 'B', sum_sales: 500, share: 0.5 }] }, explanation: {} },
  { id: 'a4', question: 'Monthly trend', results: { kind: 'time_series', period: 'month', metrics: ['sum_sales'], columns: ['period', 'sum_sales', 'change_pct'], results: [{ period: '2024-01', sum_sales: 10, change_pct: null }, { period: '2024-02', sum_sales: 20, change_pct: 1 }] }, explanation: {} },
  { id: 'a5', question: 'North vs South', results: { kind: 'comparison', compare: { column: 'Region', left: 'North', right: 'South' }, columns: ['metric', 'left', 'right', 'difference', 'change_pct'], results: [{ metric: 'sum_sales', left: 100, right: 50, difference: -50, change_pct: -0.5 }] }, explanation: {} },
  { id: 'a6', question: 'Status breakdown', results: { kind: 'distribution', mode: 'frequency', column: 'Status', columns: ['value', 'count', 'share'], results: [{ value: 'won', count: 3, share: 0.6 }, { value: 'lost', count: 2, share: 0.4 }] }, explanation: {} },
  { id: 'a7', question: 'Overview', results: { kind: 'describe', results: { rows: 5, columns: 2, column_profiles: [{ name: 'A', data_type: 'text', fill_rate: 1, distinct: 5 }] } }, explanation: {} },
];

describe('tabulate', () => {
  test('produces columns and rows for every result kind', () => {
    for (const a of analyses) {
      const { columns, rows } = tabulate(a.results);
      expect(columns.length).toBeGreaterThan(0);
      expect(rows.length).toBeGreaterThan(0);
    }
  });

  test('hides internal columns and builds charts where sensible', () => {
    const grouped = tabulate(analyses[1].results);
    expect(grouped.columns).toEqual(['Region', 'sum_sales']);
    expect(grouped.chart.series).toHaveLength(25);
    expect(tabulate(analyses[4].results).chart.series.map((s) => s.label)).toEqual(['North', 'South']);
    expect(tabulate(analyses[0].results).chart).toBeNull();
  });

  test('formats percentages and numbers', () => {
    expect(formatCell(0.256, 'share')).toBe('25.6%');
    expect(formatCell(1505000, 'sum_sales')).toBe('1,505,000');
    expect(formatCell(12.3456, 'avg')).toBe('12.35');
    expect(formatCell(null, 'x')).toBe('');
  });
});

describe('renderers', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-ba-report-'));
  const content = { name: 'Unit Test Report', analyses, datasets: ['sales.csv'] };
  const report = { version: 3 };

  test('pdf renders all kinds with pagination', async () => {
    const file = path.join(dir, 'r.pdf');
    await PDF.renderToFile(file, content, report);
    const buf = fs.readFileSync(file);
    expect(buf.subarray(0, 4).toString()).toBe('%PDF');
    expect(buf.length).toBeGreaterThan(5000);
  });

  test('xlsx renders one sheet per analysis', async () => {
    const file = path.join(dir, 'r.xlsx');
    await Xlsx.renderToFile(file, content, report);
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(file);
    expect(wb.worksheets).toHaveLength(analyses.length + 1);
    const grouped = wb.worksheets[2];
    expect(grouped.rowCount).toBeGreaterThan(60);
  });

  test('docx renders', async () => {
    const file = path.join(dir, 'r.docx');
    await Docx.renderToFile(file, content, report);
    expect(fs.statSync(file).size).toBeGreaterThan(2000);
  });
});
