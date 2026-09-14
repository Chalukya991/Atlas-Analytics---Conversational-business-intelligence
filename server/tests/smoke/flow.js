/* Shared end-to-end flow used by both smoke runners.
 * Exercises: register → project → upload → dataset ready → three questions → numeric assertions →
 * CSV export → report (pdf) → download → cleanup. */
const fs = require('fs');
const os = require('os');
const path = require('path');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CSV = [
  'Customer,Region,Amount,Order Date,Status',
  'Acme Corp,North,"1,500.00",2024-01-05,won',
  'Beta LLC,South,3200.50,2024-01-12,won',
  'Gamma Inc,North,980.25,2024-02-03,lost',
  'Delta Co,West,"$4,100",2024-02-15,won',
  'Epsilon Ltd,South,760.00,2024-03-01,won',
  'Zeta SA,North,"2,150.75",2024-03-14,won',
  'Eta GmbH,West,,2024-03-20,lost',
].join('\n');

const EXPECTED_BY_REGION = { North: 1500 + 980.25 + 2150.75, South: 3200.5 + 760, West: 4100 };

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function runFlow(base, log = console.log) {
  const call = async (method, urlPath, { token, json, form, raw } = {}) => {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    let body;
    if (json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(json);
    }
    if (form) body = form;
    const res = await fetch(`${base}${urlPath}`, { method, headers, body });
    if (raw) return res;
    const text = await res.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch (_) { parsed = text; }
    return { status: res.status, body: parsed, headers: res.headers };
  };

  const rand = Date.now();
  const email = `smoke-${rand}@example.com`;

  log('1. register');
  let r = await call('POST', '/auth/register', { json: { email, password: 'Smoke123!', name: 'Smoke Test' } });
  assert(r.status === 201, `register ${r.status}: ${JSON.stringify(r.body)}`);
  const token = r.body.token;
  assert(r.body.user.organizationId, 'register should return organizationId');

  log('   weak password is rejected');
  r = await call('POST', '/auth/register', { json: { email: `x${rand}@example.com`, password: 'short', name: 'X' } });
  assert(r.status === 400, `weak password should be 400, got ${r.status}`);

  log('   login returns org-scoped token');
  r = await call('POST', '/auth/login', { json: { email, password: 'Smoke123!' } });
  assert(r.status === 200 && r.body.user.organizationId, `login ${r.status}`);

  log('2. create project');
  r = await call('POST', '/projects', { token, json: { name: 'Smoke Project', description: 'flow test' } });
  assert(r.status === 201, `project ${r.status}: ${JSON.stringify(r.body)}`);
  const projectId = r.body.id;

  log('3. upload file');
  const csvPath = path.join(os.tmpdir(), `smoke-sales-${rand}.csv`);
  fs.writeFileSync(csvPath, CSV);
  const form = new FormData();
  form.append('file', new Blob([fs.readFileSync(csvPath)], { type: 'text/csv' }), 'smoke-sales.csv');
  r = await call('POST', `/projects/${projectId}/files`, { token, form });
  assert(r.status === 201, `upload ${r.status}: ${JSON.stringify(r.body)}`);
  fs.unlinkSync(csvPath);

  log('   unsupported file type is rejected');
  const bad = new FormData();
  bad.append('file', new Blob(['hello'], { type: 'text/plain' }), 'notes.exe');
  r = await call('POST', `/projects/${projectId}/files`, { token, form: bad });
  assert(r.status === 400, `bad upload should be 400, got ${r.status}`);

  log('4. wait for dataset ready');
  let datasets = [];
  for (let i = 0; i < 60; i += 1) {
    await sleep(1000);
    r = await call('GET', `/projects/${projectId}/datasets`, { token });
    datasets = r.body.datasets || [];
    if (datasets.some((d) => d.status === 'ready' || d.status === 'failed')) break;
  }
  const dataset = datasets.find((d) => d.status === 'ready');
  assert(dataset, `dataset never ready: ${JSON.stringify(datasets.map((d) => [d.status, d.error]))}`);
  const amount = dataset.columns.find((c) => c.name === 'Amount');
  assert(amount && amount.data_type === 'number', `Amount should be numeric, got ${amount && amount.data_type}`);
  assert(amount.currency === '$', `Amount currency should be detected, got ${amount.currency}`);
  assert(dataset.metadata.row_count === 7, `row_count should be 7, got ${dataset.metadata.row_count}`);
  log(`   ready: ${dataset.name} | ${dataset.columns.length} columns | ${dataset.metadata.row_count} rows`);

  log('   preview endpoint');
  r = await call('GET', `/projects/${projectId}/datasets/${dataset.id}/preview?offset=5&limit=10`, { token });
  assert(r.status === 200 && r.body.rows.length === 2, `preview ${r.status}: ${JSON.stringify(r.body).slice(0, 200)}`);

  const ask = async (question) => {
    const res = await call('POST', `/projects/${projectId}/chat`, { token, json: { question, datasetId: dataset.id } });
    assert(res.status === 202, `ask ${res.status}: ${JSON.stringify(res.body)}`);
    return res.body.analysisId;
  };
  const waitFor = async (analysisId) => {
    let analysis = null;
    for (let i = 0; i < 240; i += 1) {
      await sleep(1500);
      const res = await call('GET', `/projects/${projectId}/analyses/${analysisId}`, { token });
      analysis = res.body;
      if (analysis.status === 'completed' || analysis.status === 'failed') break;
    }
    assert(analysis && analysis.status !== 'queued' && analysis.status !== 'running', 'analysis never finished');
    return analysis;
  };

  log('5. ask: total amount per region');
  const a1 = await waitFor(await ask('What is the total amount per region?'));
  assert(a1.status === 'completed', `analysis 1 failed: ${a1.error}`);
  assert(a1.results.kind === 'grouped_aggregation', `expected grouped_aggregation, got ${a1.results.kind}`);
  const metric = a1.results.metrics[0];
  for (const row of a1.results.results) {
    const expected = EXPECTED_BY_REGION[row.Region];
    if (expected !== undefined) {
      assert(Math.abs(row[metric] - expected) < 0.01, `${row.Region} should be ${expected}, engine said ${row[metric]}`);
    }
  }
  assert(a1.explanation && typeof a1.explanation.summary === 'string', 'explanation missing');
  assert((a1.explanation.warnings || []).some((w) => /blank/i.test(w)), `expected a blank-value warning, got ${JSON.stringify(a1.explanation.warnings)}`);
  log(`   ok: ${a1.results.results.length} regions, plan attempts=${a1.plan.attempts}, grounded=${a1.explanation.grounded}`);
  log(`   summary: ${a1.explanation.summary.slice(0, 160)}`);

  log('6. ask: top 2 customers');
  const a2 = await waitFor(await ask('Who are the top 2 customers by amount?'));
  assert(a2.status === 'completed', `analysis 2 failed: ${a2.error}`);
  assert(a2.results.kind === 'top_n', `expected top_n, got ${a2.results.kind}`);
  assert(a2.results.results.length === 2, `expected 2 rows, got ${a2.results.results.length}`);
  assert(a2.results.results[0].Customer === 'Delta Co', `top customer should be Delta Co, got ${a2.results.results[0].Customer}`);
  log(`   ok: #1 ${a2.results.results[0].Customer}`);

  log('7. ask: monthly trend (follow-up phrasing)');
  const a3 = await waitFor(await ask('How did the amount trend month by month?'));
  assert(a3.status === 'completed', `analysis 3 failed: ${a3.error}`);
  assert(a3.results.kind === 'time_series', `expected time_series, got ${a3.results.kind}`);
  assert(a3.results.results.map((x) => x.period).join(',') === '2024-01,2024-02,2024-03', `periods: ${a3.results.results.map((x) => x.period)}`);
  log('   ok: 3 monthly buckets');

  log('8. csv export');
  const exp = await call('GET', `/projects/${projectId}/analyses/${a1.id}/export.csv`, { token, raw: true });
  assert(exp.status === 200 && (exp.headers.get('content-type') || '').includes('text/csv'), `export ${exp.status}`);
  const csvText = await exp.text();
  assert(csvText.includes('Region'), 'csv should contain header');

  log('9. list analyses includes results for thread reload');
  r = await call('GET', `/projects/${projectId}/analyses`, { token });
  assert(r.status === 200 && r.body.analyses.length === 3 && r.body.analyses[0].results, 'analyses list should carry results');

  log('10. generate report (pdf) with two analyses');
  r = await call('POST', `/projects/${projectId}/reports`, { token, json: { format: 'pdf', name: 'Smoke Report', analysisIds: [a1.id, a2.id] } });
  assert(r.status === 202, `report gen ${r.status}: ${JSON.stringify(r.body)}`);
  const reportId = r.body.reportId;
  let report = null;
  for (let i = 0; i < 40; i += 1) {
    await sleep(1000);
    r = await call('GET', `/projects/${projectId}/reports/${reportId}`, { token });
    report = r.body;
    if (report.status === 'ready' || report.status === 'failed') break;
  }
  assert(report && report.status === 'ready', `report status ${report && report.status}: ${report && report.error}`);
  const dl = await call('GET', `/projects/${projectId}/reports/${reportId}/download`, { token, raw: true });
  assert(dl.status === 200 && (dl.headers.get('content-type') || '').includes('pdf'), `download ${dl.status}`);
  const buf = Buffer.from(await dl.arrayBuffer());
  assert(buf.subarray(0, 4).toString() === '%PDF' && buf.length > 3000, 'pdf looks wrong');
  log(`   ok: ${buf.length} bytes`);

  log('11. authorization: another user cannot see the project');
  r = await call('POST', '/auth/register', { json: { email: `other-${rand}@example.com`, password: 'Other123!', name: 'Other' } });
  const otherToken = r.body.token;
  r = await call('GET', `/projects/${projectId}`, { token: otherToken });
  assert(r.status === 404, `other user should get 404, got ${r.status}`);

  log('12. logout revokes the token');
  r = await call('POST', '/auth/logout', { token: otherToken });
  assert(r.status === 204, `logout ${r.status}`);
  r = await call('GET', '/auth/me', { token: otherToken });
  assert(r.status === 401, `revoked token should be 401, got ${r.status}`);

  log('13. cleanup: delete project');
  r = await call('DELETE', `/projects/${projectId}`, { token });
  assert(r.status === 204, `delete ${r.status}`);
  r = await call('GET', `/projects/${projectId}`, { token });
  assert(r.status === 404, 'project should be gone');

  log('ALL SMOKE TESTS PASSED');
}

module.exports = { runFlow, sleep };
