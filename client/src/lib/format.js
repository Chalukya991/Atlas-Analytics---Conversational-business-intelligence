const nf = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const nfInt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const nfCompact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const nfPct = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 1 });

const PERCENT_KEYS = /(^|_)(share|change_pct|fill_rate|pct|percent|ratio)$/i;

export function isPercentKey(key) {
  return PERCENT_KEYS.test(String(key || ''));
}

export function formatNumber(value) {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  if (Number.isNaN(n)) return String(value);
  if (Number.isInteger(n) && Math.abs(n) >= 1000) return nfInt.format(n);
  return nf.format(n);
}

export function formatCompact(value) {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  if (Number.isNaN(n)) return String(value);
  if (Math.abs(n) < 1000) return nf.format(n);
  return nfCompact.format(n);
}

export function formatPercent(value, { signed = false } = {}) {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  if (Number.isNaN(n)) return String(value);
  const s = nfPct.format(n);
  return signed && n > 0 ? `+${s}` : s;
}

/** Format a cell according to its column key (percentages, numbers, text). */
export function formatValue(value, key) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'number') {
    if (isPercentKey(key)) return formatPercent(value, { signed: /change/.test(String(key)) });
    return formatNumber(value);
  }
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function humanize(key) {
  if (key === null || key === undefined) return '';
  return String(key)
    .replace(/^_/, '')
    .replace(/_/g, ' ')
    .replace(/\b(avg)\b/i, 'average')
    .replace(/\b(std)\b/i, 'std dev')
    .replace(/\b(count unique)\b/i, 'distinct')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function capitalize(value) {
  if (!value) return '';
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function operationLabel(op) {
  const map = {
    describe: 'Data overview',
    aggregate: 'Aggregation',
    top: 'Ranking',
    time_series: 'Trend',
    compare: 'Comparison',
    distribution: 'Distribution',
  };
  return map[op] || capitalize(op);
}

export function humanBytes(bytes) {
  if (bytes === null || bytes === undefined) return '—';
  const n = Number(bytes);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

export function formatTime(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function initials(name) {
  return String(name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('');
}

export function pluralize(n, word, plural) {
  return `${formatNumber(n)} ${n === 1 ? word : plural || `${word}s`}`;
}
