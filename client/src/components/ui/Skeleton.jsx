export function Skeleton({ height, width = '100%', radius = 'var(--radius-md)', className = '' }) {
  return (
    <div
      className={`skeleton ${className}`}
      style={{ height, width, borderRadius: radius }}
      aria-hidden="true"
    />
  );
}

export function SkeletonLines({ count = 3 }) {
  return (
    <div className="skeleton-stack">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} height={12} width={`${100 - i * 14}%`} />
      ))}
    </div>
  );
}