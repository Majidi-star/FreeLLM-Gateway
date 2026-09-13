import React from 'react';
import { ThemeProvider } from './context/ThemeContext.js';
import { AppShell } from './components/layout/AppShell.js';
import { ErrorBoundary } from './components/common/ErrorBoundary.js';
import './globals.css';

export const App: React.FC = () => {
  return (
    <ThemeProvider>
      <ErrorBoundary>
        <AppShell />
      </ErrorBoundary>
    </ThemeProvider>
  );
};

export default App;
