export default function Tabs({ tabs, value, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          type="button"
          aria-selected={value === t.id}
          className={`tabs__tab ${value === t.id ? 'is-active' : ''}`}
          onClick={() => onChange(t.id)}
        >
          {t.icon && <t.icon size={14} />}
          {t.label}
          {t.count !== undefined && <span className="tabs__count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}
