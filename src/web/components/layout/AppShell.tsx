import React, { useState } from 'react';
import { LayoutDashboard, Key, Palette, Sparkles, Activity, ShieldCheck, Cpu, Terminal, ArrowUpRight, CheckCircle2, ChevronRight, Zap, RefreshCw, MessageSquare } from 'lucide-react';
import { CockpitDashboard } from '../cockpit/CockpitDashboard.js';
import { CredentialVault } from '../vault/CredentialVault.js';
import { SettingsAppearanceStudio } from '../settings/SettingsAppearanceStudio.js';
import { GoalStudioModal } from '../modals/GoalStudioModal.js';
import { DecisionInspectorDrawer, DecisionTrace } from '../drawers/DecisionInspectorDrawer.js';
import { GlossaryTerm } from '../common/GlossaryTerm.js';

export const AppShell: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'cockpit' | 'vault' | 'settings'>('cockpit');
  const [isGoalStudioOpen, setIsGoalStudioOpen] = useState(false);
  const [selectedTrace, setSelectedTrace] = useState<DecisionTrace | null>(null);
  const [conciergeMsg, setConciergeMsg] = useState('GoalRoute Copilot active. Monitoring 6 free enclave keys with 0ms overhead.');

  return (
    <div className="min-h-screen bg-[var(--bg-obsidian)] text-slate-100 font-sans flex flex-col md:flex-row overflow-hidden">
      
      {/* 1. FIXED 240px LEFT NAVIGATION RAIL */}
      <aside className="w-full md:w-60 bg-[var(--bg-rail)] border-r border-[var(--border-subtle)] flex flex-col justify-between p-4 shrink-0 z-20">
        <div className="space-y-6">
          
          {/* Logo & Workspace */}
          <div className="space-y-3">
            <div className="flex items-center space-x-3 px-2">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-[var(--accent-primary)] to-[var(--signal-mint)] p-0.5 flex items-center justify-center shadow-lg shadow-[var(--accent-primary)]/20">
                <div className="w-full h-full bg-slate-950 rounded-[10px] flex items-center justify-center text-[var(--signal-mint)]">
                  <Zap className="w-5 h-5" />
                </div>
              </div>
              <div>
                <h1 className="font-extrabold text-base tracking-tight text-white flex items-center gap-1.5">
                  GoalRoute
                  <span className="w-2 h-2 rounded-full bg-[var(--signal-mint)] animate-pulse" />
                </h1>
                <p className="text-[10px] text-[var(--text-muted)] font-mono">v0.1.0 Gateway</p>
              </div>
            </div>

            {/* Active Workspace Switcher */}
            <div className="bg-[var(--bg-well)] p-2.5 rounded-xl border border-[var(--border-subtle)] text-xs space-y-1">
              <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider font-semibold">Active Workspace</div>
              <div className="font-bold text-white truncate font-mono" dir="ltr">FreeLLM-Gateway</div>
            </div>
          </div>

          {/* Navigation Links */}
          <nav className="space-y-1.5">
            <button
              onClick={() => setActiveTab('cockpit')}
              className={`w-full flex items-center space-x-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                activeTab === 'cockpit'
                  ? 'bg-[var(--bg-card-active)] text-white border border-[var(--accent-primary)]/40 shadow-md'
                  : 'text-[var(--text-secondary)] hover:text-white hover:bg-[var(--bg-card)]'
              }`}
            >
              <LayoutDashboard className={`w-4 h-4 ${activeTab === 'cockpit' ? 'text-[var(--accent-primary)]' : ''}`} />
              <span>Cockpit Dashboard</span>
            </button>

            <button
              onClick={() => setActiveTab('vault')}
              className={`w-full flex items-center space-x-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                activeTab === 'vault'
                  ? 'bg-[var(--bg-card-active)] text-white border border-[var(--accent-primary)]/40 shadow-md'
                  : 'text-[var(--text-secondary)] hover:text-white hover:bg-[var(--bg-card)]'
              }`}
            >
              <Key className={`w-4 h-4 ${activeTab === 'vault' ? 'text-[var(--accent-primary)]' : ''}`} />
              <span>Credential Vault</span>
            </button>

            <button
              onClick={() => setActiveTab('settings')}
              className={`w-full flex items-center space-x-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                activeTab === 'settings'
                  ? 'bg-[var(--bg-card-active)] text-white border border-[var(--accent-primary)]/40 shadow-md'
                  : 'text-[var(--text-secondary)] hover:text-white hover:bg-[var(--bg-card)]'
              }`}
            >
              <Palette className={`w-4 h-4 ${activeTab === 'settings' ? 'text-[var(--accent-primary)]' : ''}`} />
              <span>Settings Studio</span>
            </button>
          </nav>
        </div>

        {/* Left Rail Footer: System Health & Profile */}
        <div className="space-y-3 pt-4 border-t border-[var(--border-subtle)]">
          <div className="bg-[var(--bg-well)] p-2.5 rounded-xl border border-[var(--border-subtle)] space-y-1">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-[var(--text-muted)] font-medium">Engine SLA</span>
              <span className="text-[var(--signal-mint)] font-mono font-bold">100%</span>
            </div>
            <div className="text-[10px] text-[var(--text-secondary)]">6 / 6 Free Enclave Keys</div>
          </div>

          <div className="flex items-center space-x-2.5 px-2">
            <div className="w-7 h-7 rounded-full bg-[var(--bg-card-active)] border border-[var(--border-hover)] flex items-center justify-center font-bold text-xs text-[var(--accent-primary)]">
              DEV
            </div>
            <div className="truncate">
              <div className="text-xs font-bold text-white truncate">Developer Station</div>
              <div className="text-[10px] text-[var(--text-muted)] truncate">Local Workstation</div>
            </div>
          </div>
        </div>
      </aside>

      {/* 2. FLEXIBLE VIEWPORT CANVAS (MIDDLE CONTENT) */}
      <main className="flex-1 overflow-y-auto p-6 md:p-8 custom-scrollbar bg-[var(--bg-obsidian)]">
        {activeTab === 'cockpit' && (
          <CockpitDashboard
            onOpenGoalStudio={() => setIsGoalStudioOpen(true)}
            onSelectTrace={(trace) => setSelectedTrace(trace)}
          />
        )}
        {activeTab === 'vault' && <CredentialVault />}
        {activeTab === 'settings' && <SettingsAppearanceStudio />}
      </main>

      {/* 3. FIXED 360px AI CONCIERGE SIDE PANEL (RIGHT RAIL) */}
      <aside className="w-full md:w-[360px] bg-[var(--bg-rail)] border-l border-[var(--border-subtle)] flex flex-col justify-between p-5 shrink-0 space-y-6 overflow-y-auto custom-scrollbar z-10">
        <div className="space-y-6">
          
          {/* Header */}
          <div className="flex items-center space-x-2.5 pb-4 border-b border-[var(--border-subtle)]">
            <div className="p-2 rounded-xl bg-[var(--accent-primary)]/10 text-[var(--accent-primary)] border border-[var(--accent-primary)]/30">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-bold text-sm text-white">GoalRoute Copilot</h2>
              <p className="text-[10px] text-[var(--text-muted)]">Real-time Route Advisor Concierge</p>
            </div>
          </div>

          {/* Real-time Advisor Quote Box */}
          <div className="p-4 rounded-2xl bg-[var(--bg-card)] border border-[var(--border-hover)] space-y-2 relative shadow-lg">
            <div className="flex items-center justify-between text-xs text-[var(--accent-primary)] font-semibold">
              <span className="flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5 text-[var(--signal-mint)]" />
                Live Recommendation
              </span>
              <span className="text-[10px] font-mono text-[var(--signal-mint)]">OPTIMAL</span>
            </div>
            <p className="text-xs text-slate-200 leading-relaxed font-sans">
              "{conciergeMsg}"
            </p>
          </div>

          {/* Quick Actions Panel */}
          <div className="space-y-2">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">Quick Actions</div>
            
            <button
              onClick={() => setIsGoalStudioOpen(true)}
              className="w-full p-3 rounded-xl bg-[var(--bg-card)] hover:bg-[var(--bg-card-active)] border border-[var(--border-subtle)] text-xs font-semibold text-white flex items-center justify-between transition-colors shadow-sm"
            >
              <span className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-[var(--accent-primary)]" />
                Configure Goal Studio
              </span>
              <ChevronRight className="w-4 h-4 text-[var(--text-muted)]" />
            </button>

            <button
              onClick={() => setActiveTab('vault')}
              className="w-full p-3 rounded-xl bg-[var(--bg-card)] hover:bg-[var(--bg-card-active)] border border-[var(--border-subtle)] text-xs font-semibold text-white flex items-center justify-between transition-colors shadow-sm"
            >
              <span className="flex items-center gap-2">
                <Key className="w-4 h-4 text-[var(--signal-mint)]" />
                Probe Credential Keys
              </span>
              <ChevronRight className="w-4 h-4 text-[var(--text-muted)]" />
            </button>

            <button
              onClick={() => setActiveTab('settings')}
              className="w-full p-3 rounded-xl bg-[var(--bg-card)] hover:bg-[var(--bg-card-active)] border border-[var(--border-subtle)] text-xs font-semibold text-white flex items-center justify-between transition-colors shadow-sm"
            >
              <span className="flex items-center gap-2">
                <Palette className="w-4 h-4 text-purple-400" />
                Appearance & Theme Studio
              </span>
              <ChevronRight className="w-4 h-4 text-[var(--text-muted)]" />
            </button>
          </div>

          {/* Live Decision Feed Snapshot */}
          <div className="space-y-3">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">Telemetry Stream Feed</div>
            
            <div className="space-y-2">
              <div className="p-3 rounded-xl bg-[var(--bg-well)] border border-[var(--border-subtle)] text-xs space-y-1">
                <div className="flex justify-between text-[10px] text-[var(--text-muted)] font-mono" dir="ltr">
                  <span>TR-94A20F18</span>
                  <span className="text-[var(--signal-mint)]">42ms</span>
                </div>
                <div className="font-semibold text-white truncate" dir="ltr">DeepSeek-R1</div>
                <div className="text-[11px] text-[var(--text-secondary)]">Greedy Set-Cover chosen for code optimization.</div>
              </div>

              <div className="p-3 rounded-xl bg-[var(--bg-well)] border border-[var(--border-subtle)] text-xs space-y-1">
                <div className="flex justify-between text-[10px] text-[var(--text-muted)] font-mono" dir="ltr">
                  <span>TR-88C11B02</span>
                  <span className="text-[var(--signal-mint)]">85ms</span>
                </div>
                <div className="font-semibold text-white truncate" dir="ltr">Gemini 2.5 Flash</div>
                <div className="text-[11px] text-[var(--text-secondary)]">Zero-cost route selected under high throughput.</div>
              </div>
            </div>
          </div>

        </div>

        {/* Footer Info */}
        <div className="pt-4 border-t border-[var(--border-subtle)] text-center text-[10px] font-mono text-[var(--text-muted)] space-y-1">
          <div>GoalRoute Gateway Engine</div>
          <div className="text-[var(--signal-mint)]">Zero Billable Cost Policy Active</div>
        </div>
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
