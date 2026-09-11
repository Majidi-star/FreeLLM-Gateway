import React, { useState } from 'react';
import { Activity, Zap, Cpu, ArrowUpRight, CheckCircle2, AlertTriangle, Sparkles, Sliders, RefreshCw, ChevronRight } from 'lucide-react';
import { DecisionTrace } from '../drawers/DecisionInspectorDrawer.js';
import { GlossaryTerm } from '../common/GlossaryTerm.js';

interface CockpitDashboardProps {
  onOpenGoalStudio: () => void;
  onSelectTrace: (trace: DecisionTrace) => void;
}

let traceIdCounter = 0;

function convertSseEventToDecisionTrace(evt: any): DecisionTrace {
  const dateStr = evt.timestamp ? new Date(evt.timestamp).toLocaleTimeString() : new Date().toLocaleTimeString();
  const candidateList = (evt.candidateTrace || []).map((c: any) => ({
    name: c.modelId || evt.model || 'Unknown Model',
    provider: c.providerSlug || evt.provider || 'Unknown Provider',
    latencyMs: c.latencyMs || 0,
    score: c.status === 'selected' ? 95 : 70,
    status: c.status === 'selected' ? ('selected' as const) : (c.status === 'skipped' ? ('filtered' as const) : ('evaluated' as const)),
    reason: c.reason || c.error || (c.status === 'selected' ? 'Selected Winner' : 'Evaluated candidate'),
  }));

  return {
    id: evt.traceId || evt.id || `tr-live-${Date.now().toString(36)}-${(traceIdCounter = (traceIdCounter + 1) % 1e6).toString(36)}`,
    timestamp: dateStr,
    promptSnippet: evt.promptSnippet || `${evt.clientName || 'Client'} request -> ${evt.provider || 'Gateway'}/${evt.model || 'LLM'}`,
    selectedModel: evt.model || 'Unknown Model',
    selectedProvider: evt.provider || 'Unknown Provider',
    latencyMs: evt.latencyMs || 0,
    tokens: evt.tokens || { prompt: 0, completion: 0, total: 0 },
    routingPolicy: evt.isFallback ? 'Self-Healing Failover' : 'Greedy Set-Cover',
    heuristicScore: evt.isFallback ? 82 : 98,
    verdict: evt.isFallback
      ? `Failover triggered! Switched to ${evt.provider}/${evt.model} after primary route encountered an error or cooldown.`
      : `Selected ${evt.model} via ${evt.provider} due to latency advantage while meeting quality constraints.`,
    isFallback: Boolean(evt.isFallback),
    candidates: candidateList.length > 0 ? candidateList : [
      { name: evt.model || 'Primary Model', provider: evt.provider || 'Provider', latencyMs: evt.latencyMs || 0, score: 95, status: 'selected' }
    ],
    factors: { latency: 95, cost: 100, capability: 90, health: 100 },
  };
}

type StreamStatus = 'connecting' | 'live' | 'unauthorized' | 'closed';

const getAdminToken = () =>
  sessionStorage.getItem('goalroute_admin_token') ||
  localStorage.getItem('goalroute_admin_token') ||
  (import.meta as any).env?.VITE_ADMIN_API_TOKEN ||
  'dev-admin-secret-token';

interface CatalogModelItem {
  id: string;
  modelName: string;
  displayName: string;
  contextWindow: number;
  supportsTools: boolean;
  supportsVision: boolean;
  costInputPer1k: number;
  costOutputPer1k: number;
  benchTps: number | null;
  benchTtftMs: number | null;
  providerSlug: string;
  providerDisplayName: string;
}

const formatContextWindow = (cw: number): string => {
  if (!cw) return '128k';
  if (cw >= 1000000) {
    const val = cw / 1000000;
    return `${val % 1 === 0 ? val : val.toFixed(2)}M`;
  }
  return `${Math.round(cw / 1000)}k`;
};

export const CockpitDashboard: React.FC<CockpitDashboardProps> = ({ onOpenGoalStudio, onSelectTrace }) => {
  const [activeSetupPreset, setActiveSetupPreset] = useState<'standard' | 'high_perf' | 'cost_saver' | 'reasoning'>('standard');
  const [traces, setTraces] = useState<DecisionTrace[]>([]);
  const [activePools, setActivePools] = useState(0);
  const [presetError, setPresetError] = useState<string | null>(null);
  const [savingPreset, setSavingPreset] = useState(false);
  const [streamStatus, setStreamStatus] = useState<StreamStatus>('connecting');
  const [catalogModels, setCatalogModels] = useState<CatalogModelItem[]>([]);

  React.useEffect(() => {
    const adminToken = getAdminToken();
    fetch('/api/v1/catalog/models', {
      headers: adminToken ? { authorization: `Bearer ${adminToken}` } : {},
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) {
          setCatalogModels(data);
        }
      })
      .catch(() => {});
  }, []);

  React.useEffect(() => {
    const adminToken = getAdminToken();
    fetch('/api/v1/pools', {
      headers: adminToken ? { authorization: `Bearer ${adminToken}` } : {},
    })
      .then((res) => (res.ok ? res.json() : []))
      .then((pools) => {
        if (Array.isArray(pools)) {
          setActivePools(pools.filter((p: any) => p && (p.is_active === undefined || p.is_active === 1 || p.is_active === true)).length);
        }
      })
      .catch(() => {});
  }, []);

  // Real telemetry aggregates computed from live traces loaded from SQLite / SSE.
  const completedTraces = traces.filter((t) => t.latencyMs > 0);
  const avgLatencyMs = completedTraces.length
    ? Math.round(completedTraces.reduce((sum, t) => sum + t.latencyMs, 0) / completedTraces.length)
    : 0;
  const successPct = traces.length
    ? Math.round((traces.filter((t) => !t.isFallback).length / traces.length) * 1000) / 10
    : null;

  const PRESET_GOAL_PARAMS: Record<typeof activeSetupPreset, { label: string; taskType: string; latencyPref: string; reliabilityPref: string }> = {
    standard: { label: 'Standard Balanced', taskType: 'general', latencyPref: 'relaxed', reliabilityPref: 'standard' },
    high_perf: { label: 'Ultra Low Latency', taskType: 'chatbot', latencyPref: 'instant', reliabilityPref: 'standard' },
    cost_saver: { label: 'Maximum Free Quota', taskType: 'batch', latencyPref: 'relaxed', reliabilityPref: 'standard' },
    reasoning: { label: 'Deep Reasoning', taskType: 'research', latencyPref: 'relaxed', reliabilityPref: 'maximum' },
  };

  const handleSetupPreset = async (preset: 'standard' | 'high_perf' | 'cost_saver' | 'reasoning') => {
    setActiveSetupPreset(preset);
    const params = PRESET_GOAL_PARAMS[preset];
    setSavingPreset(true);
    setPresetError(null);
    try {
      const adminToken = getAdminToken();
      const res = await fetch('/api/v1/goals', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(adminToken ? { authorization: `Bearer ${adminToken}` } : {}),
        },
        body: JSON.stringify({
          name: `Goal - ${params.label}`,
          task_type: params.taskType,
          latency_pref: params.latencyPref,
          budget_pref: 'free',
          reliability_pref: params.reliabilityPref,
          exhaustion_pref: preset === 'cost_saver' ? 'fill_first' : 'preserve_backup',
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `Failed to persist goal (HTTP ${res.status})`);
      }
    } catch (e: any) {
      setPresetError(e.message || 'Failed to persist goal');
    } finally {
      setSavingPreset(false);
    }
  };

  const [isSyncing, setIsSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  const fetchCatalogModels = async () => {
    const adminToken = getAdminToken();
    const res = await fetch('/api/v1/catalog/models', {
      headers: adminToken ? { authorization: `Bearer ${adminToken}` } : {},
    });
    if (!res.ok) return;
    const data = await res.json().catch(() => null);
    if (Array.isArray(data) && data.length > 0) {
      setCatalogModels(data);
    }
  };

  const handleSyncModels = async () => {
    setIsSyncing(true);
    setSyncError(null);
    try {
      const adminToken = getAdminToken();
      const res = await fetch('/api/v1/catalog/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(adminToken ? { authorization: `Bearer ${adminToken}` } : {}),
        },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) {
        throw new Error(data.message || `Sync failed (HTTP ${res.status})`);
      }
      await fetchCatalogModels();
    } catch (e: any) {
      setSyncError(e.message || 'Model sync failed');
    } finally {
      setIsSyncing(false);
    }
  };

  React.useEffect(() => {
    const adminToken = getAdminToken();
    const controller = new AbortController();

    // Preload recent logs from API
    fetch('/api/v1/request-logs', {
      headers: adminToken ? { authorization: `Bearer ${adminToken}` } : {},
      signal: controller.signal,
    })
      .then((res) => {
        if (res.status === 401) {
          setStreamStatus('unauthorized');
          throw new Error('Unauthorized');
        }
        if (!res.ok) throw new Error(`HTTP error ${res.status}`);
        setStreamStatus('live');
        return res.json();
      })
      .then((logs) => {
        if (Array.isArray(logs) && logs.length > 0) {
          const mapped = logs.map((l: any) => {
            let traceList = [];
            try { traceList = JSON.parse(l.decision_trace || '[]'); } catch {}
            return convertSseEventToDecisionTrace({
              traceId: l.id,
              timestamp: l.created_at,
              clientName: 'GoalRoute Client',
              provider: l.connection_id ? l.connection_id : 'Gateway',
              model: l.model_id ? l.model_id : 'LLM',
              tokens: { prompt: l.tokens_in || 0, completion: l.tokens_out || 0, total: (l.tokens_in || 0) + (l.tokens_out || 0) },
              latencyMs: l.latency_ms || 0,
              isFallback: l.status === 'failed' || traceList.length > 1,
              candidateTrace: traceList,
            });
          });
          setTraces((prev) => {
            const ids = new Set(prev.map((t) => t.id));
            const newUnique = mapped.filter((t) => !ids.has(t.id));
            return [...newUnique, ...prev].slice(0, 50);
          });
        }
      })
      .catch(() => {});

    // Subscribe to SSE real-time stream
    const sseUrl = adminToken
      ? `/api/v1/request-logs/stream?token=${encodeURIComponent(adminToken)}`
      : '/api/v1/request-logs/stream';
    const es = new EventSource(sseUrl);
    let reconnectCount = 0;

    es.onopen = () => {
      setStreamStatus('live');
    };

    es.onmessage = (event) => {
      reconnectCount = 0;
      setStreamStatus('live');
      try {
        const parsed = JSON.parse(event.data);
        if (parsed && (parsed.traceId || parsed.provider)) {
          const traceObj = convertSseEventToDecisionTrace(parsed);
          setTraces((prev) => [traceObj, ...prev.filter((t) => t.id !== traceObj.id)].slice(0, 50));
        }
      } catch {}
    };

    es.onerror = () => {
      reconnectCount += 1;
      if (reconnectCount >= 5) {
        es.close();
        setStreamStatus((prev) => (prev === 'unauthorized' ? 'unauthorized' : 'closed'));
      }
    };

    return () => {
      controller.abort();
      es.close();
    };
  }, []);

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      
      {/* Ambient System Health Ribbon */}
      <div className="p-4 rounded-[24px] bg-[var(--bg-card)] border border-[var(--border-subtle)] shadow-xl flex flex-wrap items-center justify-between gap-4">
        
        {/* Gateway Pulse */}
        <div className="flex items-center space-x-3">
          <div className="relative flex items-center justify-center">
            <span className="w-3 h-3 rounded-full bg-[var(--signal-mint)] animate-ping absolute opacity-75" />
            <span className="w-3 h-3 rounded-full bg-[var(--signal-mint)] relative" />
          </div>
          <div>
            <div className="font-bold text-sm text-[var(--text-primary)] flex items-center gap-2">
              GoalRoute Self-Healing Routing Engine
              <span className="text-[10px] font-mono bg-[var(--signal-mint)]/10 text-[var(--signal-mint)] border border-[var(--signal-mint)]/20 px-2 py-0.5 rounded-full">
                ONLINE
              </span>
            </div>
            <div className="text-xs text-[var(--text-muted)] mt-0.5">
              {activePools} Active Routing Pool{activePools === 1 ? '' : 's'} (SQLite)
            </div>
          </div>
        </div>

        {/* Live Metrics Ribbon */}
        <div className="flex items-center space-x-6 text-xs font-mono" dir="ltr">
          <div className="text-right">
            <div className="text-[var(--text-muted)] text-[10px] uppercase">Requests Logged</div>
            <div className="font-bold text-[var(--text-primary)] text-sm">{traces.length} <span className="text-[10px] text-[var(--text-muted)]">in stream</span></div>
          </div>

          <div className="h-8 w-px bg-[var(--border-subtle)]" />

          <div className="text-right">
            <div className="text-[var(--text-muted)] text-[10px] uppercase">Avg Latency</div>
            <div className="font-bold text-[var(--signal-mint)] text-sm">{avgLatencyMs > 0 ? `${avgLatencyMs} ms` : '—'}</div>
          </div>

          <div className="h-8 w-px bg-[var(--border-subtle)]" />

          <div className="text-right">
            <div className="text-[var(--text-muted)] text-[10px] uppercase">Success Rate</div>
            <div className="font-bold text-[var(--text-primary)] text-sm">{successPct !== null ? `${successPct}%` : '—'}</div>
          </div>

          <div className="h-8 w-px bg-[var(--border-subtle)]" />

          <div className="text-right">
            <div className="text-[var(--text-muted)] text-[10px] uppercase">Billable Cost</div>
            <div className="font-bold text-[var(--signal-mint)] text-sm">$0.00</div>
          </div>
        </div>
      </div>

      {/* 1-Click Setup Presets Bar */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">1-Click Setup Presets</label>
          <button
            onClick={onOpenGoalStudio}
            className="text-xs font-semibold text-[var(--accent-primary)] hover:underline flex items-center gap-1"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Customize Goal Studio Constraints →</span>
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {presetError && (
            <div className="col-span-2 sm:col-span-4 text-[10px] font-mono text-red-400">{presetError}</div>
          )}
          <button
            onClick={() => handleSetupPreset('standard')}
            disabled={savingPreset}
            className={`p-3.5 rounded-2xl border text-left transition-all ${
              activeSetupPreset === 'standard'
                ? 'bg-[var(--bg-card-active)] border-[var(--accent-primary)] shadow-md shadow-[var(--accent-primary)]/10'
                : 'bg-[var(--bg-card)] border-[var(--border-subtle)] hover:border-[var(--border-hover)]'
            }`}
          >
            <div className="font-bold text-xs text-[var(--text-primary)]">Standard Balanced</div>
            <div className="text-[11px] text-[var(--text-muted)] mt-0.5">Equal speed & accuracy</div>
          </button>

          <button
            onClick={() => handleSetupPreset('high_perf')}
            disabled={savingPreset}
            className={`p-3.5 rounded-2xl border text-left transition-all ${
              activeSetupPreset === 'high_perf'
                ? 'bg-[var(--bg-card-active)] border-[var(--accent-primary)] shadow-md shadow-[var(--accent-primary)]/10'
                : 'bg-[var(--bg-card)] border-[var(--border-subtle)] hover:border-[var(--border-hover)]'
            }`}
          >
            <div className="font-bold text-xs text-[var(--text-primary)]">Ultra Low Latency</div>
            <div className="text-[11px] text-[var(--text-muted)] mt-0.5">Sub-80ms Groq & Cerebras</div>
          </button>

          <button
            onClick={() => handleSetupPreset('cost_saver')}
            disabled={savingPreset}
            className={`p-3.5 rounded-2xl border text-left transition-all ${
              activeSetupPreset === 'cost_saver'
                ? 'bg-[var(--bg-card-active)] border-[var(--accent-primary)] shadow-md shadow-[var(--accent-primary)]/10'
                : 'bg-[var(--bg-card)] border-[var(--border-subtle)] hover:border-[var(--border-hover)]'
            }`}
          >
            <div className="font-bold text-xs text-[var(--text-primary)]">Maximum Free Quota</div>
            <div className="text-[11px] text-[var(--text-muted)] mt-0.5">Distributes across all keys</div>
          </button>

          <button
            onClick={() => handleSetupPreset('reasoning')}
            disabled={savingPreset}
            className={`p-3.5 rounded-2xl border text-left transition-all ${
              activeSetupPreset === 'reasoning'
                ? 'bg-[var(--bg-card-active)] border-[var(--accent-primary)] shadow-md shadow-[var(--accent-primary)]/10'
                : 'bg-[var(--bg-card)] border-[var(--border-subtle)] hover:border-[var(--border-hover)]'
            }`}
          >
            <div className="font-bold text-xs text-[var(--text-primary)]">Deep Reasoning</div>
            <div className="text-[11px] text-[var(--text-muted)] mt-0.5">DeepSeek-R1 priority</div>
          </button>
        </div>
      </div>

      {/* Active Free Routing Team Cards Grid */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <label className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">Active Free Routing Team Models</label>
            <button
              onClick={handleSyncModels}
              disabled={isSyncing}
              className="px-3 py-1.5 rounded-lg bg-[var(--bg-well)] hover:bg-[var(--bg-card-active)] border border-[var(--border-subtle)] hover:border-[var(--border-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-[11px] font-semibold flex items-center gap-1.5 transition-all active:scale-95 disabled:opacity-50"
              title="Discover and sync models from all providers with active keys"
            >
              <RefreshCw className={`w-3 h-3 ${isSyncing ? 'animate-spin' : ''}`} />
              <span>{isSyncing ? 'Syncing…' : 'Sync Models'}</span>
            </button>
            {syncError && (
              <span className="text-[10px] font-mono text-red-400">{syncError}</span>
            )}
          </div>
          <span className="text-xs text-[var(--text-muted)]">{catalogModels.length} Active Catalog Models</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {catalogModels.length === 0 ? (
            <div className="col-span-full p-8 rounded-2xl bg-[var(--bg-card)] border border-[var(--border-subtle)] text-center text-xs text-[var(--text-secondary)]">
              No catalog models discovered yet. Connect a provider key in the Credential Vault and run model sync.
            </div>
          ) : (
          catalogModels.slice(0, 8).map((model) => (
            <div
              key={model.id || model.modelName}
              className="squircle-card p-4 bg-[var(--bg-card)] border border-[var(--border-subtle)] hover:border-[var(--border-hover)] hover:bg-[var(--bg-card-active)] transition-all space-y-3"
            >
              <div className="flex items-center justify-between">
                <span className="px-2 py-0.5 text-[10px] font-mono font-bold bg-[var(--accent-primary)]/10 text-[var(--accent-primary)] rounded-md border border-[var(--accent-primary)]/20 truncate max-w-[120px]">
                  {model.providerDisplayName}
                </span>
                <span className="text-[10px] font-mono text-[var(--signal-mint)]" dir="ltr">
                  {model.benchTtftMs ? `${model.benchTtftMs}ms TTFT` : 'Active'}
                </span>
              </div>
              <div>
                <h3 className="font-bold text-sm text-[var(--text-primary)] truncate">{model.displayName}</h3>
                <p className="text-[11px] text-[var(--text-muted)] font-mono truncate" dir="ltr">
                  {model.modelName}
                </p>
              </div>
              <div className="space-y-1 text-xs font-mono" dir="ltr">
                <div className="flex justify-between text-[11px]">
                  <span className="text-[var(--text-muted)]">Context Window:</span>
                  <span className="text-[var(--signal-mint)] font-bold">{formatContextWindow(model.contextWindow)}</span>
                </div>
                <div className="flex justify-between text-[11px]">
                  <span className="text-[var(--text-muted)]">Capabilities:</span>
                  <span className="text-[var(--text-primary)]">
                    {model.supportsVision ? 'Vision + Tools' : model.supportsTools ? 'Tools' : 'Text'}
                  </span>
                </div>
                <div className="flex justify-between text-[11px]">
                  <span className="text-[var(--text-muted)]">Cost / 1M:</span>
                  <span className="text-[var(--signal-mint)] font-bold">
                    {model.costInputPer1k === 0 ? '$0.00 FREE' : `$${(model.costInputPer1k * 1000).toFixed(2)}`}
                  </span>
                </div>
              </div>
            </div>
          ))
          )}
        </div>
      </div>

      {/* Live Traffic & Decision Stream */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-[var(--text-primary)] uppercase tracking-wider">Live Traffic & Routing Decision Stream</h2>
            <p className="text-xs text-[var(--text-muted)]">Click "Why? →" on any request log to inspect full decision evaluation steps.</p>
          </div>
          {streamStatus === 'live' && (
            <span className="text-xs font-mono text-[var(--signal-mint)] bg-[var(--signal-mint)]/10 px-2.5 py-1 rounded-full border border-[var(--signal-mint)]/20">
              Live
            </span>
          )}
          {streamStatus === 'connecting' && (
            <span className="text-xs font-mono text-amber-400 bg-amber-500/10 px-2.5 py-1 rounded-full border border-amber-500/20">
              Connecting
            </span>
          )}
          {streamStatus === 'unauthorized' && (
            <span className="text-xs font-mono text-red-400 bg-red-500/10 px-2.5 py-1 rounded-full border border-red-500/20">
              Unauthorized (Set Token in Settings)
            </span>
          )}
          {streamStatus === 'closed' && (
            <span className="text-xs font-mono text-red-400 bg-red-500/10 px-2.5 py-1 rounded-full border border-red-500/20">
              Closed
            </span>
          )}
        </div>

        <div className="rounded-[24px] bg-[var(--bg-card)] border border-[var(--border-subtle)] overflow-hidden shadow-xl">
          {traces.length === 0 ? (
            <div className="p-10 text-center space-y-2">
              <Activity className="w-6 h-6 text-[var(--text-muted)] mx-auto" />
              <p className="text-xs text-[var(--text-secondary)]">
                No live traffic routed yet. Send an HTTP request via the gateway or run a pool test to see real-time decision logs.
              </p>
            </div>
          ) : (
          <div className="divide-y divide-[var(--border-subtle)]">
            {traces.map((tr) => (
              <div key={tr.id} className="p-4 hover:bg-[var(--bg-card-active)] transition-colors flex flex-col md:flex-row md:items-center justify-between gap-4">
                
                <div className="space-y-1 flex-1">
                  <div className="flex items-center space-x-2.5">
                    {tr.isFallback ? (
                      <span className="w-2 h-2 rounded-full bg-[var(--signal-amber)] animate-pulse shrink-0" />
                    ) : (
                      <span className="w-2 h-2 rounded-full bg-[var(--signal-mint)] shrink-0" />
                    )}
                    <span className="text-[11px] font-mono text-[var(--text-muted)]" dir="ltr">{tr.timestamp}</span>
                    <span className="text-xs font-mono text-[var(--text-secondary)] font-bold" dir="ltr">{tr.selectedModel}</span>
                    {tr.isFallback ? (
                      <span className="text-[10px] font-mono font-bold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-md border border-amber-500/20">
                        ⚠ Fallback
                      </span>
                    ) : (
                      <span className="text-[10px] font-mono text-[var(--accent-primary)] bg-[var(--accent-primary)]/10 px-2 py-0.5 rounded-md">
                        {tr.routingPolicy}
                      </span>
                    )}
                  </div>

                  <p className="text-xs font-mono text-[var(--text-secondary)] truncate max-w-xl bg-[var(--bg-well)] p-2 rounded-lg border border-[var(--border-subtle)] mt-1" dir="ltr">
                    {tr.promptSnippet}
                  </p>
                </div>

                <div className="flex items-center space-x-4 shrink-0 font-mono text-xs" dir="ltr">
                  <div className="text-right">
                    <div className="text-[var(--text-primary)] font-bold">{tr.latencyMs}ms</div>
                    <div className="text-[10px] text-[var(--text-muted)]">{tr.tokens.total} tokens</div>
                  </div>

                  <button
                    onClick={() => onSelectTrace(tr)}
                    className="px-3.5 py-2 rounded-xl bg-[var(--accent-primary)]/10 hover:bg-[var(--accent-primary)] text-[var(--accent-primary)] hover:text-slate-950 font-semibold text-xs border border-[var(--accent-primary)]/30 flex items-center space-x-1 transition-all shadow-md active:scale-95"
                  >
                    <span>Why?</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>

              </div>
            ))}
          </div>
          )}
        </div>
      </div>

    </div>
  );
};

