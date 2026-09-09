import React from 'react';
import { ThemeProvider } from './context/ThemeContext.js';
import { AppShell } from './components/layout/AppShell.js';
import './globals.css';

export const App: React.FC = () => {
  return (
    <ThemeProvider>
      <AppShell />
    </ThemeProvider>
  );
};

export default App;
