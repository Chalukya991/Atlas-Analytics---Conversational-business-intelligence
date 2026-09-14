const TONES = {
  neutral: 'badge--neutral',
  success: 'badge--success',
  warning: 'badge--warning',
  danger: 'badge--danger',
  info: 'badge--info',
  brand: 'badge--brand',
  accent: 'badge--accent',
  outline: 'badge--outline',
};

export default function Badge({ tone = 'neutral', dot = false, pulse = false, children, className = '', title }) {
  return (
    <span className={`badge ${TONES[tone] || TONES.neutral} ${pulse ? 'badge--pulse' : ''} ${className}`} title={title}>
      {dot && <span className="badge__dot" aria-hidden="true" />}
      {children}
    </span>
  );
}

export function statusTone(status) {
  switch (status) {
    case 'ready':
    case 'completed':
      return 'success';
    case 'failed':
      return 'danger';
    case 'queued':
    case 'processing':
    case 'running':
    case 'pending':
      return 'warning';
    default:
      return 'neutral';
  }
}

export function statusLabel(status) {
  switch (status) {
    case 'ready': return 'Ready';
    case 'completed': return 'Done';
    case 'failed': return 'Failed';
    case 'queued': return 'Queued';
    case 'processing': return 'Processing';
    case 'running': return 'Running';
    default: return status || 'Pending';
  }
}
