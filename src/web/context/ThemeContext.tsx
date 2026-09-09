import React, { createContext, useContext, useState, useEffect } from 'react';

export type ThemePreset = 'Obsidian Stealth' | 'Midnight OLED' | 'Cyber Mint' | 'Custom';

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
};

export const PRESET_THEMES: Record<Exclude<ThemePreset, 'Custom'>, ColorTokens> = {
  'Obsidian Stealth': {
    '--bg-obsidian': '#090a0f',
    '--bg-rail': '#0d1017',
    '--bg-card': '#121622',
    '--bg-card-active': '#161b28',
    '--bg-well': '#090d14',
    '--border-subtle': 'rgba(255, 255, 255, 0.06)',
    '--border-hover': 'rgba(255, 255, 255, 0.18)',
    '--accent-primary': '#7c9cff',
    '--accent-primary-hover': '#9bb3ff',
    '--signal-mint': '#00f5a0',
    '--signal-amber': '#ffb800',
    '--signal-coral': '#f55036',
    '--text-primary': '#ffffff',
    '--text-secondary': '#94a3b8',
    '--text-muted': '#64748b',
  },
  'Midnight OLED': {
    '--bg-obsidian': '#000000',
    '--bg-rail': '#050508',
    '--bg-card': '#0a0c12',
    '--bg-card-active': '#121520',
    '--bg-well': '#020204',
    '--border-subtle': 'rgba(255, 255, 255, 0.08)',
    '--border-hover': 'rgba(255, 255, 255, 0.25)',
    '--accent-primary': '#6366f1',
    '--accent-primary-hover': '#818cf8',
    '--signal-mint': '#10b981',
    '--signal-amber': '#f59e0b',
    '--signal-coral': '#ef4444',
    '--text-primary': '#ffffff',
    '--text-secondary': '#a1a1aa',
    '--text-muted': '#71717a',
  },
  'Cyber Mint': {
    '--bg-obsidian': '#040d0b',
    '--bg-rail': '#081714',
    '--bg-card': '#0d211d',
    '--bg-card-active': '#142e29',
    '--bg-well': '#030a08',
    '--border-subtle': 'rgba(0, 245, 160, 0.12)',
    '--border-hover': 'rgba(0, 245, 160, 0.3)',
    '--accent-primary': '#00f5a0',
    '--accent-primary-hover': '#38ffb4',
    '--signal-mint': '#00f5a0',
    '--signal-amber': '#ffca28',
    '--signal-coral': '#ff5252',
    '--text-primary': '#f0fdf4',
    '--text-secondary': '#99f6e4',
    '--text-muted': '#5eead4',
  },
};

const COLOR_REGEX = /^(#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})|rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\))$/;

const ALLOWED_TOKENS = [
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
      const saved = localStorage.getItem('goalroute_theme_preset') as ThemePreset;
      if (saved && (saved in PRESET_THEMES || saved === 'Custom')) {
        return saved;
      }
    }
    return 'Obsidian Stealth';
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
    return PRESET_THEMES['Obsidian Stealth'];
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
    setPreset('Obsidian Stealth');
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
