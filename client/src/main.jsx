import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles/global.css';
import './styles/ui.css';
import './styles/layout.css';
import './styles/auth.css';
import './styles/dashboard.css';
import './styles/workspace.css';
import './store/theme';
import App from './App';
import ErrorBoundary from './components/ui/ErrorBoundary';
import Toaster from './components/ui/Toaster';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
      <Toaster />
    </ErrorBoundary>
  </React.StrictMode>,
);
