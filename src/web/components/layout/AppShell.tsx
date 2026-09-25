import React, { useEffect, useState } from 'react';
import { LayoutDashboard, Key, Palette, Sparkles, Activity, ShieldCheck, Cpu, Terminal, ArrowUpRight, CheckCircle2, ChevronRight, Zap, RefreshCw, MessageSquare, Database, Layers } from 'lucide-react';
import { CockpitDashboard } from '../cockpit/CockpitDashboard.js';
import { AgentBridge } from '../bridge/AgentBridge.js';
import { CredentialVault } from '../vault/CredentialVault.js';
import { DatabaseStudio } from '../database/DatabaseStudio.js';
import { SettingsAppearanceStudio } from '../settings/SettingsAppearanceStudio.js';
import { GoalStudioModal } from '../modals/GoalStudioModal.js';
import { PoolStudioModal } from '../modals/PoolStudioModal.js';
import { DecisionInspectorDrawer, DecisionTrace } from '../drawers/DecisionInspectorDrawer.js';
import { GlossaryTerm } from '../common/GlossaryTerm.js';
import { AgenticChat } from '../chat/AgenticChat.js';
import { getAdminToken } from '../settings/EndpointsManager.js';

export const AppShell: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'cockpit' | 'bridge' | 'vault' | 'database' | 'settings'>('cockpit');
  const [isGoalStudioOpen, setIsGoalStudioOpen] = useState(false);
  const [isPoolStudioOpen, setIsPoolStudioOpen] = useState(false);
  const [selectedTrace, setSelectedTrace] = useState<DecisionTrace | null>(null);
  const [conciergeMsg, setConciergeMsg] = useState('GoalRoute Copilot active. Monitoring your configured enclave keys with 0ms overhead.');
  const [activeKeys, setActiveKeys] = useState<number | null>(null);

  // Left Panel Resize State
  const [leftPanelWidth, setLeftPanelWidth] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('goalroute_left_panel_width');
      if (saved) {
        const parsed = Number(saved);
        if (parsed >= 200 && parsed <= 500) return parsed;
      }
    } catch {}
    return 260;
  });
  const [isResizingLeft, setIsResizingLeft] = useState(false);

  // Right Panel Resize State
  const [rightPanelWidth, setRightPanelWidth] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('goalroute_right_panel_width');
      if (saved) {
        const parsed = Number(saved);
        if (parsed >= 300 && parsed <= 800) return parsed;
      }
    } catch {}
    return 400;
  });
  const [isResizingRight, setIsResizingRight] = useState(false);

  // Left Panel Mouse Move Listener
  useEffect(() => {
    if (!isResizingLeft) return;

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = e.clientX;
      const minWidth = 200;
      const maxWidth = Math.min(500, window.innerWidth * 0.4);
      const clampedWidth = Math.min(Math.max(newWidth, minWidth), maxWidth);

      setLeftPanelWidth(clampedWidth);
      try {
        localStorage.setItem('goalroute_left_panel_width', String(clampedWidth));
      } catch {}
    };

    const handleMouseUp = () => {
      setIsResizingLeft(false);
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizingLeft]);

  // Right Panel Mouse Move Listener
  useEffect(() => {
    if (!isResizingRight) return;

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = window.innerWidth - e.clientX;
      const minWidth = 320;
      const maxWidth = Math.min(800, window.innerWidth * 0.65);
      const clampedWidth = Math.min(Math.max(newWidth, minWidth), maxWidth);

      setRightPanelWidth(clampedWidth);
      try {
        localStorage.setItem('goalroute_right_panel_width', String(clampedWidth));
      } catch {}
    };

    const handleMouseUp = () => {
      setIsResizingRight(false);
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizingRight]);

  useEffect(() => {
    const adminToken = getAdminToken();
    fetch('/api/v1/providers', {
      headers: adminToken ? { authorization: `Bearer ${adminToken}` } : {},
    })
      .then((res) => (res.ok ? res.json() : []))
      .then((providers) => {
        if (Array.isArray(providers)) {
          const active = providers.filter((p: any) => p && p.hasKey && p.status !== 'unconfigured').length;
          setActiveKeys(active);
          if (active === 0) {
            setConciergeMsg('No active enclave keys configured. Connect provider API keys in Credential Vault to start routing.');
          } else {
            setConciergeMsg(`GoalRoute Copilot active. Monitoring ${active} active provider key${active > 1 ? 's' : ''} with zero-latency failover.`);
          }
        }
      })
      .catch(() => {});
  }, []);

  return (
    <div className="h-screen max-h-screen w-screen overflow-hidden bg-[var(--bg-obsidian)] text-[var(--text-primary)] font-sans flex flex-col md:flex-row">
      
      {/* 1. RESIZABLE LEFT NAVIGATION RAIL */}
      <aside
        className="relative w-full h-full bg-[var(--bg-rail)] border-r border-[var(--border-subtle)] flex flex-col justify-between p-4 shrink-0 z-20 overflow-y-auto custom-scrollbar"
        style={{ width: `${leftPanelWidth}px` }}
      >
        {/* Right Edge Drag Handle */}
        <div
          onMouseDown={() => setIsResizingLeft(true)}
          className="absolute top-0 right-0 bottom-0 w-2.5 cursor-col-resize hover:bg-[var(--accent-primary)]/40 active:bg-[var(--accent-primary)] z-30 transition-colors group flex items-center justify-center -mr-1"
          title="Drag to adjust navigation panel width"
        >
          <div className="w-1 h-8 rounded-full bg-[var(--border-hover)] group-hover:bg-[var(--accent-primary)] transition-colors" />
        </div>

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
              <div className="text-xs text-[var(--text-muted)] uppercase tracking-wider font-bold">Active Workspace</div>
              <div className="font-bold text-sm text-[var(--text-primary)] truncate font-mono" dir="ltr">FreeLLM-Gateway</div>
            </div>
          </div>

          {/* Navigation Links */}
          <nav className="space-y-1.5">
            <button
              onClick={() => setActiveTab('cockpit')}
              className={`w-full flex items-center space-x-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                activeTab === 'cockpit'
                  ? 'bg-[var(--bg-card-active)] text-[var(--text-primary)] border border-[var(--border-hover)] shadow-md'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)]'
              }`}
            >
              <LayoutDashboard className="w-4.5 h-4.5 shrink-0" />
              <span>Cockpit Dashboard</span>
            </button>

            <button
              onClick={() => setActiveTab('vault')}
              className={`w-full flex items-center space-x-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                activeTab === 'vault'
                  ? 'bg-[var(--bg-card-active)] text-[var(--text-primary)] border border-[var(--border-hover)] shadow-md'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)]'
              }`}
            >
              <Key className="w-4.5 h-4.5 shrink-0" />
              <span>Credential Vault</span>
            </button>

            <button
              onClick={() => setActiveTab('bridge')}
              className={`w-full flex items-center space-x-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                activeTab === 'bridge'
                  ? 'bg-[var(--bg-card-active)] text-[var(--text-primary)] border border-[var(--border-hover)] shadow-md'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)]'
              }`}
            >
              <Zap className="w-4.5 h-4.5 shrink-0" />
              <span>Agent Bridge</span>
            </button>

            <button
              onClick={() => setActiveTab('database')}
              className={`w-full flex items-center space-x-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all cursor-pointer ${
                activeTab === 'database'
                  ? 'bg-[var(--bg-card-active)] text-[var(--text-primary)] border border-[var(--border-hover)] shadow-md'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)]'
              }`}
            >
              <Database className="w-4.5 h-4.5 shrink-0" />
              <span>Model Database</span>
            </button>

            <button
              onClick={() => setIsGoalStudioOpen(true)}
              className="w-full flex items-center space-x-3 px-3 py-2.5 rounded-xl text-sm font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)] transition-all cursor-pointer"
            >
              <Sparkles className="w-4.5 h-4.5 shrink-0 text-purple-400" />
              <span>Goal Studio</span>
            </button>

            <button
              onClick={() => setIsPoolStudioOpen(true)}
              className="w-full flex items-center space-x-3 px-3 py-2.5 rounded-xl text-sm font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)] transition-all cursor-pointer"
            >
              <Layers className="w-4.5 h-4.5 shrink-0 text-indigo-400" />
              <span>Pool Studio</span>
            </button>

            <button
              onClick={() => setActiveTab('settings')}
              className={`w-full flex items-center space-x-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                activeTab === 'settings'
                  ? 'bg-[var(--bg-card-active)] text-[var(--text-primary)] border border-[var(--border-hover)] shadow-md'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)]'
              }`}
            >
              <Palette className="w-4.5 h-4.5 shrink-0" />
              <span>Settings Studio</span>
            </button>
          </nav>

          {/* System & Telemetry Monitor Section */}
          <div className="pt-3 border-t border-[var(--border-subtle)] space-y-3">
            <div className="text-xs font-mono uppercase tracking-wider text-[var(--text-muted)] px-1 font-bold flex items-center justify-between">
              <span>Telemetry Monitor</span>
              <span className="w-2 h-2 rounded-full bg-[var(--signal-mint)] animate-pulse" />
            </div>

            {/* Route Advisor Card */}
            <div className="p-3 rounded-xl bg-[var(--bg-well)] border border-[var(--border-subtle)] space-y-1.5 shadow-inner">
              <div className="flex items-center justify-between text-xs text-[var(--accent-primary)] font-bold">
                <span className="flex items-center gap-1.5">
                  <Activity className="w-3.5 h-3.5 text-[var(--signal-mint)]" />
                  Advisor
                </span>
                <span className="text-[10px] font-mono bg-[var(--signal-mint)]/10 text-[var(--signal-mint)] px-2 py-0.5 rounded font-bold">LIVE</span>
              </div>
              <p className="text-xs text-[var(--text-secondary)] leading-relaxed font-sans font-medium">
                "{conciergeMsg}"
              </p>
            </div>

            {/* Stream Feed Snapshot */}
            <div className="space-y-2">
              <div className="p-3 rounded-xl bg-[var(--bg-well)] border border-[var(--border-subtle)] text-xs space-y-1">
                <div className="flex justify-between text-[11px] text-[var(--text-muted)] font-mono" dir="ltr">
                  <span>TR-94A20F18</span>
                  <span className="text-[var(--signal-mint)] font-bold">42ms</span>
                </div>
                <div className="font-bold text-xs text-[var(--text-primary)] truncate" dir="ltr">DeepSeek-R1</div>
                <div className="text-xs text-[var(--text-secondary)]">Greedy Set-Cover code route.</div>
              </div>

              <div className="p-3 rounded-xl bg-[var(--bg-well)] border border-[var(--border-subtle)] text-xs space-y-1">
                <div className="flex justify-between text-[11px] text-[var(--text-muted)] font-mono" dir="ltr">
                  <span>TR-88C11B02</span>
                  <span className="text-[var(--signal-mint)] font-bold">85ms</span>
                </div>
                <div className="font-bold text-xs text-[var(--text-primary)] truncate" dir="ltr">Gemini 2.5 Flash</div>
                <div className="text-xs text-[var(--text-secondary)]">Zero-cost throughput route.</div>
              </div>
            </div>
          </div>

        </div>

        {/* Left Rail Footer: System Health & Profile */}
        <div className="space-y-3 pt-3 border-t border-[var(--border-subtle)] mt-4">
          <div className="bg-[var(--bg-well)] p-2.5 rounded-xl border border-[var(--border-subtle)] space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-[var(--text-muted)] font-semibold">Engine SLA</span>
              <span className="text-[var(--signal-mint)] font-mono font-bold">100%</span>
            </div>
            <div className="text-xs text-[var(--text-secondary)]">
              {activeKeys !== null
                ? `${activeKeys} / ${activeKeys} Free Enclave Keys`
                : 'Loading enclave keys…'}
            </div>
          </div>

          <div className="flex items-center space-x-2.5 px-2">
            <div className="w-8 h-8 rounded-full bg-[var(--bg-card-active)] border border-[var(--border-hover)] flex items-center justify-center font-bold text-xs text-[var(--accent-primary)]">
              DEV
            </div>
            <div className="truncate">
              <div className="text-xs font-bold text-[var(--text-primary)] truncate">Developer Station</div>
              <div className="text-xs text-[var(--text-muted)] truncate">Local Workstation</div>
            </div>
          </div>
        </div>
      </aside>

      {/* 2. FLEXIBLE VIEWPORT CANVAS (MIDDLE CONTENT) */}
      <main className="flex-1 h-full overflow-y-auto p-6 md:p-8 custom-scrollbar bg-[var(--bg-obsidian)]">
        {activeTab === 'cockpit' && (
          <CockpitDashboard
            onOpenGoalStudio={() => setIsGoalStudioOpen(true)}
            onOpenPoolStudio={() => setIsPoolStudioOpen(true)}
            onSelectTrace={(trace) => setSelectedTrace(trace)}
          />
        )}
        {activeTab === 'bridge' && <AgentBridge />}
        {activeTab === 'vault' && <CredentialVault />}
        {activeTab === 'database' && <DatabaseStudio />}
        {activeTab === 'settings' && (
          <div className="max-w-4xl mx-auto">
            <SettingsAppearanceStudio />
          </div>
        )}
      </main>

      {/* 3. AGENTIC CHAT INTERFACE (RIGHT RAIL - RESIZABLE) */}
      <aside
        className="relative w-full h-full bg-[var(--bg-rail)] border-l border-[var(--border-subtle)] flex flex-col shrink-0 overflow-hidden z-10"
        style={{ width: `${rightPanelWidth}px` }}
      >
        {/* Left Edge Drag Handle */}
        <div
          onMouseDown={() => setIsResizingRight(true)}
          className="absolute top-0 left-0 bottom-0 w-2.5 cursor-col-resize hover:bg-[var(--accent-primary)]/40 active:bg-[var(--accent-primary)] z-30 transition-colors group flex items-center justify-center -ml-1"
          title="Drag to adjust panel width"
        >
          <div className="w-1 h-8 rounded-full bg-[var(--border-hover)] group-hover:bg-[var(--accent-primary)] transition-colors" />
        </div>

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

      {/* Pool Studio Modal Container */}
      <PoolStudioModal
        isOpen={isPoolStudioOpen}
        onClose={() => setIsPoolStudioOpen(false)}
        onPoolsUpdated={() => {
          setConciergeMsg('Routing pools updated. Execution rules apply immediately to incoming traffic.');
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

