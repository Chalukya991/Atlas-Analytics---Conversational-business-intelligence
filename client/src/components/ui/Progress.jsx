export default function Progress({ value, indeterminate = false, className = '' }) {
  const pct = Math.max(0, Math.min(100, Number(value) || 0));
  return (
    <div className={`progress ${indeterminate ? 'progress--indeterminate' : ''} ${className}`} role="progressbar" aria-valuenow={indeterminate ? undefined : pct} aria-valuemin={0} aria-valuemax={100}>
      <div className="progress__bar" style={indeterminate ? undefined : { width: `${pct}%` }} />
    </div>
  );
}
