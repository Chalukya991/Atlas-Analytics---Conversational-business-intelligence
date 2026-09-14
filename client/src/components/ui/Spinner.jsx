export function Spinner({ size = 18, className = '' }) {
  return <span className={`spinner ${className}`} style={{ width: size, height: size }} aria-hidden="true" />;
}

export function Dots({ label }) {
  return (
    <span className="dots" role="status">
      <span className="dots__label">{label}</span>
      <span className="dots__track">
        <i />
        <i />
        <i />
      </span>
    </span>
  );
}