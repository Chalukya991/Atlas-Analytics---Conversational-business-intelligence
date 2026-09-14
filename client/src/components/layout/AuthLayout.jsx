import { BarChart3, FileSpreadsheet, MessageSquareText, Moon, ShieldCheck, Sun } from 'lucide-react';
import { BrandMark } from './Brand';
import { useTheme } from '../../store/theme';

const FEATURES = [
  { Icon: MessageSquareText, title: 'Ask in plain language', body: '“Total revenue by region last quarter” gets an answer, not a query language.' },
  { Icon: FileSpreadsheet, title: 'Any spreadsheet, cleaned', body: 'Excel and CSV files are profiled, normalized and validated before analysis.' },
  { Icon: BarChart3, title: 'Verified numbers', body: 'Every figure is computed deterministically. The AI explains; it never invents.' },
  { Icon: ShieldCheck, title: 'Built for teams', body: 'Isolated workspaces, revocable sessions and auditable analysis plans.' },
];

const BARS = [38, 52, 46, 70, 64, 88, 76, 100];

export default function AuthLayout({ children, eyebrow }) {
  const { resolved, toggle } = useTheme();
  return (
    <div className="auth">
      <div className="auth__visual">
        <div className="auth__orb auth__orb--1" />
        <div className="auth__orb auth__orb--2" />
        <div className="auth__visual-inner">
          <BrandMark />
          <div className="auth__hero">
            <span className="auth__eyebrow">{eyebrow || 'Atlas Analytics'}</span>
            <h1 className="auth__headline">
              Your data has answers.
              <br />
              <span className="auth__headline-dim">Just ask.</span>
            </h1>
            <p className="auth__lede">Atlas turns spreadsheets into a conversation, answering with verified numbers, charts and boardroom-ready reports.</p>
          </div>

          <div className="auth__preview" aria-hidden="true">
            <div className="auth__preview-q"><span>How did monthly revenue trend this year?</span></div>
            <div className="auth__preview-a">
              <div className="auth__preview-kpis">
                <div className="auth__preview-kpi"><b>$4.2M</b><small>Total revenue</small></div>
                <div className="auth__preview-kpi"><b>+18.4%</b><small>vs first month</small></div>
                <div className="auth__preview-kpi"><b>Aug</b><small>Peak month</small></div>
              </div>
              <div className="auth__preview-bars">
                {BARS.map((h, i) => <i key={i} style={{ height: `${h}%`, animationDelay: `${i * 60}ms` }} />)}
              </div>
              <p className="auth__preview-text"><b>Revenue grew steadily</b> with the strongest month in August. Two rows had unreadable dates and were excluded.</p>
            </div>
          </div>

          <div className="auth__features">
            {FEATURES.map(({ Icon, title, body }) => (
              <div className="auth__feature" key={title}>
                <span className="auth__feature-icon"><Icon size={16} strokeWidth={1.8} /></span>
                <div>
                  <p className="auth__feature-title">{title}</p>
                  <p className="auth__feature-body">{body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="auth__panel">
        <button className="icon-btn auth__theme" onClick={toggle} aria-label="Toggle theme" title="Toggle theme">
          {resolved === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </button>
        {children}
      </div>
    </div>
  );
}
