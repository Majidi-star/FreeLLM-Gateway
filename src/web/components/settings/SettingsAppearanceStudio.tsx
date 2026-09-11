import React, { useState } from 'react';
import { Sliders, Palette, Download, Upload, RotateCcw, Check, Sparkles, AlertCircle } from 'lucide-react';
import { useTheme, PRESET_THEMES, ThemePreset, ColorTokens } from '../../context/ThemeContext.js';
import { sanitizeForClipboard } from '../../utils/clipboardSanitizer.js';

const TOKEN_LABELS: Record<keyof ColorTokens, { label: string; description: string }> = {
  '--bg-obsidian': { label: 'Viewport Canvas', description: 'Main background canvas for the application window' },
  '--bg-rail': { label: 'Left Rail & Drawer', description: 'Navigation sidebar and slide-over inspector background' },
  '--bg-card': { label: 'Surface Cards', description: 'Standard card and container background' },
  '--bg-card-active': { label: 'Active Card / Hover Fill', description: 'Selected card state and hover background highlights' },
  '--bg-well': { label: 'Embedded Wells', description: 'Input fields, code blocks, and embedded telemetry wells' },
  '--border-subtle': { label: 'Subtle Borders', description: 'Default border outlines for cards and dividers' },
  '--border-hover': { label: 'Hover State Borders', description: 'Active hover state borders' },
  '--accent-primary': { label: 'Primary Accent Color', description: 'Primary brand accent and key action buttons' },
  '--accent-primary-hover': { label: 'Primary Accent Hover', description: 'Hover state for primary action buttons' },
  '--signal-mint': { label: 'Signal Mint (Success)', description: 'Healthy status, online badges, zero-cost indicators' },
  '--signal-amber': { label: 'Signal Amber (Warning)', description: 'Degraded health warnings and SLA alerts' },
  '--signal-coral': { label: 'Signal Coral (Error)', description: 'Failover alerts, circuit breakers, errors' },
  '--text-primary': { label: 'Primary Text', description: 'Headings, main card labels, primary text' },
  '--text-secondary': { label: 'Secondary Text', description: 'Subheadings, secondary labels, description text' },
  '--text-muted': { label: 'Muted Text', description: 'Captions, timestamps, disabled text' },
  '--text-bright': { label: 'Bright Text / Highlights', description: 'High-contrast text for dark containers and badges' },
};

export const DEFAULT_FALLBACK_COLOR = '#121622';

// Helper to safely parse color string (hex or rgba/rgb) to valid 7-char hex (#RRGGBB) for <input type="color">
export const getHexForInput = (colorStr: string): string => {
  if (!colorStr) return DEFAULT_FALLBACK_COLOR;
  const trimmed = colorStr.trim();
  if (trimmed.startsWith('#')) {
    if (trimmed.length === 4) {
      return `#${trimmed[1]}${trimmed[1]}${trimmed[2]}${trimmed[2]}${trimmed[3]}${trimmed[3]}`;
    }
    // HTML <input type="color"> strictly requires 7 characters (#RRGGBB). Truncate 8-digit hex (#RRGGBBAA)
    return trimmed.slice(0, 7);
  }

  const match = trimmed.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i);
  if (match) {
    const r = Math.min(255, Math.max(0, parseInt(match[1], 10))).toString(16).padStart(2, '0');
    const g = Math.min(255, Math.max(0, parseInt(match[2], 10))).toString(16).padStart(2, '0');
    const b = Math.min(255, Math.max(0, parseInt(match[3], 10))).toString(16).padStart(2, '0');
    return `#${r}${g}${b}`;
  }
  return DEFAULT_FALLBACK_COLOR;
};

export const SettingsAppearanceStudio: React.FC = () => {
  const { preset, tokens, setPreset, updateToken, resetTheme, exportTheme, importTheme } = useTheme();
  const [importJsonText, setImportJsonText] = useState('');
  const [importStatus, setImportStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [copiedJson, setCopiedJson] = useState(false);
  const [adminToken, setAdminToken] = useState(() =>
    localStorage.getItem('goalroute_admin_token') || sessionStorage.getItem('goalroute_admin_token') || 'dev-admin-secret-token'
  );
  const [tokenSaved, setTokenSaved] = useState(false);
  const activeTimersRef = React.useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  React.useEffect(() => {
    return () => {
      activeTimersRef.current.forEach((t) => clearTimeout(t));
      activeTimersRef.current.clear();
    };
  }, []);

  const safeTimeout = (fn: () => void, ms: number) => {
    const t = setTimeout(() => {
      activeTimersRef.current.delete(t);
      fn();
    }, ms);
    activeTimersRef.current.add(t);
    return t;
  };

  const handleExport = () => {
    const jsonStr = exportTheme();
    navigator.clipboard.writeText(sanitizeForClipboard(jsonStr));
    setCopiedJson(true);
    safeTimeout(() => setCopiedJson(false), 2000);
  };

  const handleImport = () => {
    const success = importTheme(importJsonText);
    if (success) {
      setImportStatus('success');
      setImportJsonText('');
      safeTimeout(() => setImportStatus('idle'), 2500);
    } else {
      setImportStatus('error');
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[var(--border-subtle)]">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text-primary)] tracking-tight flex items-center gap-2">
            <Palette className="w-6 h-6 text-[var(--accent-primary)]" />
            Settings & Appearance Studio
          </h1>
          <p className="text-xs text-[var(--text-secondary)] mt-1">
            Real-time theme token editor. Modifying tokens updates CSS variables across the entire dashboard instantly.
          </p>
        </div>

        <button
          onClick={resetTheme}
          className="px-4 py-2 rounded-xl bg-[var(--bg-well)] hover:bg-[var(--bg-card-active)] border border-[var(--border-subtle)] text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] flex items-center space-x-2 transition-all"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>Reset Theme Defaults</span>
        </button>
      </div>

      {/* Theme Presets Switcher */}
      <div className="space-y-3">
        <label className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">1. Select Theme Preset</label>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          
          {/* Preset Cards */}
          {(['Dark', 'Light', 'Custom'] as ThemePreset[]).map((p) => {
            const isActive = preset === p;
            return (
              <button
                key={p}
                onClick={() => setPreset(p)}
                className={`p-4 rounded-2xl border text-left transition-all ${
                  isActive
                    ? 'border-[var(--accent-primary)] bg-[var(--bg-card-active)] shadow-lg shadow-[var(--accent-primary)]/10'
                    : 'border-[var(--border-subtle)] bg-[var(--bg-card)] hover:border-[var(--border-hover)]'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-sm text-[var(--text-primary)]">{p}</span>
                  {isActive && <Sparkles className="w-4 h-4 text-[var(--accent-primary)]" />}
                </div>
                <div className="text-[11px] text-[var(--text-muted)] mt-1">
                  {p === 'Dark' && 'Dark theme (#101010 background, #CCCCCC text, #007acc accent)'}
                  {p === 'Light' && 'Light theme (#F9F9F9 background, #101010 text, #007acc accent)'}
                  {p === 'Custom' && 'User custom color variables'}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Live Color Token Table */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">2. Dynamic CSS Custom Variable Token Editor</label>
          <span className="text-xs text-[var(--signal-mint)] font-mono flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-[var(--signal-mint)] animate-pulse" />
            Live Reactive CSS Variables Active
          </span>
        </div>

        <div className="rounded-[24px] bg-[var(--bg-card)] border border-[var(--border-subtle)] overflow-hidden shadow-xl">
          <table className="w-full text-left text-xs">
            <thead className="bg-[var(--bg-well)] border-b border-[var(--border-subtle)] text-[var(--text-muted)] uppercase tracking-wider">
              <tr>
                <th className="py-3 px-4 font-semibold">CSS Token Name</th>
                <th className="py-3 px-4 font-semibold">Purpose & Scope</th>
                <th className="py-3 px-4 font-semibold">Picker</th>
                <th className="py-3 px-4 font-semibold text-right">Hex / Value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-subtle)]">
              {(Object.keys(tokens) as (keyof ColorTokens)[]).map((tokenKey) => {
                const meta = TOKEN_LABELS[tokenKey];
                const value = tokens[tokenKey];
                return (
                  <tr key={tokenKey} className="hover:bg-[var(--bg-card-active)] transition-colors">
                    
                    {/* Token Name */}
                    <td className="py-3 px-4 font-mono font-bold text-[var(--text-primary)]" dir="ltr">
                      {tokenKey}
                    </td>

                    {/* Purpose */}
                    <td className="py-3 px-4">
                      <div className="font-semibold text-[var(--text-primary)]">{meta?.label || tokenKey}</div>
                      <div className="text-[11px] text-[var(--text-muted)] mt-0.5">{meta?.description}</div>
                    </td>

                    {/* Color Picker & Swatch */}
                    <td className="py-3 px-4">
                      <div className="flex items-center space-x-2">
                        <input
                          type="color"
                          value={getHexForInput(value)}
                          onChange={(e) => updateToken(tokenKey, e.target.value)}
                          className="w-8 h-8 rounded-lg cursor-pointer bg-transparent border-0 p-0"
                        />
                        <div
                          className="w-6 h-6 rounded-md border border-white/20 shadow-inner"
                          style={{ backgroundColor: value }}
                        />
                      </div>
                    </td>

                    {/* Hex Text Input */}
                    <td className="py-3 px-4 text-right">
                      <input
                        type="text"
                        value={value}
                        onChange={(e) => updateToken(tokenKey, e.target.value)}
                        className="w-32 py-1 px-2 bg-[var(--bg-well)] border border-[var(--border-subtle)] focus:border-[var(--accent-primary)] rounded-lg text-right font-mono text-xs text-[var(--text-primary)] focus:outline-none"
                        dir="ltr"
                      />
                    </td>

                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Theme Export & Import Section */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-[var(--border-subtle)]">
        
        {/* Export Theme */}
        <div className="p-5 rounded-[24px] bg-[var(--bg-card)] border border-[var(--border-subtle)] space-y-3">
          <div className="flex items-center space-x-2">
            <Download className="w-4 h-4 text-[var(--accent-primary)]" />
            <h3 className="font-bold text-sm text-[var(--text-primary)]">Export Active Theme JSON</h3>
          </div>
          <p className="text-xs text-[var(--text-muted)] leading-relaxed">
            Copy the active CSS color variable configuration to JSON format for sharing or backup.
          </p>
          <button
            onClick={handleExport}
            className="w-full py-2.5 px-4 rounded-xl bg-[var(--bg-well)] hover:bg-[var(--bg-card-active)] border border-[var(--border-subtle)] text-xs font-semibold text-[var(--text-primary)] flex items-center justify-center space-x-2 transition-colors"
          >
            {copiedJson ? <Check className="w-4 h-4 text-[var(--signal-mint)]" /> : <Download className="w-4 h-4" />}
            <span>{copiedJson ? 'Theme JSON Copied to Clipboard!' : 'Copy Theme JSON Config'}</span>
          </button>
        </div>

        {/* Import Theme */}
        <div className="p-5 rounded-[24px] bg-[var(--bg-card)] border border-[var(--border-subtle)] space-y-3">
          <div className="flex items-center space-x-2">
            <Upload className="w-4 h-4 text-[var(--signal-mint)]" />
            <h3 className="font-bold text-sm text-[var(--text-primary)]">Import Custom Theme JSON</h3>
          </div>
          <div className="space-y-2">
            <textarea
              rows={2}
              placeholder='Paste JSON theme configuration here... e.g. {"--bg-obsidian": "#090a0f", ...}'
              value={importJsonText}
              onChange={(e) => setImportJsonText(e.target.value)}
              className="w-full p-2.5 bg-[var(--bg-well)] border border-[var(--border-subtle)] focus:border-[var(--signal-mint)] rounded-xl font-mono text-xs text-[var(--text-primary)] focus:outline-none resize-none"
              dir="ltr"
            />
            <div className="flex items-center justify-between">
              <button
                onClick={handleImport}
                disabled={!importJsonText.trim()}
                className="py-2 px-4 rounded-xl bg-[var(--signal-mint)] hover:bg-[var(--signal-mint)]/80 disabled:opacity-50 text-slate-950 font-bold text-xs flex items-center space-x-1.5 transition-all"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>Apply Imported JSON</span>
              </button>

              {importStatus === 'success' && (
                <span className="text-xs text-[var(--signal-mint)] font-semibold flex items-center gap-1">
                  <Check className="w-3.5 h-3.5" /> Applied!
                </span>
              )}
              {importStatus === 'error' && (
                <span className="text-xs text-[var(--signal-coral)] font-semibold flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5" /> Invalid JSON
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Admin Security Token */}
        <div className="p-5 rounded-[24px] bg-[var(--bg-card)] border border-[var(--border-subtle)] space-y-3 col-span-full">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Sparkles className="w-4 h-4 text-[var(--accent-primary)]" />
              <h3 className="font-bold text-sm text-[var(--text-primary)]">Admin Security Token</h3>
            </div>
            {tokenSaved && (
              <span className="text-xs text-[var(--signal-mint)] font-semibold flex items-center gap-1 font-mono">
                <Check className="w-3.5 h-3.5" /> Token Saved!
              </span>
            )}
          </div>
          <p className="text-xs text-[var(--text-muted)] leading-relaxed">
            Configure the bearer token used for authenticating local gateway management requests.
          </p>
          <div className="flex items-center gap-3">
            <input
              type="text"
              value={adminToken}
              onChange={(e) => {
                const val = e.target.value;
                setAdminToken(val);
                localStorage.setItem('goalroute_admin_token', val);
                sessionStorage.setItem('goalroute_admin_token', val);
                setTokenSaved(true);
                safeTimeout(() => setTokenSaved(false), 2000);
              }}
              placeholder="e.g. dev-admin-secret-token"
              className="flex-1 p-2.5 bg-[var(--bg-well)] border border-[var(--border-subtle)] focus:border-[var(--accent-primary)] rounded-xl font-mono text-xs text-[var(--text-primary)] focus:outline-none"
              dir="ltr"
            />
            <button
              onClick={() => {
                localStorage.setItem('goalroute_admin_token', adminToken);
                sessionStorage.setItem('goalroute_admin_token', adminToken);
                setTokenSaved(true);
                safeTimeout(() => setTokenSaved(false), 2000);
              }}
              className="py-2.5 px-4 rounded-xl bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] text-slate-950 font-bold text-xs shrink-0 transition-all"
            >
              Save Token
            </button>
          </div>
        </div>

      </div>

    </div>
  );
};
