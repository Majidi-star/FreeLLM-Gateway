import React, { createContext, useContext, useState, useEffect } from 'react';

export type ThemePreset = 'Dark' | 'Light' | 'Custom';

export type ColorTokens = {
  '--bg-obsidian': string;
  '--bg-rail': string;
  '--bg-card': string;
  '--bg-card-active': string;
  '--bg-well': string;
  '--border-subtle': string;
  '--border-hover': string;
  '--accent-primary': string;
  '--accent-primary-hover': string;
  '--signal-mint': string;
  '--signal-amber': string;
  '--signal-coral': string;
  '--text-primary': string;
  '--text-secondary': string;
  '--text-muted': string;
  '--text-bright': string;
};

export const PRESET_THEMES: Record<Exclude<ThemePreset, 'Custom'>, ColorTokens> = {
  'Dark': {
    '--bg-obsidian': '#101010',
    '--bg-rail': '#141414',
    '--bg-card': '#1a1a1a',
    '--bg-card-active': '#222222',
    '--bg-well': '#0d0d0d',
    '--border-subtle': 'rgba(255, 255, 255, 0.08)',
    '--border-hover': 'rgba(255, 255, 255, 0.2)',
    '--accent-primary': '#007acc',
    '--accent-primary-hover': '#1f8ad2',
    '--signal-mint': '#00f5a0',
    '--signal-amber': '#ffb800',
    '--signal-coral': '#f55036',
    '--text-primary': '#CCCCCC',
    '--text-secondary': '#999999',
    '--text-muted': '#666666',
    '--text-bright': '#FFFFFF',
  },
  'Light': {
    '--bg-obsidian': '#F9F9F9',
    '--bg-rail': '#F0F0F0',
    '--bg-card': '#FFFFFF',
    '--bg-card-active': '#EAEAEA',
    '--bg-well': '#F3F3F3',
    '--border-subtle': 'rgba(0, 0, 0, 0.1)',
    '--border-hover': 'rgba(0, 0, 0, 0.25)',
    '--accent-primary': '#007acc',
    '--accent-primary-hover': '#005fa3',
    '--signal-mint': '#10b981',
    '--signal-amber': '#d97706',
    '--signal-coral': '#dc2626',
    '--text-primary': '#101010',
    '--text-secondary': '#444444',
    '--text-muted': '#777777',
    '--text-bright': '#000000',
  },
};

const COLOR_REGEX = /^(#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})|rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\))$/;

export const ALLOWED_TOKENS = [
  '--bg-obsidian',
  '--bg-rail',
  '--bg-card',
  '--bg-card-active',
  '--bg-well',
  '--border-subtle',
  '--border-hover',
  '--accent-primary',
  '--accent-primary-hover',
  '--signal-mint',
  '--signal-amber',
  '--signal-coral',
  '--text-primary',
  '--text-secondary',
  '--text-muted',
  '--text-bright',
];

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

interface ThemeContextType {
  preset: ThemePreset;
  tokens: ColorTokens;
  setPreset: (preset: ThemePreset) => void;
  updateToken: (key: keyof ColorTokens, value: string) => void;
  resetTheme: () => void;
  exportTheme: () => string;
  importTheme: (jsonString: string) => boolean;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [preset, setPresetState] = useState<ThemePreset>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('goalroute_theme_preset');
      if (saved === 'Antigravity Dark' || saved === 'Dark') return 'Dark';
      if (saved === 'Antigravity Light' || saved === 'Light') return 'Light';
      if (saved === 'Custom') return 'Custom';
    }
    return 'Dark';
  });

  const [tokens, setTokensState] = useState<ColorTokens>(() => {
    if (typeof window !== 'undefined') {
      const savedTokens = localStorage.getItem('goalroute_theme_tokens');
      if (savedTokens) {
        try {
          return JSON.parse(savedTokens);
        } catch {
          // fallback
        }
      }
    }
    return PRESET_THEMES['Dark'];
  });

  const applyTokensToDOM = (toks: ColorTokens) => {
    if (typeof document !== 'undefined') {
      Object.entries(toks).forEach(([key, val]) => {
        document.documentElement.style.setProperty(key, val);
      });
    }
  };

  useEffect(() => {
    applyTokensToDOM(tokens);
  }, [tokens]);

  const setPreset = (newPreset: ThemePreset) => {
    setPresetState(newPreset);
    if (newPreset !== 'Custom') {
      const newTokens = PRESET_THEMES[newPreset];
      setTokensState(newTokens);
      applyTokensToDOM(newTokens);
      localStorage.setItem('goalroute_theme_tokens', JSON.stringify(newTokens));
    }
    localStorage.setItem('goalroute_theme_preset', newPreset);
  };

  const updateToken = (key: keyof ColorTokens, value: string) => {
    setPresetState('Custom');
    localStorage.setItem('goalroute_theme_preset', 'Custom');
    const updated = { ...tokens, [key]: value };
    setTokensState(updated);
    applyTokensToDOM(updated);
    localStorage.setItem('goalroute_theme_tokens', JSON.stringify(updated));
  };

  const resetTheme = () => {
    setPreset('Dark');
  };

  const exportTheme = () => {
    return JSON.stringify({ preset, tokens }, null, 2);
  };

  const importTheme = (jsonString: string): boolean => {
    try {
      const parsed = JSON.parse(jsonString);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return false;
      }

      for (const key of Object.keys(parsed)) {
        if (FORBIDDEN_KEYS.has(key)) {
          return false;
        }
      }

      const importedTokens = parsed.tokens !== undefined ? parsed.tokens : parsed;
      if (!importedTokens || typeof importedTokens !== 'object' || Array.isArray(importedTokens)) {
        return false;
      }

      const tokenKeys = Object.keys(importedTokens);
      if (tokenKeys.length === 0) {
        return false;
      }

      for (const key of tokenKeys) {
        if (FORBIDDEN_KEYS.has(key)) {
          return false;
        }
        if (!ALLOWED_TOKENS.includes(key)) {
          return false;
        }
        const val = importedTokens[key];
        if (typeof val !== 'string' || !COLOR_REGEX.test(val)) {
          return false;
        }
      }

      const updated = { ...tokens, ...importedTokens };
      setPresetState('Custom');
      setTokensState(updated);
      applyTokensToDOM(updated);
      localStorage.setItem('goalroute_theme_preset', 'Custom');
      localStorage.setItem('goalroute_theme_tokens', JSON.stringify(updated));
      return true;
    } catch (e) {
      console.error('Failed to import theme JSON', e);
    }
    return false;
  };

  return (
    <ThemeContext.Provider
      value={{
        preset,
        tokens,
        setPreset,
        updateToken,
        resetTheme,
        exportTheme,
        importTheme,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
