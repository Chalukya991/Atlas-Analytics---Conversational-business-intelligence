import { useEffect, useRef, useState } from 'react';

/**
 * Minimal accessible dropdown menu. `trigger` receives ({open, toggle}).
 */
export default function Menu({ trigger, children, align = 'right' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="menu-anchor" ref={ref}>
      {trigger({ open, toggle: (e) => { e?.preventDefault?.(); e?.stopPropagation?.(); setOpen((v) => !v); } })}
      {open && (
        <div className={`menu ${align === 'left' ? 'menu--left' : ''}`} role="menu" onClick={(e) => { e.stopPropagation(); setOpen(false); }}>
          {children}
        </div>
      )}
    </div>
  );
}

export function MenuItem({ icon: Icon, children, danger = false, ...rest }) {
  return (
    <button type="button" role="menuitem" className={`menu__item ${danger ? 'menu__item--danger' : ''}`} {...rest}>
      {Icon && <Icon size={15} />}
      {children}
    </button>
  );
}

export function MenuSeparator() {
  return <div className="menu__sep" role="separator" />;
}

export function MenuLabel({ children }) {
  return <div className="menu__label">{children}</div>;
}
