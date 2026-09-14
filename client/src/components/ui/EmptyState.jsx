export default function EmptyState({ icon: Icon, title, message, action, compact = false }) {
  return (
    <div className={`empty ${compact ? 'empty--compact' : ''}`}>
      {Icon && (
        <div className="empty__icon">
          <Icon size={compact ? 18 : 24} strokeWidth={1.8} />
        </div>
      )}
      <h3 className="empty__title">{title}</h3>
      {message && <p className="empty__message">{message}</p>}
      {action && <div className="empty__action">{action}</div>}
    </div>
  );
}
