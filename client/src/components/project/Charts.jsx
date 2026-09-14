import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { formatCompact, formatNumber, formatValue, humanize, isPercentKey } from '../../lib/format';

const PALETTE = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)', 'var(--chart-6)'];

function useContainerWidth(min = 320) {
  const ref = useRef(null);
  const [width, setWidth] = useState(min);
  useEffect(() => {
    if (!ref.current) return undefined;
    const el = ref.current;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width || el.clientWidth;
      setWidth(Math.max(min, Math.floor(w)));
    });
    ro.observe(el);
    setWidth(Math.max(min, el.clientWidth));
    return () => ro.disconnect();
  }, [min]);
  return [ref, width];
}

function niceTicks(min, max, count = 4) {
  if (min === max) {
    if (min === 0) return [0, 1];
    const pad = Math.abs(min) * 0.1;
    min -= pad;
    max += pad;
  }
  const span = max - min;
  const rough = span / count;
  const mag = 10 ** Math.floor(Math.log10(rough));
  const norm = rough / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const start = Math.floor(min / step) * step;
  const end = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = start; v <= end + step / 2; v += step) ticks.push(Number(v.toFixed(10)));
  return ticks;
}

function fmtTick(v, key) {
  if (isPercentKey(key)) return `${Math.round(v * 100)}%`;
  return formatCompact(v);
}

function truncate(s, n) {
  const str = String(s ?? '');
  return str.length > n ? `${str.slice(0, n - 1)}…` : str;
}

function Tooltip({ tip }) {
  if (!tip) return null;
  return (
    <div className="chart__tip" style={{ left: tip.x, top: tip.y }}>
      <small>{tip.label}</small>
      <b>{tip.value}</b>
      {tip.extra && <small>{tip.extra}</small>}
    </div>
  );
}

function useTip() {
  const [tip, setTip] = useState(null);
  const wrapRef = useRef(null);
  const show = (e, data) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    setTip({ x: e.clientX - rect.left, y: e.clientY - rect.top, ...data });
  };
  return { tip, show, hide: () => setTip(null), wrapRef };
}

/**
 * Bar chart with a real y-axis, zero baseline, negative values and tooltips.
 * `series` = [{ key, label, color }]; defaults to a single series.
 */
export function BarChart({ data, xKey, yKey, series, height = 240, horizontal = false, title, xLabel, yLabel }) {
  const uid = useId().replace(/:/g, '');
  const [ref, width] = useContainerWidth(320);
  const { tip, show, hide, wrapRef } = useTip();
  const [active, setActive] = useState(null);
  const ser = useMemo(() => (series && series.length ? series : [{ key: yKey, label: humanize(yKey) }]), [series, yKey]);

  const rows = useMemo(() => (Array.isArray(data) ? data : []).map((r) => ({ label: String(r[xKey] ?? '—'), values: ser.map((s) => (Number.isFinite(Number(r[s.key])) && r[s.key] !== null ? Number(r[s.key]) : null)), raw: r })), [data, xKey, ser]);

  if (!rows.length) return <div className="chart-empty">No data to chart</div>;

  const all = rows.flatMap((r) => r.values).filter((v) => v !== null);
  const rawMin = Math.min(0, ...all);
  const rawMax = Math.max(0, ...all);
  const ticks = niceTicks(rawMin, rawMax, horizontal ? 5 : 4);
  const tMin = ticks[0];
  const tMax = ticks[ticks.length - 1];
  const range = tMax - tMin || 1;
  const primaryKey = ser[0].key;

  const head = (
    <div className="chart__head">
      <span className="chart__title">{title || `${ser.map((s) => s.label).join(', ')} by ${humanize(xKey)}`}</span>
      {ser.length > 1 && (
        <div className="chart__legend">
          {ser.map((s, i) => (
            <span className="chart__legend-item" key={s.key}><i style={{ background: s.color || PALETTE[i % PALETTE.length] }} />{s.label}</span>
          ))}
        </div>
      )}
    </div>
  );

  if (horizontal) {
    const rowH = Math.max(22, 30 - Math.floor(rows.length / 10) * 2);
    const labelW = Math.min(180, Math.max(80, Math.max(...rows.map((r) => r.label.length)) * 6.5));
    const valueW = 64;
    const padTop = 8;
    const axisH = 20;
    const plotW = Math.max(120, width - labelW - valueW - 16);
    const svgH = rows.length * rowH + padTop + axisH;
    const x = (v) => labelW + ((v - tMin) / range) * plotW;
    const zero = x(0);
    const bandH = (rowH - 6) / ser.length;

    return (
      <div className="chart" ref={ref}>
        {head}
        <div ref={wrapRef} style={{ position: 'relative' }}>
          <svg width={width - 8} height={svgH} role="img" aria-label={title || 'Bar chart'}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={x(t)} x2={x(t)} y1={padTop} y2={svgH - axisH} stroke="var(--chart-grid)" strokeWidth={1} />
                <text x={x(t)} y={svgH - 5} textAnchor="middle" className="chart__axis-label chart__axis-label--y">{fmtTick(t, primaryKey)}</text>
              </g>
            ))}
            <line x1={zero} x2={zero} y1={padTop} y2={svgH - axisH} stroke="var(--chart-axis)" strokeWidth={1} />
            {rows.map((r, i) => {
              const y = padTop + i * rowH;
              return (
                <g key={i} onMouseLeave={() => { hide(); setActive(null); }}>
                  <text x={labelW - 8} y={y + rowH / 2 + 4} textAnchor="end" className="chart__axis-label"><title>{r.label}</title>{truncate(r.label, Math.floor(labelW / 6.5))}</text>
                  {r.values.map((v, si) => {
                    if (v === null) return null;
                    const bx = Math.min(zero, x(v));
                    const bw = Math.max(1.5, Math.abs(x(v) - zero));
                    const by = y + 3 + si * bandH;
                    const isDim = active !== null && active !== i;
                    return (
                      <rect
                        key={si}
                        className={`chart__bar ${isDim ? 'is-dim' : ''}`}
                        x={bx}
                        y={by}
                        width={bw}
                        height={Math.max(2, bandH - 2)}
                        rx={3}
                        fill={v < 0 ? 'var(--chart-negative)' : ser[si].color || PALETTE[si % PALETTE.length]}
                        onMouseMove={(e) => { setActive(i); show(e, { label: r.label, value: formatValue(v, ser[si].key), extra: ser.length > 1 ? ser[si].label : undefined }); }}
                      />
                    );
                  })}
                  {ser.length === 1 && r.values[0] !== null && (
                    <text x={x(Math.max(r.values[0], 0)) + 6} y={y + rowH / 2 + 4} className="chart__value" opacity={active === null || active === i ? 1 : 0.3}>
                      {formatValue(r.values[0], primaryKey)}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
          <Tooltip tip={tip} />
        </div>
      </div>
    );
  }

  const padL = 52;
  const padR = 12;
  const padT = 10;
  const axisH = 28;
  const plotW = width - padL - padR - 8;
  const plotH = height - padT - axisH;
  const slot = plotW / rows.length;
  const groupW = Math.min(slot * 0.68, 64);
  const barW = groupW / ser.length;
  const y = (v) => padT + plotH - ((v - tMin) / range) * plotH;
  const zeroY = y(0);
  const labelEvery = Math.max(1, Math.ceil(rows.length / Math.max(1, Math.floor(plotW / 70))));

  return (
    <div className="chart" ref={ref}>
      {head}
      <div ref={wrapRef} style={{ position: 'relative' }}>
        <svg width={width - 8} height={height} role="img" aria-label={title || 'Bar chart'}>
          <defs>
            {ser.map((s, i) => (
              <linearGradient key={s.key} id={`bar-${uid}-${i}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.color || PALETTE[i % PALETTE.length]} />
                <stop offset="100%" stopColor={s.color || PALETTE[i % PALETTE.length]} stopOpacity={0.75} />
              </linearGradient>
            ))}
          </defs>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={padL} x2={padL + plotW} y1={y(t)} y2={y(t)} stroke="var(--chart-grid)" strokeWidth={1} />
              <text x={padL - 8} y={y(t) + 4} textAnchor="end" className="chart__axis-label chart__axis-label--y">{fmtTick(t, primaryKey)}</text>
            </g>
          ))}
          <line x1={padL} x2={padL + plotW} y1={zeroY} y2={zeroY} stroke="var(--chart-axis)" strokeWidth={1} />
          {rows.map((r, i) => {
            const gx = padL + i * slot + (slot - groupW) / 2;
            const isDim = active !== null && active !== i;
            return (
              <g key={i} onMouseLeave={() => { hide(); setActive(null); }}>
                <rect x={padL + i * slot} y={padT} width={slot} height={plotH} fill="transparent" onMouseMove={(e) => { setActive(i); show(e, { label: r.label, value: ser.map((s, si) => (r.values[si] === null ? '—' : formatValue(r.values[si], s.key))).join(' · ') }); }} />
                {r.values.map((v, si) => {
                  if (v === null) return null;
                  const top = Math.min(y(v), zeroY);
                  const h = Math.max(1.5, Math.abs(y(v) - zeroY));
                  return (
                    <rect
                      key={si}
                      className={`chart__bar ${isDim ? 'is-dim' : ''}`}
                      x={gx + si * barW}
                      y={top}
                      width={Math.max(2, barW - 2)}
                      height={h}
                      rx={3}
                      fill={v < 0 ? 'var(--chart-negative)' : `url(#bar-${uid}-${si})`}
                      style={{ pointerEvents: 'none' }}
                    />
                  );
                })}
                {i % labelEvery === 0 && (
                  <text x={padL + i * slot + slot / 2} y={height - 8} textAnchor="middle" className="chart__axis-label"><title>{r.label}</title>{truncate(r.label, Math.max(4, Math.floor((slot * labelEvery) / 7)))}</text>
                )}
              </g>
            );
          })}
        </svg>
        <Tooltip tip={tip} />
      </div>
      {(xLabel || yLabel) && <div className="chart__head" style={{ paddingTop: 4 }}><span className="chart__legend-item">{yLabel}</span><span className="chart__legend-item">{xLabel}</span></div>}
    </div>
  );
}

/** Line chart with area fill, dots, axes and hover tooltip. */
export function LineChart({ data, xKey, yKey, series, height = 240, title }) {
  const uid = useId().replace(/:/g, '');
  const [ref, width] = useContainerWidth(320);
  const { tip, show, hide, wrapRef } = useTip();
  const [active, setActive] = useState(null);
  const ser = useMemo(() => (series && series.length ? series : [{ key: yKey, label: humanize(yKey) }]), [series, yKey]);
  const rows = useMemo(() => (Array.isArray(data) ? data : []).map((r) => ({ label: String(r[xKey] ?? ''), values: ser.map((s) => (r[s.key] === null || r[s.key] === undefined || Number.isNaN(Number(r[s.key])) ? null : Number(r[s.key]))) })), [data, xKey, ser]);

  if (rows.length < 2) return <BarChart data={data} xKey={xKey} yKey={yKey} series={series} height={height} title={title} />;

  const all = rows.flatMap((r) => r.values).filter((v) => v !== null);
  const ticks = niceTicks(Math.min(0, ...all), Math.max(0, ...all), 4);
  const tMin = ticks[0];
  const tMax = ticks[ticks.length - 1];
  const range = tMax - tMin || 1;
  const padL = 52;
  const padR = 16;
  const padT = 12;
  const axisH = 28;
  const plotW = width - padL - padR - 8;
  const plotH = height - padT - axisH;
  const x = (i) => padL + (rows.length === 1 ? plotW / 2 : (i / (rows.length - 1)) * plotW);
  const y = (v) => padT + plotH - ((v - tMin) / range) * plotH;
  const labelEvery = Math.max(1, Math.ceil(rows.length / Math.max(1, Math.floor(plotW / 72))));

  const paths = ser.map((s, si) => {
    let d = '';
    let area = '';
    let started = false;
    rows.forEach((r, i) => {
      const v = r.values[si];
      if (v === null) {
        started = false;
        return;
      }
      const px = x(i);
      const py = y(v);
      d += `${started ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`;
      started = true;
    });
    if (si === 0) {
      const pts = rows.map((r, i) => (r.values[0] === null ? null : [x(i), y(r.values[0])])).filter(Boolean);
      if (pts.length > 1) {
        area = `M${pts[0][0]},${y(Math.max(0, tMin))} ${pts.map((p) => `L${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')} L${pts[pts.length - 1][0]},${y(Math.max(0, tMin))} Z`;
      }
    }
    return { d, area, color: s.color || PALETTE[si % PALETTE.length] };
  });

  return (
    <div className="chart" ref={ref}>
      <div className="chart__head">
        <span className="chart__title">{title || `${ser.map((s) => s.label).join(', ')} over time`}</span>
        {ser.length > 1 && (
          <div className="chart__legend">{ser.map((s, i) => <span className="chart__legend-item" key={s.key}><i style={{ background: s.color || PALETTE[i % PALETTE.length] }} />{s.label}</span>)}</div>
        )}
      </div>
      <div ref={wrapRef} style={{ position: 'relative' }} onMouseLeave={() => { hide(); setActive(null); }}>
        <svg width={width - 8} height={height} role="img" aria-label={title || 'Line chart'}>
          <defs>
            <linearGradient id={`area-${uid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={paths[0].color} stopOpacity={0.9} />
              <stop offset="100%" stopColor={paths[0].color} stopOpacity={0} />
            </linearGradient>
          </defs>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={padL} x2={padL + plotW} y1={y(t)} y2={y(t)} stroke="var(--chart-grid)" strokeWidth={1} />
              <text x={padL - 8} y={y(t) + 4} textAnchor="end" className="chart__axis-label chart__axis-label--y">{fmtTick(t, ser[0].key)}</text>
            </g>
          ))}
          {tMin < 0 && <line x1={padL} x2={padL + plotW} y1={y(0)} y2={y(0)} stroke="var(--chart-axis)" strokeWidth={1} />}
          {paths[0].area && <path d={paths[0].area} className="chart__area" fill={`url(#area-${uid})`} />}
          {paths.map((p, i) => <path key={i} d={p.d} className="chart__line" stroke={p.color} />)}
          {rows.map((r, i) => (
            <g key={i}>
              <rect x={x(i) - (plotW / rows.length) / 2} y={padT} width={plotW / rows.length} height={plotH} fill="transparent" onMouseMove={(e) => { setActive(i); show(e, { label: r.label, value: ser.map((s, si) => (r.values[si] === null ? '—' : formatValue(r.values[si], s.key))).join(' · ') }); }} />
              {r.values.map((v, si) => v !== null && (
                <circle key={si} className="chart__dot" cx={x(i)} cy={y(v)} r={active === i ? 5 : rows.length > 40 ? 0 : 3} fill="var(--bg-surface)" stroke={paths[si].color} strokeWidth={2} style={{ pointerEvents: 'none' }} />
              ))}
              {(i % labelEvery === 0 || i === rows.length - 1) && (
                <text x={x(i)} y={height - 8} textAnchor={i === 0 ? 'start' : i === rows.length - 1 ? 'end' : 'middle'} className="chart__axis-label">{truncate(r.label, 10)}</text>
              )}
            </g>
          ))}
          {active !== null && <line x1={x(active)} x2={x(active)} y1={padT} y2={padT + plotH} stroke="var(--chart-axis)" strokeDasharray="3 3" strokeWidth={1} />}
        </svg>
        <Tooltip tip={tip} />
      </div>
    </div>
  );
}

export function MiniBars({ values = [], height = 36 }) {
  const max = Math.max(1, ...values.map((v) => Math.abs(Number(v) || 0)));
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height }} aria-hidden="true">
      {values.map((v, i) => <i key={i} style={{ flex: 1, height: `${Math.max(6, (Math.abs(Number(v) || 0) / max) * 100)}%`, background: Number(v) < 0 ? 'var(--chart-negative)' : 'var(--chart-1)', borderRadius: 2, opacity: 0.85 }} />)}
    </div>
  );
}

export { formatNumber };
