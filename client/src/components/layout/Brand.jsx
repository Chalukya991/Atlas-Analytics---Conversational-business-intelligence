import { useId } from 'react';

export default function Logo({ size = 30 }) {
  const id = useId().replace(/:/g, '');
  return (
    <span className="logo" style={{ width: size, height: size }}>
      <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
        <defs>
          <linearGradient id={`lg-${id}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#6366f1" />
            <stop offset="1" stopColor="#22d3ee" />
          </linearGradient>
        </defs>
        <rect width="32" height="32" rx="9" fill={`url(#lg-${id})`} />
        <path d="M9 23V15.5M16 23V9.5M23 23V18" stroke="#fff" strokeWidth="2.7" strokeLinecap="round" />
      </svg>
    </span>
  );
}

export function BrandMark({ compact = false, light = false, size = 30 }) {
  return (
    <span className={`brand ${light ? 'brand--light' : ''}`}>
      <Logo size={size} />
      {!compact && (
        <span className="brand__text">
          <span className="brand__name">Atlas Analytics</span>
          <span className="brand__tag">Conversational business intelligence</span>
        </span>
      )}
    </span>
  );
}
