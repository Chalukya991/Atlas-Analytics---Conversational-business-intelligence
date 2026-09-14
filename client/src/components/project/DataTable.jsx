import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight } from 'lucide-react';
import { formatValue, humanize } from '../../lib/format';

export default function DataTable({ rows, columns, pageSize = 10, compact = false, emptyText = 'No rows returned' }) {
  const [sort, setSort] = useState(null);
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(pageSize);

  const heads = useMemo(() => {
    const base = columns && columns.length ? columns : Object.keys(rows?.[0] || {});
    return base.filter((c) => !String(c).startsWith('_'));
  }, [columns, rows]);

  const numeric = useMemo(() => {
    const set = new Set();
    for (const h of heads) {
      if ((rows || []).some((r) => typeof r[h] === 'number')) set.add(h);
    }
    return set;
  }, [heads, rows]);

  const sorted = useMemo(() => {
    if (!rows) return [];
    if (!sort) return rows;
    const { key, dir } = sort;
    const mult = dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = a[key];
      const bv = b[key];
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * mult;
      return String(av).localeCompare(String(bv), undefined, { numeric: true }) * mult;
    });
  }, [rows, sort]);

  if (!rows || rows.length === 0) return <div className="chart-empty">{emptyText}</div>;

  const pages = Math.max(1, Math.ceil(sorted.length / size));
  const current = Math.min(page, pages - 1);
  const slice = sorted.slice(current * size, current * size + size);

  const toggleSort = (key) => {
    setPage(0);
    setSort((s) => {
      if (!s || s.key !== key) return { key, dir: numeric.has(key) ? 'desc' : 'asc' };
      if (s.dir === 'desc') return { key, dir: 'asc' };
      return null;
    });
  };

  return (
    <div className="table-wrap">
      <table className={`table ${compact ? 'table--compact' : ''}`}>
        <thead>
          <tr>
            {heads.map((h) => (
              <th key={h} className={`sortable ${numeric.has(h) ? 'num' : ''}`} onClick={() => toggleSort(h)} aria-sort={sort?.key === h ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                {humanize(h)}
                {sort?.key === h && <span className="sort-ind">{sort.dir === 'asc' ? <ArrowUp size={11} /> : <ArrowDown size={11} />}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {slice.map((row, i) => (
            <tr key={current * size + i}>
              {heads.map((h) => {
                const v = row[h];
                const empty = v === null || v === undefined || v === '';
                return (
                  <td key={h} className={`${numeric.has(h) ? 'num' : ''} ${empty ? 'muted' : ''}`} title={empty ? undefined : String(v)}>
                    {formatValue(v, h)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {(sorted.length > size || sorted.length > 10) && (
        <div className="table-foot">
          <span>
            {current * size + 1}–{Math.min(sorted.length, (current + 1) * size)} of {sorted.length} rows
          </span>
          <span className="table-foot__pages">
            <select className="input input--sm select" style={{ height: 26, width: 'auto', paddingRight: 26, fontSize: 'var(--text-2xs)' }} value={size} onChange={(e) => { setSize(Number(e.target.value)); setPage(0); }} aria-label="Rows per page">
              {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n} / page</option>)}
            </select>
            <button className="icon-btn icon-btn--sm" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={current === 0} aria-label="Previous page"><ChevronLeft size={14} /></button>
            <span>{current + 1} / {pages}</span>
            <button className="icon-btn icon-btn--sm" onClick={() => setPage((p) => Math.min(pages - 1, p + 1))} disabled={current >= pages - 1} aria-label="Next page"><ChevronRight size={14} /></button>
          </span>
        </div>
      )}
    </div>
  );
}
