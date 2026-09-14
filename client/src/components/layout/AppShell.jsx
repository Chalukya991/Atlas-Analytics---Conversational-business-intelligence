import Sidebar from './Sidebar';
import ErrorBoundary from '../ui/ErrorBoundary';

export default function AppShell({ children }) {
  return (
    <div className="app-shell">
      <Sidebar />
      <main className="app-main">
        <ErrorBoundary>{children}</ErrorBoundary>
      </main>
    </div>
  );
}
