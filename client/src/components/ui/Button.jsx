const VARIANTS = {
  primary: 'button--primary',
  secondary: 'button--secondary',
  ghost: 'button--ghost',
  soft: 'button--soft',
  danger: 'button--danger',
  'danger-ghost': 'button--danger-ghost',
  dark: 'button--dark',
};

const SIZES = { sm: 'button--sm', md: 'button--md', lg: 'button--lg' };

export default function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon: Icon,
  iconRight: IconRight,
  block = false,
  children,
  className = '',
  disabled,
  type = 'button',
  ...rest
}) {
  const iconOnly = !children && (Icon || IconRight);
  return (
    <button
      type={type}
      className={`button ${VARIANTS[variant] || VARIANTS.primary} ${SIZES[size] || SIZES.md} ${iconOnly ? 'button--icon-only' : ''} ${block ? 'button--block' : ''} ${className}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <span className="button__spinner" aria-hidden="true" /> : Icon && <Icon className="button__icon" size={size === 'sm' ? 14 : 16} strokeWidth={2} />}
      {children}
      {!loading && IconRight && <IconRight className="button__icon" size={size === 'sm' ? 14 : 16} strokeWidth={2} />}
    </button>
  );
}
