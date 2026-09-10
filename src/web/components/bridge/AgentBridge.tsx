import React, { useState, useEffect } from 'react';
import {
  Zap,
  Code2,
  Bot,
  Terminal,
  FileText,
  Copy,
  Check,
  ShieldCheck,
  AlertTriangle,
  ChevronDown,
  Lock,
  ArrowRight,
  Server,
  MousePointer
} from 'lucide-react';
import { sanitizeForClipboard } from '../../utils/clipboardSanitizer.js';

type Assistant = 'cline' | 'claude' | 'cursor';
type OS = 'windows' | 'macos' | 'linux';
type SecurityMode = 'safe' | 'full';
type Transport = 'stdio' | 'sse';

interface ToolPermission {
  id: string;
  name: string;
  isSafe: boolean;
  description: string;
}

const TOOL_PERMISSIONS: ToolPermission[] = [
  {
    id: 'check_quota',
    name: 'check_quota',
    isSafe: true,
    description: 'Reads provider quota levels',
  },
  {
    id: 'solve_routing_goal',
    name: 'solve_routing_goal',
    isSafe: true,
    description: 'Picks the fastest free route',
  },
  {
    id: 'probe_provider_keys',
    name: 'probe_provider_keys',
    isSafe: true,
    description: 'Tests key latency, read-only',
  },
  {
    id: 'mutate_pools',
    name: 'mutate_pools',
    isSafe: false,
    description: 'Adds or removes routing pools',
  },
];

const PATH_MAP: Record<Assistant, Record<OS, string>> = {
  cline: {
    windows: '%APPDATA%\\Code\\User\\globalStorage\\saoudrizwan.claude-dev\\settings\\cline_mcp_settings.json',
    macos: '~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json',
    linux: '~/.config/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json',
  },
  claude: {
    windows: '%APPDATA%\\Claude\\claude_desktop_config.json',
    macos: '~/Library/Application Support/Claude/claude_desktop_config.json',
    linux: '~/.config/Claude/claude_desktop_config.json',
  },
  cursor: {
    windows: '%USERPROFILE%\\.cursor\\mcp.json',
    macos: '~/.cursor/mcp.json',
    linux: '~/.cursor/mcp.json',
  },
};

export const AgentBridge: React.FC = () => {
  const [selectedAssistant, setSelectedAssistant] = useState<Assistant>('cline');
  const [selectedOs, setSelectedOs] = useState<OS>('windows');
  const [copiedConfig, setCopiedConfig] = useState(false);
  const [copiedPath, setCopiedPath] = useState(false);
  const [securityMode, setSecurityMode] = useState<SecurityMode>('safe');
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [transport, setTransport] = useState<Transport>('stdio');
  const [toolsState, setToolsState] = useState<Record<string, boolean>>({
    check_quota: true,
    solve_routing_goal: true,
    probe_provider_keys: true,
    mutate_pools: false,
  });

  // Auto-detect OS on mount
  useEffect(() => {
    if (typeof navigator !== 'undefined' && navigator.userAgent) {
      const ua = navigator.userAgent.toLowerCase();
      if (ua.includes('mac')) {
        setSelectedOs('macos');
      } else if (ua.includes('linux')) {
        setSelectedOs('linux');
      } else {
        setSelectedOs('windows');
      }
    }
  }, []);

  const configPath = PATH_MAP[selectedAssistant][selectedOs];

  const configText = JSON.stringify(
    {
      mcpServers: {
        goalroute: {
          command: 'node',
          args: [
            selectedOs === 'windows'
              ? 'D:\\FreeLLM-Gateway\\dist\\cli\\index.js'
              : '/usr/local/lib/node_modules/goalroute/dist/cli/index.js',
            'mcp',
          ],
        },
      },
    },
    null,
    2
  );

  const handleCopyConfig = () => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(sanitizeForClipboard(configText));
    }
    setCopiedConfig(true);
    setTimeout(() => setCopiedConfig(false), 1800);
  };

  const handleCopyPath = () => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(sanitizeForClipboard(configPath));
    }
    setCopiedPath(true);
    setTimeout(() => setCopiedPath(false), 1800);
  };

  const toggleTool = (toolId: string) => {
    setToolsState((prev) => ({
      ...prev,
      [toolId]: !prev[toolId],
    }));
  };

  return (
    <div className="max-w-4xl mx-auto space-y-7 animate-in fade-in duration-300">
      {/* 1. Header Ribbon */}
      <section className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-white tracking-tight flex items-center gap-2">
            <Zap className="w-6 h-6 text-[var(--accent-primary)]" />
            Agent Bridge
          </h1>
          <p className="text-sm text-[var(--text-secondary)] mt-1.5 max-w-md">
            Connect your AI coding assistant to GoalRoute in 10 seconds.
          </p>
        </div>
        <div className="flex items-center gap-2 bg-[var(--signal-mint)]/10 text-[var(--signal-mint)] border border-[var(--signal-mint)]/20 text-xs px-3.5 py-1.5 rounded-full font-mono shrink-0 self-start sm:self-auto">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--signal-mint)] opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-[var(--signal-mint)]"></span>
          </span>
          <span>Gateway Ready (Port 8787)</span>
        </div>
      </section>

      {/* 2. Card 1: 1-Click Connect Station */}
      <section className="rounded-2xl bg-[var(--bg-card)] border border-[var(--border-subtle)] p-6 sm:p-7 space-y-6 shadow-sm">
        <div>
          <h2 className="text-lg font-semibold text-white tracking-tight">
            1. Choose Your Assistant
          </h2>
          <p className="text-sm text-[var(--text-secondary)] mt-1">
            Pick the app you code with — the configuration updates automatically.
          </p>
        </div>

        {/* Assistant Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* Cline */}
          <button
            type="button"
            onClick={() => setSelectedAssistant('cline')}
            className={`rounded-2xl border p-4 flex flex-col items-center gap-2.5 text-center transition-all duration-200 cursor-pointer ${
              selectedAssistant === 'cline'
                ? 'bg-[var(--bg-card-active)] border-[var(--accent-primary)] shadow-[0_0_0_1px_rgba(124,156,255,0.4),0_0_24px_-8px_rgba(124,156,255,0.5)]'
                : 'bg-[var(--bg-well)]/40 border-[var(--border-subtle)] hover:bg-white/[0.03]'
            }`}
          >
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${
                selectedAssistant === 'cline'
                  ? 'bg-[var(--accent-primary)]/15 border border-[var(--accent-primary)]/30 text-[var(--accent-primary)]'
                  : 'bg-white/[0.05] border border-white/[0.08] text-[var(--text-secondary)]'
              }`}
            >
              <Code2 className="w-5 h-5" />
            </div>
            <span
              className={`text-sm font-semibold ${
                selectedAssistant === 'cline' ? 'text-white' : 'text-slate-300'
              }`}
            >
              Cline
            </span>
            <span className="text-[11px] text-[var(--text-muted)] -mt-1.5">
              VS Code
            </span>
          </button>

          {/* Claude Desktop */}
          <button
            type="button"
            onClick={() => setSelectedAssistant('claude')}
            className={`rounded-2xl border p-4 flex flex-col items-center gap-2.5 text-center transition-all duration-200 cursor-pointer ${
              selectedAssistant === 'claude'
                ? 'bg-[var(--bg-card-active)] border-[var(--accent-primary)] shadow-[0_0_0_1px_rgba(124,156,255,0.4),0_0_24px_-8px_rgba(124,156,255,0.5)]'
                : 'bg-[var(--bg-well)]/40 border-[var(--border-subtle)] hover:bg-white/[0.03]'
            }`}
          >
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${
                selectedAssistant === 'claude'
                  ? 'bg-[var(--accent-primary)]/15 border border-[var(--accent-primary)]/30 text-[var(--accent-primary)]'
                  : 'bg-white/[0.05] border border-white/[0.08] text-[var(--text-secondary)]'
              }`}
            >
              <Bot className="w-5 h-5" />
            </div>
            <span
              className={`text-sm font-semibold ${
                selectedAssistant === 'claude' ? 'text-white' : 'text-slate-300'
              }`}
            >
              Claude Desktop
            </span>
            <span className="text-[11px] text-[var(--text-muted)] -mt-1.5">
              Anthropic
            </span>
          </button>

          {/* Cursor */}
          <button
            type="button"
            onClick={() => setSelectedAssistant('cursor')}
            className={`rounded-2xl border p-4 flex flex-col items-center gap-2.5 text-center transition-all duration-200 cursor-pointer ${
              selectedAssistant === 'cursor'
                ? 'bg-[var(--bg-card-active)] border-[var(--accent-primary)] shadow-[0_0_0_1px_rgba(124,156,255,0.4),0_0_24px_-8px_rgba(124,156,255,0.5)]'
                : 'bg-[var(--bg-well)]/40 border-[var(--border-subtle)] hover:bg-white/[0.03]'
            }`}
          >
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${
                selectedAssistant === 'cursor'
                  ? 'bg-[var(--accent-primary)]/15 border border-[var(--accent-primary)]/30 text-[var(--accent-primary)]'
                  : 'bg-white/[0.05] border border-white/[0.08] text-[var(--text-secondary)]'
              }`}
            >
              <MousePointer className="w-5 h-5" />
            </div>
            <span
              className={`text-sm font-semibold ${
                selectedAssistant === 'cursor' ? 'text-white' : 'text-slate-300'
              }`}
            >
              Cursor
            </span>
            <span className="text-[11px] text-[var(--text-muted)] -mt-1.5">
              IDE
            </span>
          </button>
        </div>

        {/* Config Path Guidance & OS Selector */}
        <div className="space-y-2.5 pt-1">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[var(--bg-well)] border border-[var(--border-subtle)] rounded-xl p-3.5 text-xs text-[var(--text-secondary)]">
            <div className="flex items-center gap-2 min-w-0">
              <FileText className="w-4 h-4 shrink-0 text-[var(--text-muted)]" />
              <span className="shrink-0 font-medium">Target File:</span>
              <span className="font-mono text-[var(--text-secondary)] truncate">
                {configPath}
              </span>
            </div>

            <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
              {/* OS Toggle Pills */}
              <div className="flex items-center bg-[var(--bg-obsidian)] border border-[var(--border-subtle)] rounded-full p-0.5">
                <button
                  type="button"
                  onClick={() => setSelectedOs('windows')}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-mono transition-colors cursor-pointer ${
                    selectedOs === 'windows'
                      ? 'bg-[var(--accent-primary)] text-slate-950 font-semibold'
                      : 'text-[var(--text-secondary)] hover:text-white'
                  }`}
                >
                  Windows
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedOs('macos')}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-mono transition-colors cursor-pointer ${
                    selectedOs === 'macos'
                      ? 'bg-[var(--accent-primary)] text-slate-950 font-semibold'
                      : 'text-[var(--text-secondary)] hover:text-white'
                  }`}
                >
                  macOS
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedOs('linux')}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-mono transition-colors cursor-pointer ${
                    selectedOs === 'linux'
                      ? 'bg-[var(--accent-primary)] text-slate-950 font-semibold'
                      : 'text-[var(--text-secondary)] hover:text-white'
                  }`}
                >
                  Linux
                </button>
              </div>

              {/* Copy Path Button */}
              <button
                type="button"
                onClick={handleCopyPath}
                className="px-2.5 py-1 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] text-xs text-slate-200 flex items-center gap-1.5 transition border border-white/[0.04] active:scale-95 cursor-pointer"
              >
                {copiedPath ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-[var(--signal-mint)]" />
                    <span className="text-[var(--signal-mint)] font-medium">Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                    <span>Copy Path</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* JSON Configuration Well */}
        <div className="bg-[var(--bg-well)] border border-[var(--border-subtle)] rounded-xl overflow-hidden shadow-inner">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--border-subtle)] bg-slate-950/40">
            <span className="text-[11px] font-mono text-[var(--text-muted)] uppercase tracking-wider font-semibold">
              Configuration Code
            </span>
            <button
              type="button"
              onClick={handleCopyConfig}
              className="rounded-lg bg-white/[0.06] hover:bg-white/[0.1] px-3 py-1.5 text-xs text-slate-200 flex items-center gap-1.5 transition shrink-0 border border-white/[0.04] active:scale-95 cursor-pointer"
            >
              {copiedConfig ? (
                <>
                  <Check className="w-3.5 h-3.5 text-[var(--signal-mint)]" />
                  <span className="text-[var(--signal-mint)] font-medium">Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                  <span>Copy Configuration</span>
                </>
              )}
            </button>
          </div>
          <pre className="p-4 text-[13px] leading-relaxed font-mono overflow-x-auto text-slate-300">
            <code>
              <span className="text-slate-500 font-mono">&#123;</span>
              {'\n'}  <span className="text-[var(--accent-primary)] font-mono">"mcpServers"</span>
              <span className="text-slate-500 font-mono">: &#123;</span>
              {'\n'}    <span className="text-[var(--accent-primary)] font-mono">"goalroute"</span>
              <span className="text-slate-500 font-mono">: &#123;</span>
              {'\n'}      <span className="text-[var(--accent-primary)] font-mono">"command"</span>
              <span className="text-slate-500 font-mono">: </span>
              <span className="text-[var(--signal-mint)] font-mono">"node"</span>
              <span className="text-slate-500 font-mono">,</span>
              {'\n'}      <span className="text-[var(--accent-primary)] font-mono">"args"</span>
              <span className="text-slate-500 font-mono">: [</span>
              <span className="text-[var(--signal-mint)] font-mono">
                "{selectedOs === 'windows' ? 'D:\\\\FreeLLM-Gateway\\\\dist\\\\cli\\\\index.js' : '/usr/local/lib/node_modules/goalroute/dist/cli/index.js'}"
              </span>
              <span className="text-slate-500 font-mono">, </span>
              <span className="text-[var(--signal-mint)] font-mono">"mcp"</span>
              <span className="text-slate-500 font-mono">]</span>
              {'\n'}    <span className="text-slate-500 font-mono">&#125;</span>
              {'\n'}  <span className="text-slate-500 font-mono">&#125;</span>
              {'\n'}<span className="text-slate-500 font-mono">&#125;</span>
            </code>
          </pre>
        </div>

        {/* 3-Step Micro-guide */}
        <div className="flex items-center justify-center gap-2 sm:gap-3 pt-1 flex-wrap">
          <div className="flex items-center gap-1.5 text-xs font-medium text-slate-300 bg-white/[0.04] border border-[var(--border-subtle)] px-3 py-1.5 rounded-full">
            <span className="w-4 h-4 rounded-full bg-[var(--accent-primary)]/20 text-[var(--accent-primary)] flex items-center justify-center text-[10px] font-mono font-bold">
              1
            </span>{' '}
            Copy Code
          </div>
          <span className="text-slate-600 text-xs font-mono">──→</span>
          <div className="flex items-center gap-1.5 text-xs font-medium text-slate-300 bg-white/[0.04] border border-[var(--border-subtle)] px-3 py-1.5 rounded-full">
            <span className="w-4 h-4 rounded-full bg-[var(--accent-primary)]/20 text-[var(--accent-primary)] flex items-center justify-center text-[10px] font-mono font-bold">
              2
            </span>{' '}
            Open App Settings
          </div>
          <span className="text-slate-600 text-xs font-mono">──→</span>
          <div className="flex items-center gap-1.5 text-xs font-medium text-slate-300 bg-white/[0.04] border border-[var(--border-subtle)] px-3 py-1.5 rounded-full">
            <span className="w-4 h-4 rounded-full bg-[var(--accent-primary)]/20 text-[var(--accent-primary)] flex items-center justify-center text-[10px] font-mono font-bold">
              3
            </span>{' '}
            Paste &amp; Save
          </div>
        </div>
      </section>

      {/* 3. Card 2: Security & Tool Access */}
      <section className="rounded-2xl bg-[var(--bg-card)] border border-[var(--border-subtle)] p-6 sm:p-7 space-y-5 shadow-sm">
        <div>
          <h2 className="text-lg font-semibold text-white tracking-tight">
            2. Security &amp; Tool Access
          </h2>
          <p className="text-sm text-[var(--text-secondary)] mt-1">
            Decide how much your assistant is allowed to change.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-5">
          {/* Safe Mode */}
          <button
            type="button"
            onClick={() => setSecurityMode('safe')}
            className={`text-left rounded-2xl border p-5 space-y-3 transition-all duration-200 cursor-pointer ${
              securityMode === 'safe'
                ? 'border-[var(--accent-primary)]/50 bg-[var(--bg-card-active)] shadow-sm'
                : 'border-[var(--border-subtle)] bg-[var(--bg-well)]/40 hover:border-white/10'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span
                  className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 transition-colors ${
                    securityMode === 'safe'
                      ? 'border-[var(--accent-primary)]'
                      : 'border-white/30'
                  }`}
                >
                  {securityMode === 'safe' && (
                    <span className="w-2 h-2 rounded-full bg-[var(--accent-primary)]" />
                  )}
                </span>
                <span className="text-sm font-semibold text-white">Safe Mode</span>
                <span className="text-[10px] text-[var(--text-muted)] font-medium">
                  (Recommended)
                </span>
              </div>
            </div>
            <span className="inline-flex items-center gap-1.5 text-[11px] font-mono px-2.5 py-1 rounded-full bg-[var(--signal-mint)]/10 text-[var(--signal-mint)] border border-[var(--signal-mint)]/20 font-medium">
              <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
              Shield Active • Zero Risk
            </span>
            <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
              Lets your assistant check free quotas, pick the fastest model, and test latency. Your API keys cannot be touched or deleted.
            </p>
          </button>

          {/* Full Superuser */}
          <button
            type="button"
            onClick={() => setSecurityMode('full')}
            className={`text-left rounded-2xl border p-5 space-y-3 transition-all duration-200 cursor-pointer ${
              securityMode === 'full'
                ? 'border-[var(--signal-amber)]/50 bg-[var(--bg-card-active)] shadow-sm'
                : 'border-[var(--border-subtle)] bg-[var(--bg-well)]/40 hover:border-white/10'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span
                  className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 transition-colors ${
                    securityMode === 'full'
                      ? 'border-[var(--signal-amber)]'
                      : 'border-white/30'
                  }`}
                >
                  {securityMode === 'full' && (
                    <span className="w-2 h-2 rounded-full bg-[var(--signal-amber)]" />
                  )}
                </span>
                <span className="text-sm font-semibold text-slate-200">
                  Full Superuser
                </span>
              </div>
            </div>
            <span className="inline-flex items-center gap-1.5 text-[11px] font-mono px-2.5 py-1 rounded-full bg-[var(--signal-amber)]/10 text-[var(--signal-amber)] border border-[var(--signal-amber)]/20 font-medium">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              Admin Privileges
            </span>
            <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
              Allows the assistant to add/remove routing pools and manage vault keys directly.
            </p>
          </button>
        </div>

        {/* Live Footnote */}
        <div className="flex items-center gap-2 text-xs text-[var(--text-muted)] pt-1 font-sans">
          <Lock className="w-3.5 h-3.5 text-[var(--accent-primary)] shrink-0" />
          <span>
            Guardrails are enforced live by the GoalRoute daemon in real time. You don't need to recopy your configuration when switching modes.
          </span>
        </div>
      </section>

      {/* 4. Collapsible Advanced Settings Drawer */}
      <section className="rounded-2xl bg-[var(--bg-card)] border border-[var(--border-subtle)] shadow-sm overflow-hidden pb-2">
        <button
          type="button"
          onClick={() => setIsDrawerOpen(!isDrawerOpen)}
          className="w-full flex items-center justify-between px-6 sm:px-7 py-5 text-sm font-medium text-slate-300 hover:text-white transition-colors cursor-pointer"
        >
          <span>
            Show Advanced Settings{' '}
            <span className="text-[var(--text-muted)] font-normal">
              (Remote SSE / Granular Tool Switches)
            </span>
          </span>
          <ChevronDown
            className={`w-4 h-4 text-[var(--text-muted)] transition-transform duration-200 ${
              isDrawerOpen ? 'rotate-180' : ''
            }`}
          />
        </button>

        {isDrawerOpen && (
          <div className="px-6 sm:px-7 pb-7 space-y-6 border-t border-[var(--border-subtle)] pt-6 animate-in slide-in-from-top-2 duration-200">
            {/* Transport Toggle */}
            <div>
              <h4 className="text-xs font-semibold text-slate-300 mb-2.5">
                Local App Connection
              </h4>
              <div className="inline-flex bg-[var(--bg-well)] border border-[var(--border-subtle)] rounded-full p-1 w-full max-w-md">
                <button
                  type="button"
                  onClick={() => setTransport('stdio')}
                  className={`flex-1 py-2 px-3 rounded-full text-xs font-medium transition-all cursor-pointer ${
                    transport === 'stdio'
                      ? 'bg-[var(--accent-primary)] text-slate-950 font-semibold shadow-sm'
                      : 'text-[var(--text-secondary)] hover:text-white'
                  }`}
                >
                  STDIO (Local)
                </button>
                <button
                  type="button"
                  onClick={() => setTransport('sse')}
                  className={`flex-1 py-2 px-3 rounded-full text-xs font-medium transition-all cursor-pointer ${
                    transport === 'sse'
                      ? 'bg-[var(--accent-primary)] text-slate-950 font-semibold shadow-sm'
                      : 'text-[var(--text-secondary)] hover:text-white'
                  }`}
                >
                  Remote (HTTP/SSE)
                </button>
              </div>
              <p className="text-[11px] font-mono text-[var(--text-muted)] mt-2.5">
                {transport === 'stdio'
                  ? 'Connected directly through your IDE — no network address needed.'
                  : 'Streams over http://127.0.0.1:8787/mcp/sse — use this if your assistant runs remotely.'}
              </p>
            </div>

            {/* Granular Tool Switches */}
            <div>
              <h4 className="text-xs font-semibold text-slate-300 mb-3">
                Tool Permissions
              </h4>
              <div className="space-y-2.5">
                {TOOL_PERMISSIONS.map((tool) => {
                  const isOn = toolsState[tool.id] ?? false;
                  return (
                    <div
                      key={tool.id}
                      className={`flex items-center justify-between bg-[var(--bg-well)]/50 border rounded-xl px-4 py-3 transition-colors ${
                        tool.isSafe
                          ? 'border-[var(--border-subtle)]'
                          : 'border-[var(--signal-coral)]/20'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        {/* iOS-style toggle */}
                        <button
                          type="button"
                          onClick={() => toggleTool(tool.id)}
                          className={`w-9 h-5 rounded-full relative transition-colors duration-200 ease-in-out cursor-pointer shrink-0 ${
                            isOn ? 'bg-[var(--accent-primary)]' : 'bg-white/10'
                          }`}
                        >
                          <span
                            className={`w-4 h-4 rounded-full bg-white absolute top-0.5 left-0.5 transition-transform duration-200 ease-in-out shadow ${
                              isOn ? 'translate-x-4' : 'translate-x-0'
                            }`}
                          />
                        </button>

                        <span className="text-sm font-mono text-slate-200">
                          {tool.name}
                        </span>

                        {tool.isSafe ? (
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[var(--signal-mint)]/10 text-[var(--signal-mint)] border border-[var(--signal-mint)]/20 font-medium">
                            Safe
                          </span>
                        ) : (
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[var(--signal-coral)]/10 text-[var(--signal-coral)] border border-[var(--signal-coral)]/25 font-medium">
                            Destructive
                          </span>
                        )}
                      </div>

                      <span className="text-[11px] text-[var(--text-muted)]">
                        {tool.description}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
};
