import { Component } from 'react';
import { RefreshCcw, TriangleAlert } from 'lucide-react';
import Button from './Button';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('UI crashed', error, info?.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.inline) {
      return (
        <div className="alert alert--error" role="alert">
          <TriangleAlert size={16} className="alert__icon" />
          <div className="alert__content">
            <p className="alert__title">This section could not be displayed.</p>
            <div className="alert__body">{String(error.message || error)}</div>
          </div>
        </div>
      );
    }
    return (
      <div className="crash">
        <div className="card card--pad-lg crash__card">
          <div className="empty__icon" style={{ margin: '0 auto 12px', background: 'var(--danger-soft)', color: 'var(--danger)' }}>
            <TriangleAlert size={22} />
          </div>
          <h1 className="empty__title">Something went wrong</h1>
          <p className="empty__message" style={{ margin: '8px auto 0' }}>
            The page hit an unexpected error. Reloading usually fixes it. If it keeps happening, the details below help us debug.
          </p>
          <div className="empty__action" style={{ justifyContent: 'center' }}>
            <Button icon={RefreshCcw} onClick={() => window.location.reload()}>Reload</Button>
            <Button variant="ghost" onClick={() => { window.location.href = '/'; }}>Go home</Button>
          </div>
          <pre className="crash__pre">{String(error.stack || error.message || error)}</pre>
        </div>
      </div>
    );
  }
}
