import React, { useEffect, useState } from 'react';
import { LayoutDashboard, Key, Palette, Sparkles, Activity, ShieldCheck, Cpu, Terminal, ArrowUpRight, CheckCircle2, ChevronRight, Zap, RefreshCw, MessageSquare, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';
import { CockpitDashboard } from '../cockpit/CockpitDashboard.js';
import { AgentBridge } from '../bridge/AgentBridge.js';
import { CredentialVault } from '../vault/CredentialVault.js';
import { SettingsAppearanceStudio } from '../settings/SettingsAppearanceStudio.js';
import { GoalStudioModal } from '../modals/GoalStudioModal.js';
import { DecisionInspectorDrawer, DecisionTrace } from '../drawers/DecisionInspectorDrawer.js';
import { GlossaryTerm } from '../common/GlossaryTerm.js';
import { AgenticChat } from '../chat/AgenticChat.js';

export const AppShell: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'cockpit' | 'bridge' | 'vault' | 'settings'>('cockpit');
  const [isGoalStudioOpen, setIsGoalStudioOpen] = useState(false);
  const [selectedTrace, setSelectedTrace] = useState<DecisionTrace | null>(null);
  const [conciergeMsg, setConciergeMsg] = useState('GoalRoute Copilot active. Monitoring your configured enclave keys with 0ms overhead.');
  const [activeKeys, setActiveKeys] = useState<number | null>(null);
  const [zoomLevel, setZoomLevel] = useState<number>(100);

  // Ctrl + Mouse Wheel Zoom Listener
  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault();
        setZoomLevel((prev) => {
          const delta = e.deltaY < 0 ? 10 : -10;
          return Math.min(200, Math.max(50, prev + delta));
        });
      }
    };

    window.addEventListener('wheel', handleWheel, { passive: false });
    return () => window.removeEventListener('wheel', handleWheel);
  }, []);

  useEffect(() => {
    const adminToken =
      sessionStorage.getItem('goalroute_admin_token') ||
      localStorage.getItem('goalroute_admin_token') ||
      (import.meta as any).env?.VITE_ADMIN_API_TOKEN ||
      'dev-admin-secret-token';
    fetch('/api/v1/providers', {
      headers: adminToken ? { authorization: `Bearer ${adminToken}` } : {},
    })
      .then((res) => (res.ok ? res.json() : []))
      .then((providers) => {
        if (Array.isArray(providers)) {
          setActiveKeys(providers.filter((p: any) => p && p.hasKey && p.status !== 'unconfigured').length);
        }
      })
      .catch(() => {});
  }, []);

  return (
    <div className="h-screen max-h-screen w-screen overflow-hidden bg-[var(--bg-obsidian)] text-[var(--text-primary)] font-sans flex flex-col md:flex-row">
      
      {/* 1. FIXED 260px LEFT NAVIGATION RAIL */}
      <aside className="w-full md:w-64 h-full bg-[var(--bg-rail)] border-r border-[var(--border-subtle)] flex flex-col justify-between p-4 shrink-0 z-20 overflow-y-auto custom-scrollbar">
        <div className="space-y-5">
          
          {/* Logo & Workspace */}
          <div className="space-y-3">
            <div className="flex items-center space-x-3 px-2">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-[var(--accent-primary)] to-[var(--signal-mint)] p-0.5 flex items-center justify-center shadow-lg shadow-[var(--accent-primary)]/20">
                <div className="w-full h-full bg-slate-950 rounded-[10px] flex items-center justify-center text-[var(--signal-mint)]">
                  <Zap className="w-5 h-5" />
                </div>
              </div>
              <div>
                <h1 className="font-extrabold text-base tracking-tight text-[var(--text-primary)] flex items-center gap-1.5">
                  GoalRoute
                  <span className="w-2 h-2 rounded-full bg-[var(--signal-mint)] animate-pulse" />
                </h1>
                <p className="text-[10px] text-[var(--text-muted)] font-mono">v0.1.0 Gateway</p>
              </div>
            </div>

            {/* Active Workspace Switcher */}
            <div className="bg-[var(--bg-well)] p-2.5 rounded-xl border border-[var(--border-subtle)] text-xs space-y-1">
              <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider font-semibold">Active Workspace</div>
              <div className="font-bold text-[var(--text-primary)] truncate font-mono" dir="ltr">FreeLLM-Gateway</div>
            </div>
          </div>

          {/* Navigation Links */}
          <nav className="space-y-1.5">
            <button
              onClick={() => setActiveTab('cockpit')}
              className={`w-full flex items-center space-x-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                activeTab === 'cockpit'
                  ? 'bg-[var(--bg-card-active)] text-[var(--text-primary)] border border-[var(--border-hover)] shadow-md'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)]'
              }`}
            >
              <LayoutDashboard className="w-4 h-4 shrink-0" />
              <span>Cockpit Dashboard</span>
            </button>

            <button
              onClick={() => setActiveTab('vault')}
              className={`w-full flex items-center space-x-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                activeTab === 'vault'
                  ? 'bg-[var(--bg-card-active)] text-[var(--text-primary)] border border-[var(--border-hover)] shadow-md'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)]'
              }`}
            >
              <Key className="w-4 h-4 shrink-0" />
              <span>Credential Vault</span>
            </button>

            <button
              onClick={() => setActiveTab('bridge')}
              className={`w-full flex items-center space-x-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                activeTab === 'bridge'
                  ? 'bg-[var(--bg-card-active)] text-[var(--text-primary)] border border-[var(--border-hover)] shadow-md'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)]'
              }`}
            >
              <Zap className="w-4 h-4 shrink-0" />
              <span>Agent Bridge</span>
            </button>

            <button
              onClick={() => setIsGoalStudioOpen(true)}
              className="w-full flex items-center space-x-3 px-3 py-2.5 rounded-xl text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)] transition-all cursor-pointer"
            >
              <Sparkles className="w-4 h-4 shrink-0" />
              <span>Goal Studio</span>
            </button>

            <button
              onClick={() => setActiveTab('settings')}
              className={`w-full flex items-center space-x-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                activeTab === 'settings'
                  ? 'bg-[var(--bg-card-active)] text-[var(--text-primary)] border border-[var(--border-hover)] shadow-md'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)]'
              }`}
            >
              <Palette className="w-4 h-4 shrink-0" />
              <span>Settings Studio</span>
            </button>
          </nav>

          {/* System & Telemetry Monitor Section */}
          <div className="pt-3 border-t border-[var(--border-subtle)] space-y-3">
            <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)] px-1 font-semibold flex items-center justify-between">
              <span>Telemetry Monitor</span>
              <span className="w-2 h-2 rounded-full bg-[var(--signal-mint)] animate-pulse" />
            </div>

            {/* Route Advisor Card */}
            <div className="p-3 rounded-xl bg-[var(--bg-well)] border border-[var(--border-subtle)] space-y-1.5 shadow-inner">
              <div className="flex items-center justify-between text-[11px] text-[var(--accent-primary)] font-semibold">
                <span className="flex items-center gap-1">
                  <Activity className="w-3 h-3 text-[var(--signal-mint)]" />
                  Advisor
                </span>
                <span className="text-[9px] font-mono bg-[var(--signal-mint)]/10 text-[var(--signal-mint)] px-1.5 py-0.5 rounded">LIVE</span>
              </div>
              <p className="text-[11px] text-[var(--text-secondary)] leading-snug">
                "{conciergeMsg}"
              </p>
            </div>

            {/* Stream Feed Snapshot */}
            <div className="space-y-1.5">
              <div className="p-2.5 rounded-xl bg-[var(--bg-well)] border border-[var(--border-subtle)] text-[11px] space-y-1">
                <div className="flex justify-between text-[9px] text-[var(--text-muted)] font-mono" dir="ltr">
                  <span>TR-94A20F18</span>
                  <span className="text-[var(--signal-mint)]">42ms</span>
                </div>
                <div className="font-semibold text-[var(--text-primary)] truncate" dir="ltr">DeepSeek-R1</div>
                <div className="text-[10px] text-[var(--text-muted)]">Greedy Set-Cover code route.</div>
              </div>

              <div className="p-2.5 rounded-xl bg-[var(--bg-well)] border border-[var(--border-subtle)] text-[11px] space-y-1">
                <div className="flex justify-between text-[9px] text-[var(--text-muted)] font-mono" dir="ltr">
                  <span>TR-88C11B02</span>
                  <span className="text-[var(--signal-mint)]">85ms</span>
                </div>
                <div className="font-semibold text-[var(--text-primary)] truncate" dir="ltr">Gemini 2.5 Flash</div>
                <div className="text-[10px] text-[var(--text-muted)]">Zero-cost throughput route.</div>
              </div>
            </div>
          </div>

        </div>

        {/* Left Rail Footer: System Health & Profile */}
        <div className="space-y-3 pt-3 border-t border-[var(--border-subtle)] mt-4">
          <div className="bg-[var(--bg-well)] p-2.5 rounded-xl border border-[var(--border-subtle)] space-y-1">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-[var(--text-muted)] font-medium">Engine SLA</span>
              <span className="text-[var(--signal-mint)] font-mono font-bold">100%</span>
            </div>
            <div className="text-[10px] text-[var(--text-secondary)]">
              {activeKeys !== null
                ? `${activeKeys} / ${activeKeys} Free Enclave Keys`
                : 'Loading enclave keys…'}
            </div>
          </div>

          <div className="flex items-center space-x-2.5 px-2">
            <div className="w-7 h-7 rounded-full bg-[var(--bg-card-active)] border border-[var(--border-hover)] flex items-center justify-center font-bold text-xs text-[var(--accent-primary)]">
              DEV
            </div>
            <div className="truncate">
              <div className="text-xs font-bold text-[var(--text-primary)] truncate">Developer Station</div>
              <div className="text-[10px] text-[var(--text-muted)] truncate">Local Workstation</div>
            </div>
          </div>
        </div>
      </aside>

      {/* 2. MIDDLE VIEWPORT CONTAINER WITH TOP UTILITY BAR */}
      <div className="flex-1 h-full flex flex-col min-w-0 bg-[var(--bg-obsidian)] overflow-hidden">
        {/* TOP UTILITY BAR (Higher than editorial/content tabs) */}
        <header className="h-11 border-b border-[var(--border-subtle)] bg-[var(--bg-rail)]/80 backdrop-blur-xs px-4 sm:px-6 flex items-center justify-between shrink-0 z-30 font-mono text-xs">
          <div className="flex items-center space-x-3">
            <div className="flex items-center space-x-2 text-[var(--text-secondary)]">
              <span className="font-bold text-[var(--text-bright)] uppercase tracking-wider text-[11px]">
                {activeTab === 'cockpit' ? 'Cockpit Dashboard' : activeTab === 'bridge' ? 'Agent Bridge' : activeTab === 'vault' ? 'Credential Vault' : 'Settings Studio'}
              </span>
              <span className="text-[var(--text-muted)]">/</span>
              <span className="text-[10px] text-[var(--signal-mint)] bg-[var(--signal-mint)]/10 px-2 py-0.5 rounded-full border border-[var(--signal-mint)]/20 font-semibold">
                Workstation Mode
              </span>
            </div>
          </div>

          {/* Interactive Zoom Controls */}
          <div className="flex items-center space-x-3">
            <div className="flex items-center space-x-1 bg-[var(--bg-well)] border border-[var(--border-subtle)] rounded-xl p-1 shadow-inner">
              <button
                type="button"
                onClick={() => setZoomLevel((z) => Math.max(50, z - 10))}
                className="p-1 rounded-lg hover:bg-[var(--bg-card-active)] text-[var(--text-secondary)] hover:text-[var(--text-bright)] transition-colors cursor-pointer"
                title="Zoom Out (Ctrl + Scroll Down)"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>

              <span className="px-2 py-0.5 font-bold text-[11px] text-[var(--accent-primary)] min-w-[42px] text-center select-none font-mono">
                {zoomLevel}%
              </span>

              <button
                type="button"
                onClick={() => setZoomLevel((z) => Math.min(200, z + 10))}
                className="p-1 rounded-lg hover:bg-[var(--bg-card-active)] text-[var(--text-secondary)] hover:text-[var(--text-bright)] transition-colors cursor-pointer"
                title="Zoom In (Ctrl + Scroll Up)"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>

              <button
                type="button"
                onClick={() => setZoomLevel(100)}
                disabled={zoomLevel === 100}
                className="p-1 rounded-lg hover:bg-[var(--bg-card-active)] text-[var(--text-muted)] hover:text-[var(--text-bright)] disabled:opacity-30 transition-colors border-l border-[var(--border-subtle)] pl-1.5 cursor-pointer"
                title="Reset Zoom (100%)"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
            </div>

            <span className="hidden sm:inline-block text-[10px] text-[var(--text-muted)] font-mono">
              <kbd className="px-1.5 py-0.5 bg-[var(--bg-well)] border border-[var(--border-subtle)] rounded font-mono">Ctrl</kbd> + <kbd className="px-1.5 py-0.5 bg-[var(--bg-well)] border border-[var(--border-subtle)] rounded font-mono">Wheel</kbd>
            </span>
          </div>
        </header>

        {/* CANVAS WORKSPACE VIEWPORT */}
        <main
          className="flex-1 h-full overflow-y-auto p-6 md:p-8 custom-scrollbar bg-[var(--bg-obsidian)]"
          style={{ zoom: `${zoomLevel}%` }}
        >
          {activeTab === 'cockpit' && (
            <CockpitDashboard
              onOpenGoalStudio={() => setIsGoalStudioOpen(true)}
              onSelectTrace={(trace) => setSelectedTrace(trace)}
            />
          )}
          {activeTab === 'bridge' && <AgentBridge />}
          {activeTab === 'vault' && <CredentialVault />}
          {activeTab === 'settings' && (
            <div className="max-w-4xl mx-auto">
              <SettingsAppearanceStudio />
            </div>
          )}
        </main>
      </div>

      {/* 3. AGENTIC CHAT INTERFACE (RIGHT RAIL) */}
      <aside className="w-full md:w-[380px] lg:w-[420px] h-full bg-[var(--bg-rail)] border-l border-[var(--border-subtle)] flex flex-col shrink-0 overflow-hidden z-10">
        <AgenticChat />
      </aside>

      {/* Goal Studio Modal Container */}
      <GoalStudioModal
        isOpen={isGoalStudioOpen}
        onClose={() => setIsGoalStudioOpen(false)}
        onApplyGoal={(goal) => {
          setConciergeMsg(`Goal updated to ${goal.intent.toUpperCase()} preset with max latency ${goal.maxLatency}ms.`);
        }}
      />

      {/* Decision Inspector Drawer Container */}
      <DecisionInspectorDrawer
        isOpen={!!selectedTrace}
        trace={selectedTrace}
        onClose={() => setSelectedTrace(null)}
      />

    </div>
  );
};

