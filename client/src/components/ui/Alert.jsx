import { AlertCircle, CheckCircle2, Info, TriangleAlert, X } from 'lucide-react';

const KINDS = {
  error: { Icon: AlertCircle, cls: 'alert--error' },
  success: { Icon: CheckCircle2, cls: 'alert--success' },
  warning: { Icon: TriangleAlert, cls: 'alert--warning' },
  info: { Icon: Info, cls: 'alert--info' },
};

export default function Alert({ kind = 'info', title, children, onDismiss, className = '' }) {
  const { Icon, cls } = KINDS[kind] || KINDS.info;
  return (
    <div className={`alert ${cls} ${className}`} role={kind === 'error' ? 'alert' : 'status'}>
      <Icon size={16} className="alert__icon" strokeWidth={2} />
      <div className="alert__content">
        {title && <p className="alert__title">{title}</p>}
        {children && <div className="alert__body">{children}</div>}
      </div>
      {onDismiss && (
        <button className="alert__dismiss" onClick={onDismiss} aria-label="Dismiss">
          <X size={14} />
        </button>
      )}
    </div>
  );
}
