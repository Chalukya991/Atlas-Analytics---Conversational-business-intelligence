import { useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowDownRight, ArrowUpRight, BarChart3, Check, ChevronDown, CircleCheck, Columns3, Copy, Download,
  GitCompareArrows, ListOrdered, MoreHorizontal, PieChart, ShieldAlert, ShieldCheck, Sparkles, Table2, Trash2, TrendingUp,
} from 'lucide-react';
import { BarChart, LineChart } from './Charts';
import DataTable from './DataTable';
import Badge from '../ui/Badge';
import Menu, { MenuItem, MenuSeparator } from '../ui/Menu';
import { formatNumber, formatPercent, formatValue, humanize, operationLabel, formatTime } from '../../lib/format';

const RESULT_KINDS = {
  describe: { Icon: Columns3, label: 'Dataset overview' },
  grouped_aggregation: { Icon: BarChart3, label: 'Grouped result' },
  scalar_aggregation: { Icon: CircleCheck, label: 'Calculation' },
  top_n: { Icon: ListOrdered, label: 'Ranking' },
  time_series: { Icon: TrendingUp, label: 'Trend over time' },
  comparison: { Icon: GitCompareArrows, label: 'Comparison' },
  distribution: { Icon: PieChart, label: 'Distribution' },
};

function VizToggle({ value, onChange, options }) {
  return (
    <div className="viz-toggle" role="tablist" aria-label="View">
      {options.map((o) => (
        <button key={o.id} type="button" role="tab" aria-selected={value === o.id} className={value === o.id ? 'is-active' : ''} onClick={() => onChange(o.id)} title={o.title}>
          <o.Icon size={13} />
        </button>
      ))}
    </div>
  );
}

function KpiStrip({ kpis, large = false }) {
  if (!kpis || !kpis.length) return null;
  return (
    <div className="kpi-row">
      {kpis.slice(0, 6).map((k, i) => (
        <div className={`kpi ${large ? 'kpi--lg' : ''}`} key={i} title={`${k.label}: ${k.value}`}>
          <span className="kpi__label">{k.label}</span>
          <span className="kpi__value">{typeof k.value === 'number' ? formatNumber(k.value) : k.value}</span>
          {k.sub && <span className="kpi__sub">{k.sub}</span>}
        </div>
      ))}
    </div>
  );
}

function TypePill({ type }) {
  return <span className={`type-pill type-pill--${type || 'unknown'}`}>{type || 'unknown'}</span>;
}

function FillBar({ rate }) {
  const pct = Math.round((Number(rate) || 0) * 100);
  return (
    <span className="fill-bar" title={`${pct}% filled`}>
      <span className="fill-bar__track"><span className="fill-bar__fill" style={{ width: `${pct}%` }} /></span>
      <span className="tabular" style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-3)' }}>{pct}%</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Per-kind visuals
// ---------------------------------------------------------------------------

function DescribeVisual({ results }) {
  const r = results.results || {};
  const profiles = r.column_profiles || [];
  const issues = r.issues || [];
  return (
    <div className="describe-grid">
      <KpiStrip
        large
        kpis={[
          { label: 'Rows', value: formatNumber(r.rows) },
          { label: 'Columns', value: formatNumber(r.columns) },
          { label: 'Numeric columns', value: profiles.filter((p) => p.data_type === 'number').length },
          { label: 'Date columns', value: profiles.filter((p) => p.data_type === 'date').length },
        ]}
      />
      {issues.length > 0 && (
        <div className="describe-issues">
          {issues.map((i) => <Badge key={i} tone="warning">{humanize(i)}</Badge>)}
        </div>
      )}
      <div className="table-wrap">
        <table className="table table--compact">
          <thead>
            <tr><th>Column</th><th>Type</th><th>Filled</th><th className="num">Distinct</th><th>Sample values</th><th>Notes</th></tr>
          </thead>
          <tbody>
            {profiles.map((p) => (
              <tr key={p.name}>
                <td style={{ fontWeight: 500 }}>{p.name}</td>
                <td><TypePill type={p.data_type} /></td>
                <td><FillBar rate={p.fill_rate} /></td>
                <td className="num">{formatNumber(p.distinct)}</td>
                <td className="muted mono" style={{ fontSize: 'var(--text-2xs)' }}>{(p.sample_values || []).slice(0, 3).map(String).join(', ')}</td>
                <td className="muted" style={{ fontSize: 'var(--text-2xs)' }}>{(p.issues || []).map(humanize).join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ScalarVisual({ results }) {
  const entries = Object.entries(results.results || {});
  return <KpiStrip large kpis={entries.map(([k, v]) => ({ label: humanize(k), value: formatValue(v, k), sub: `${formatNumber(results.filtered_rows)} rows` }))} />;
}

function joinedLabelRows(rows, groupBy) {
  if (!groupBy || groupBy.length <= 1) return { rows, key: groupBy?.[0] };
  return { rows: rows.map((r) => ({ ...r, __label: groupBy.map((g) => r[g]).join(' · ') })), key: '__label' };
}

function GroupedVisual({ results, view }) {
  const metrics = results.metrics || [];
  const { rows, key } = joinedLabelRows(results.results || [], results.group_by);
  if (view === 'table') return <DataTable rows={results.results} columns={results.columns} />;
  const horizontal = rows.length <= 14;
  const series = metrics.slice(0, horizontal ? 1 : 2).map((m) => ({ key: m, label: humanize(m) }));
  return <BarChart data={rows} xKey={key} series={series} horizontal={horizontal} height={horizontal ? undefined : 260} title={`${series.map((s) => s.label).join(', ')} by ${(results.group_by || []).map(humanize).join(' and ')}`} />;
}

function TopVisual({ results, view }) {
  const rows = results.results || [];
  const group = (results.group_by || [])[0];
  const metric = results.rank_metric || (results.metrics || [])[0];
  if (view === 'table') return <DataTable rows={rows} columns={results.columns} />;
  const max = Math.max(1, ...rows.map((r) => Math.abs(Number(r[metric]) || 0)));
  return (
    <div className="rank">
      {rows.map((row, i) => {
        const v = Number(row[metric]) || 0;
        return (
          <div className="rank__row" key={i}>
            <span className="rank__pos">{row.rank || i + 1}</span>
            <span className="rank__label" title={String(row[group])}>{String(row[group] ?? '—')}</span>
            <span className="rank__track"><span className="rank__fill" style={{ width: `${(Math.abs(v) / max) * 100}%`, background: v < 0 ? 'var(--chart-negative)' : undefined }} /></span>
            <span className="rank__value">{formatValue(v, metric)}</span>
            <span className="rank__share">{row.share !== undefined && row.share !== null ? formatPercent(row.share) : ''}</span>
          </div>
        );
      })}
      {results.total_groups > rows.length && (
        <p className="muted" style={{ fontSize: 'var(--text-2xs)' }}>Showing {rows.length} of {formatNumber(results.total_groups)} {humanize(group).toLowerCase()} groups.</p>
      )}
    </div>
  );
}

function TimeSeriesVisual({ results, view }) {
  const metrics = results.metrics || [];
  if (view === 'table') return <DataTable rows={results.results} columns={results.columns} />;
  const series = metrics.slice(0, 2).map((m) => ({ key: m, label: humanize(m) }));
  if (view === 'bar') return <BarChart data={results.results} xKey="period" series={series} height={260} />;
  return <LineChart data={results.results} xKey="period" series={series} height={260} title={`${series.map((s) => s.label).join(', ')} per ${results.period}`} />;
}

function ComparisonVisual({ results, view }) {
  const rows = results.results || [];
  const c = results.compare || {};
  if (view === 'table' || !rows.length) return <DataTable rows={rows} columns={results.columns} />;
  const first = rows[0];
  const up = (first.difference || 0) > 0;
  const flat = !first.difference;
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="compare">
        <div className="compare__side">
          <span className="compare__name" title={String(c.left)}>{String(c.left)}</span>
          <span className="compare__val">{formatValue(first.left, first.metric)}</span>
          <span className="compare__rows">{formatNumber(c.left_rows)} rows</span>
        </div>
        <div className="compare__delta">
          <span className="compare__metric">{humanize(first.metric)}</span>
          <span className={`compare__delta-val ${flat ? '' : up ? 'is-up' : 'is-down'}`}>
            {!flat && (up ? <ArrowUpRight size={16} /> : <ArrowDownRight size={16} />)}
            {first.difference === null || first.difference === undefined ? '—' : `${up ? '+' : ''}${formatNumber(first.difference)}`}
          </span>
          <span className="compare__delta-pct">{first.change_pct === null || first.change_pct === undefined ? 'n/a' : formatPercent(first.change_pct, { signed: true })}</span>
        </div>
        <div className="compare__side compare__side--right">
          <span className="compare__name" title={String(c.right)}>{String(c.right)}</span>
          <span className="compare__val">{formatValue(first.right, first.metric)}</span>
          <span className="compare__rows">{formatNumber(c.right_rows)} rows</span>
        </div>
      </div>
      {rows.length > 1 && <DataTable rows={rows} columns={results.columns} compact />}
    </div>
  );
}

function DistributionVisual({ results, view }) {
  const rows = results.results || [];
  if (view === 'table') return <DataTable rows={rows} columns={results.columns} />;
  if (results.mode === 'histogram') {
    const s = results.summary || {};
    return (
      <div className="stack" style={{ gap: 12 }}>
        <KpiStrip kpis={[{ label: 'Min', value: formatNumber(s.min) }, { label: 'Median', value: formatNumber(s.median) }, { label: 'Mean', value: formatNumber(s.mean) }, { label: 'Max', value: formatNumber(s.max) }]} />
        <BarChart data={rows} xKey="bucket" yKey="count" height={220} title={`Distribution of ${results.column}`} />
      </div>
    );
  }
  const horizontal = rows.length <= 12;
  return <BarChart data={rows} xKey="value" yKey="count" horizontal={horizontal} height={horizontal ? undefined : 240} title={`Rows by ${results.column}`} />;
}

const VIEW_OPTIONS = {
  grouped_aggregation: [{ id: 'chart', Icon: BarChart3, title: 'Chart' }, { id: 'table', Icon: Table2, title: 'Table' }],
  top_n: [{ id: 'chart', Icon: ListOrdered, title: 'Ranking' }, { id: 'table', Icon: Table2, title: 'Table' }],
  time_series: [{ id: 'chart', Icon: TrendingUp, title: 'Line' }, { id: 'bar', Icon: BarChart3, title: 'Bars' }, { id: 'table', Icon: Table2, title: 'Table' }],
  comparison: [{ id: 'chart', Icon: GitCompareArrows, title: 'Cards' }, { id: 'table', Icon: Table2, title: 'Table' }],
  distribution: [{ id: 'chart', Icon: BarChart3, title: 'Chart' }, { id: 'table', Icon: Table2, title: 'Table' }],
};

function ResultVisual({ results, view }) {
  switch (results.kind) {
    case 'describe': return <DescribeVisual results={results} />;
    case 'scalar_aggregation': return <ScalarVisual results={results} />;
    case 'grouped_aggregation': return <GroupedVisual results={results} view={view} />;
    case 'top_n': return <TopVisual results={results} view={view} />;
    case 'time_series': return <TimeSeriesVisual results={results} view={view} />;
    case 'comparison': return <ComparisonVisual results={results} view={view} />;
    case 'distribution': return <DistributionVisual results={results} view={view} />;
    default:
      return Array.isArray(results.results) ? <DataTable rows={results.results} columns={results.columns} /> : <div className="chart-empty">No visual available for this result.</div>;
  }
}

// ---------------------------------------------------------------------------
// Plan panel
// ---------------------------------------------------------------------------

function PlanPanel({ plan, meta }) {
  const [open, setOpen] = useState(false);
  const [raw, setRaw] = useState(false);
  if (!plan) return null;
  const chips = (arr) => (arr && arr.length ? arr.map((x, i) => <span className="chip chip--tag" key={i}>{x}</span>) : <span className="muted">—</span>);
  const metricChips = (plan.metrics || []).map((m) => `${m.agg}(${m.column || 'rows'})`);
  const filterChips = (plan.filters || []).map((f) => `${f.column} ${f.op} ${Array.isArray(f.value) ? f.value.join(', ') : f.value ?? ''}`);
  return (
    <div className="plan">
      <button type="button" className={`plan__toggle ${open ? 'is-open' : ''}`} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <Sparkles size={13} /> How this was computed
        {meta?.attempts > 1 && <Badge tone="neutral">{meta.attempts} attempts</Badge>}
        <ChevronDown size={14} className="chev" />
      </button>
      {open && (
        <div className="plan__body">
          {meta?.reasoning && <p className="plan__reason">“{meta.reasoning}”</p>}
          <div className="plan__grid">
            <span className="plan__k">Operation</span><span className="plan__v"><span className="chip chip--tag">{operationLabel(plan.operation)}</span></span>
            {plan.group_by?.length > 0 && <><span className="plan__k">Grouped by</span><span className="plan__v">{chips(plan.group_by)}</span></>}
            {metricChips.length > 0 && <><span className="plan__k">Metrics</span><span className="plan__v">{chips(metricChips)}</span></>}
            <span className="plan__k">Filters</span><span className="plan__v">{chips(filterChips)}</span>
            {plan.date_column && <><span className="plan__k">Date column</span><span className="plan__v">{chips([`${plan.date_column} · by ${plan.period}`])}</span></>}
            {plan.compare && <><span className="plan__k">Compare</span><span className="plan__v">{chips([`${plan.compare.column}: ${plan.compare.left} vs ${plan.compare.right}`])}</span></>}
            {plan.operation === 'top' && <><span className="plan__k">Limit</span><span className="plan__v">{chips([`${plan.order === 'asc' ? 'bottom' : 'top'} ${plan.limit}`])}</span></>}
          </div>
          <button type="button" className="p-link" style={{ fontSize: 'var(--text-2xs)' }} onClick={() => setRaw((v) => !v)}>{raw ? 'Hide' : 'Show'} raw plan JSON</button>
          {raw && <pre className="plan__json">{JSON.stringify(plan, null, 2)}</pre>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

export default function AnalysisResultCard({ analysis, onAsk, onDelete, onExport }) {
  const results = analysis.results || {};
  const explanation = analysis.explanation || {};
  const planWrap = analysis.plan || {};
  const plan = planWrap.plan || results.plan || null;
  const kindMeta = RESULT_KINDS[results.kind] || { Icon: Table2, label: 'Result' };
  const KindIcon = kindMeta.Icon;
  const viewOptions = VIEW_OPTIONS[results.kind];
  const [view, setView] = useState('chart');
  const [copied, setCopied] = useState(false);

  const highlights = Array.isArray(explanation.highlights) ? explanation.highlights : [];
  const warnings = Array.isArray(explanation.warnings) ? explanation.warnings : [];
  const suggested = Array.isArray(explanation.suggested_questions) ? explanation.suggested_questions : [];
  const kpis = useMemo(() => (Array.isArray(explanation.kpis) ? explanation.kpis.filter((k) => k && k.label) : []), [explanation.kpis]);
  const grounded = explanation.grounded !== false;
  const rowsNote = results.filtered_rows !== undefined && results.row_count !== undefined && results.filtered_rows !== results.row_count
    ? `${formatNumber(results.filtered_rows)} of ${formatNumber(results.row_count)} rows`
    : results.row_count !== undefined ? `${formatNumber(results.row_count)} rows` : null;

  const copySummary = async () => {
    const text = [explanation.summary, ...highlights.map((h) => `• ${h}`)].filter(Boolean).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  const showScalarKpis = results.kind === 'scalar_aggregation';

  return (
    <div className="result-card" id={`analysis-${analysis.id}`}>
      <div className="result-card__head">
        <div className="result-card__heading">
          <span className="result-card__icon"><KindIcon size={17} /></span>
          <div className="grow">
            <p className="result-card__title">{kindMeta.label}</p>
            <p className="result-card__sub">
              {analysis.dataset_name && <span className="truncate" style={{ maxWidth: 220 }}>{analysis.dataset_name}</span>}
              {rowsNote && <span>· {rowsNote}</span>}
              {analysis.created_at && <span>· {formatTime(analysis.created_at)}</span>}
            </p>
          </div>
        </div>
        <div className="result-card__actions">
          {viewOptions && <VizToggle value={view} onChange={setView} options={viewOptions} />}
          <button className="icon-btn" onClick={copySummary} title="Copy summary" aria-label="Copy summary">{copied ? <Check size={15} /> : <Copy size={15} />}</button>
          <Menu
            trigger={({ toggle }) => <button className="icon-btn" onClick={toggle} aria-label="More actions"><MoreHorizontal size={16} /></button>}
          >
            <MenuItem icon={Download} onClick={() => onExport?.(analysis)}>Export results as CSV</MenuItem>
            <MenuSeparator />
            <MenuItem icon={Trash2} danger onClick={() => onDelete?.(analysis)}>Delete this analysis</MenuItem>
          </Menu>
        </div>
      </div>

      <div className="result-card__body">
        {explanation.summary && <p className="result-card__summary">{explanation.summary}</p>}
        {!showScalarKpis && <KpiStrip kpis={kpis} />}

        <div className="result-card__visual">
          <ResultVisual results={results} view={view} />
        </div>

        {highlights.length > 0 && (
          <div className="result-card__section">
            <p className="result-card__section-title"><Sparkles size={13} /> Key observations</p>
            <ul className="result-card__bullets">{highlights.map((h, i) => <li key={i}>{h}</li>)}</ul>
          </div>
        )}

        {warnings.length > 0 && (
          <div className="result-card__section">
            <p className="result-card__section-title result-card__section-title--warn"><AlertTriangle size={13} /> Things to keep in mind</p>
            <ul className="result-card__warnings">{warnings.map((w, i) => <li key={i}><AlertTriangle size={12} /><span>{w}</span></li>)}</ul>
          </div>
        )}

        {suggested.length > 0 && onAsk && (
          <div className="result-card__section">
            <p className="result-card__section-title">Ask a follow-up</p>
            <div className="chip-row">{suggested.map((q, i) => <button type="button" className="chip" key={i} onClick={() => onAsk(q)}>{q}</button>)}</div>
          </div>
        )}
      </div>

      <PlanPanel plan={plan} meta={planWrap} />

      <div className="result-card__foot">
        <span className={`result-card__prov ${grounded ? '' : 'result-card__prov--warn'}`}>
          {grounded ? <ShieldCheck size={13} /> : <ShieldAlert size={13} />}
          {grounded ? 'Numbers computed deterministically · narrative verified against results' : 'Numbers computed deterministically · parts of the narrative could not be verified'}
        </span>
        {explanation.generated_by === 'deterministic' && <span>Summary generated without AI</span>}
      </div>
    </div>
  );
}
