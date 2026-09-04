import { useState, useEffect, useRef, useCallback } from 'react';
import {
  getConfig,
  saveConfig,
  getStats,
  API_BASE
} from './utils/api';
import type { GatewayConfig, Stats } from './utils/api';
import { Directory } from './components/Directory';
import { GatewaySetup } from './components/GatewaySetup';
import { ActivePools } from './components/ActivePools';
import { AgentChat } from './components/AgentChat';
import { IntegrationHub } from './components/IntegrationHub';
import { Playground } from './components/Playground';
import { Statistics } from './components/Statistics';
import { SystemAlerts } from './components/SystemAlerts';

const MIN_SIDEBAR = 300;
const MAX_SIDEBAR = 560;
const DEFAULT_SIDEBAR = 380;

export function App() {
  const [activeTab, setActiveTab] = useState<'directory' | 'setup' | 'pools' | 'playground' | 'integrations' | 'statistics' | 'alerts'>('directory');
  const [showAssistant, setShowAssistant] = useState(true);
  const [config, setConfig] = useState<GatewayConfig | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [serverOnline, setServerOnline] = useState(false);

  // Drag-resizable assistant panel state
  const [assistantWidth, setAssistantWidth] = useState(DEFAULT_SIDEBAR);
  const [isResizing, setIsResizing] = useState(false);
  const resizeStartX = useRef(0);
  const resizeStartWidth = useRef(DEFAULT_SIDEBAR);

  // Fetch initial config and check server connectivity
  const fetchInitialData = async () => {
    try {
      setLoading(true);
      setError(null);
      const confData = await getConfig();
      setConfig(confData);

      const statsData = await getStats();
      setStats(statsData.stats);

      setServerOnline(true);
    } catch (err: any) {
      console.error(err);
      setError(`Cannot connect to Gateway Server at ${API_BASE}. Make sure the backend server is running.`);
      setServerOnline(false);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInitialData();
  }, []);

  // Poll stats in background
  useEffect(() => {
    if (!serverOnline) return;
    const timer = setInterval(async () => {
      try {
        const statsData = await getStats();
        setStats(statsData.stats);
      } catch (err) {
        console.error('Error polling stats:', err);
      }
    }, 4000);
    return () => clearInterval(timer);
  }, [serverOnline]);

  // ── Drag-resize handlers (assistant panel left-edge handle) ──
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    resizeStartX.current = e.clientX;
    resizeStartWidth.current = assistantWidth;
  }, [assistantWidth]);

  useEffect(() => {
    if (!isResizing) return;

    const onMove = (e: MouseEvent) => {
      // Handle sits on the panel's left edge → moving mouse left = wider panel
      const delta = resizeStartX.current - e.clientX;
      const newWidth = Math.min(MAX_SIDEBAR, Math.max(MIN_SIDEBAR, resizeStartWidth.current + delta));
      setAssistantWidth(newWidth);
    };

    const onUp = () => setIsResizing(false);

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [isResizing]);

  // No text selection + col-resize cursor while dragging
  useEffect(() => {
    if (isResizing) {
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'col-resize';
    } else {
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    }
  }, [isResizing]);

  const handleSaveConfig = async (newConfig: GatewayConfig) => {
    try {
      const res = await saveConfig(newConfig);
      if (res.success) {
        setConfig(newConfig);
        // Refresh stats
        const statsData = await getStats();
        setStats(statsData.stats);
      }
    } catch (err: any) {
      alert(`Error saving configuration: ${err.message}`);
    }
  };

  if (loading && !config) {
    return (
      <div className="flex flex-col justify-center items-center h-screen gap-4 bg-background text-on-surface">
        <div className="w-10 h-10 border-4 border-white/10 border-t-primary rounded-full animate-spin" />
        <span className="text-on-surface-variant font-semibold text-sm">
          Connecting to LLM Pool Gateway...
        </span>
      </div>
    );
  }

  const navItems: Array<{ id: typeof activeTab; label: string; icon: string; badge?: number }> = [
    { id: 'directory', label: 'Directory', icon: 'explore' },
    { id: 'setup', label: 'Gateway & Providers', icon: 'cell_tower' },
    { id: 'pools', label: 'Routing Pools', icon: 'alt_route' },
    { id: 'playground', label: 'Playground', icon: 'terminal' },
    { id: 'integrations', label: 'Tool Connectors', icon: 'extension' },
    { id: 'statistics', label: 'Usage & Telemetry', icon: 'monitoring' },
    {
      id: 'alerts',
      label: 'Alerts & Failover',
      icon: 'crisis_alert',
      badge: (config as any)?.alerts?.length || 0,
    },
  ];

  return (
    <div className="flex h-screen overflow-hidden bg-background text-on-surface font-body antialiased">
      {/* ── Left Navigation Sidebar ─────────────────────────────────────── */}
      <aside className="w-[260px] shrink-0 h-full bg-background border-r border-white/[0.07] flex flex-col">
        {/* Brand header */}
        <div className="h-20 px-5 flex items-center justify-between border-b border-white/[0.06] shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-primary/15 border border-primary/30 flex items-center justify-center text-primary-soft">
              <span className="material-symbols-outlined text-[20px]">hub</span>
            </div>
            <div className="flex flex-col">
              <span className="font-headline font-bold text-sm text-white tracking-tight leading-none">
                PoolGateway
              </span>
              <span className="text-[11px] text-on-surface-variant mt-1">Edge AI Orchestrator</span>
            </div>
          </div>
        </div>

        {/* Navigation links */}
        <nav className="flex-1 overflow-y-auto p-3 space-y-1">
          {navItems.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl text-xs cursor-pointer transition-colors ${
                  isActive
                    ? 'text-white bg-surface-container border border-primary/35 font-semibold'
                    : 'text-on-surface-variant hover:text-white hover:bg-surface-low border border-transparent'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span
                    className={`material-symbols-outlined text-[18px] ${
                      isActive ? 'text-primary-soft' : 'text-on-surface-variant'
                    }`}
                  >
                    {item.icon}
                  </span>
                  <span className="truncate">{item.label}</span>
                </div>
                {item.badge ? (
                  <span className="px-1.5 py-0.5 text-[10px] font-mono font-bold rounded-full bg-coral/15 text-coral border border-coral/30">
                    {item.badge}
                  </span>
                ) : isActive ? (
                  <span className="w-1.5 h-1.5 rounded-full bg-primary shadow-[0_0_8px_#8b5cf6]" />
                ) : null}
              </button>
            );
          })}
        </nav>

        {/* Sidebar footer — live status */}
        <div className="p-4 border-t border-white/[0.06] space-y-3 shrink-0">
          <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-surface-low border border-white/[0.06]">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span
                  className={`absolute inline-flex h-full w-full rounded-full opacity-75 ${
                    serverOnline ? 'bg-mint animate-ping' : 'bg-coral'
                  }`}
                />
                <span
                  className={`relative inline-flex h-2 w-2 rounded-full ${
                    serverOnline ? 'bg-mint' : 'bg-coral'
                  }`}
                />
              </span>
              <span className="label-mono text-on-surface">
                {serverOnline ? 'Online' : 'Offline'}
              </span>
            </div>
            <span className="text-[10px] font-mono text-on-surface-variant">99.9%</span>
          </div>
          <div className="flex items-center justify-between text-[11px] font-mono text-on-surface-variant px-1">
            <span>Port {config?.metadata?.port || 3000}</span>
            <button
              type="button"
              onClick={() => setShowAssistant((v) => !v)}
              className={`btn-ghost p-1.5 cursor-pointer ${
                showAssistant ? 'text-primary-soft' : ''
              }`}
              title={showAssistant ? 'Hide agent panel' : 'Show agent panel'}
            >
              <span className="material-symbols-outlined text-[18px]">smart_toy</span>
            </button>
          </div>
        </div>
      </aside>

      {/* ── Main Content View ──────────────────────────────────────────── */}
      <main className="flex-1 h-full overflow-y-auto flex flex-col">
        <div className="flex-1 p-6 lg:p-8 max-w-7xl w-full mx-auto space-y-6">
          {error && (
            <div className="flex items-center gap-2.5 p-4 rounded-xl bg-coral/10 border border-coral/25 text-coral text-xs font-semibold">
              <span className="material-symbols-outlined text-[18px]">error</span>
              {error}
            </div>
          )}

          {/* Live gateway stats strip */}
          {stats && (
            <div className="flex flex-wrap items-stretch gap-3">
              <div className="card px-4 py-3 flex items-center gap-2.5">
                <span className="material-symbols-outlined text-[18px] text-mint">savings</span>
                <div className="flex flex-col">
                  <span className="label-mono text-muted">Cost Saved</span>
                  <span className="font-mono text-sm font-bold text-mint">
                    ${stats.approximateCostSaved.toFixed(2)}
                  </span>
                </div>
              </div>
              <div className="card px-4 py-3 flex items-center gap-2.5">
                <span className="material-symbols-outlined text-[18px] text-primary-soft">stacks</span>
                <div className="flex flex-col">
                  <span className="label-mono text-muted">Tokens Pooled</span>
                  <span className="font-mono text-sm font-bold text-on-surface">
                    {stats.tokensSaved.toLocaleString()}
                  </span>
                </div>
              </div>
              <div className="card px-4 py-3 flex items-center gap-2.5">
                <span className="material-symbols-outlined text-[18px] text-sky">verified</span>
                <div className="flex flex-col">
                  <span className="label-mono text-muted">Success Rate</span>
                  <span className="font-mono text-sm font-bold text-mint">
                    {stats.totalRequests > 0
                      ? `${((stats.successfulRequests / stats.totalRequests) * 100).toFixed(1)}%`
                      : '100%'}
                  </span>
                </div>
              </div>
            </div>
          )}

          {config && (
            <>
              {activeTab === 'directory' && <Directory providers={config.providers} />}
              {activeTab === 'setup' && <GatewaySetup config={config} onSave={handleSaveConfig} />}
              {activeTab === 'pools' && <ActivePools config={config} onSave={handleSaveConfig} />}
              {activeTab === 'playground' && <Playground config={config} />}
              {activeTab === 'integrations' && <IntegrationHub config={config} />}
              {activeTab === 'statistics' && <Statistics config={config} />}
              {activeTab === 'alerts' && (
                <SystemAlerts config={config} onSave={handleSaveConfig} activeTab={activeTab} />
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <footer className="px-8 py-4 border-t border-white/[0.06] text-xs text-on-surface-variant flex flex-col sm:flex-row items-center justify-between gap-2 shrink-0">
          <span>LLM Free Pool Gateway &copy; 2026 — Local failover router &amp; API credentials portal</span>
          <span className="font-mono text-[11px]">
            Endpoint:{' '}
            <code className="text-primary-soft">
              {`${window.location.protocol}//${window.location.hostname}:${config?.metadata?.port || 3000}/v1`}
            </code>
          </span>
        </footer>
      </main>

      {/* ── Agent Assistant Panel (drag-resizable, toggleable) ─────────── */}
      {showAssistant && config && (
        <aside
          className="shrink-0 h-full bg-surface border-l border-white/[0.07] overflow-hidden"
          style={{
            width: assistantWidth,
            transition: isResizing ? 'none' : 'width 0.2s ease',
          }}
        >
          <AgentChat
            config={config}
            onConfigChange={fetchInitialData}
            sidebarWidth={assistantWidth}
            onResizeStart={handleResizeStart}
          />
        </aside>
      )}
    </div>
  );
}

export default App;

