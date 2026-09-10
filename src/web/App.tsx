import React from 'react';
import { ThemeProvider } from './context/ThemeContext.js';
import { AppShell } from './components/layout/AppShell.js';
import { ErrorBoundary } from './components/common/ErrorBoundary.js';
import './globals.css';

export const App: React.FC = () => {
  React.useEffect(() => {
    if (!localStorage.getItem('goalroute_admin_token')) {
      localStorage.setItem('goalroute_admin_token', 'dev-admin-secret-token');
    }
  }, []);

  return (
    <ThemeProvider>
      <ErrorBoundary>
        <AppShell />
      </ErrorBoundary>
    </ThemeProvider>
  );
};

export default App;
