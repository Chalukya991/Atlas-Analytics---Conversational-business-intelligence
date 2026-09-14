import { useId } from 'react';
import { AlertCircle } from 'lucide-react';

export function Field({ label, hint, error, required, children, id: idProp }) {
  const auto = useId();
  const id = idProp || auto;
  return (
    <div className="field">
      {label && (
        <label className="field__label" htmlFor={id}>
          {label}
          {required && <span className="field__required">*</span>}
        </label>
      )}
      {typeof children === 'function' ? children(id) : children}
      {hint && !error && <p className="field__hint">{hint}</p>}
      {error && (
        <p className="field__error" role="alert">
          <AlertCircle size={12} /> {error}
        </p>
      )}
    </div>
  );
}

export function Input({ invalid = false, className = '', size, ...rest }) {
  return <input className={`input ${size === 'sm' ? 'input--sm' : ''} ${invalid ? 'input--invalid' : ''} ${className}`} {...rest} />;
}

export function Textarea({ invalid = false, className = '', ...rest }) {
  return <textarea className={`input input--area ${invalid ? 'input--invalid' : ''} ${className}`} {...rest} />;
}

export function Select({ invalid = false, className = '', size, children, ...rest }) {
  return (
    <select className={`input select ${size === 'sm' ? 'input--sm' : ''} ${invalid ? 'input--invalid' : ''} ${className}`} {...rest}>
      {children}
    </select>
  );
}

export function IconInput({ icon: Icon, suffix, ...rest }) {
  return (
    <div className="input-wrap">
      {Icon && <Icon size={15} className="input-wrap__icon" />}
      <Input {...rest} />
      {suffix && <span className="input-wrap__suffix">{suffix}</span>}
    </div>
  );
}

export function Checkbox({ label, ...rest }) {
  return (
    <label className="check">
      <input type="checkbox" {...rest} />
      {label}
    </label>
  );
}
