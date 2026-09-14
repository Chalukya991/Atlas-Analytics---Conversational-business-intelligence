import { AlertCircle, CheckCircle2, Info, TriangleAlert, X } from 'lucide-react';
import { useToasts } from '../../store/toast';

const ICONS = { success: CheckCircle2, error: AlertCircle, info: Info, warning: TriangleAlert };

export default function Toaster() {
  const { toasts, dismiss } = useToasts();
  if (!toasts.length) return null;
  return (
    <div className="toaster" aria-live="polite">
      {toasts.map((t) => {
        const Icon = ICONS[t.kind] || Info;
        return (
          <div className={`toast toast--${t.kind}`} key={t.id} role="status">
            <Icon size={16} className="toast__icon" />
            <div className="grow">
              {t.title && <p className="toast__title">{t.title}</p>}
              {t.body && <p className="toast__body">{t.body}</p>}
            </div>
            <button className="icon-btn icon-btn--sm" onClick={() => dismiss(t.id)} aria-label="Dismiss">
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
