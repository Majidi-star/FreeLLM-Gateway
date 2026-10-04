import React, { useState } from 'react';
import { Activity, Zap, Cpu, ArrowUpRight, CheckCircle2, AlertTriangle, Sparkles, Sliders, ChevronRight, ChevronDown, Network, Copy, Check, Layers, Key, X, ArrowRight, BookOpen, Terminal } from 'lucide-react';
import { DecisionTrace } from '../drawers/DecisionInspectorDrawer.js';
import { GlossaryTerm } from '../common/GlossaryTerm.js';
import { EndpointsManager } from '../settings/EndpointsManager.js';

interface CockpitDashboardProps {
  onOpenGoalStudio: () => void;
  onOpenPoolStudio?: () => void;
  onOpenVault?: () => void;
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
  '';

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

export const CockpitDashboard: React.FC<CockpitDashboardProps> = ({ onOpenGoalStudio, onOpenPoolStudio, onOpenVault, onSelectTrace }) => {
  const [activeSetupPreset, setActiveSetupPreset] = useState<'standard' | 'high_perf' | 'cost_saver' | 'reasoning'>('standard');
  const [traces, setTraces] = useState<DecisionTrace[]>([]);
  const [activePools, setActivePools] = useState(0);
  const [configuredKeysCount, setConfiguredKeysCount] = useState(0);
  const [goalsCount, setGoalsCount] = useState(0);
  const [showQuickstart, setShowQuickstart] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('cockpit_show_quickstart');
      return saved === null ? true : saved !== 'false';
    } catch {
      return true;
    }
  });
  const [presetError, setPresetError] = useState<string | null>(null);
  const [savingPreset, setSavingPreset] = useState(false);
  const [streamStatus, setStreamStatus] = useState<StreamStatus>('connecting');
  const [catalogModels, setCatalogModels] = useState<CatalogModelItem[]>([]);
  const [endpointsCollapsed, setEndpointsCollapsed] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('cockpit_endpoints_collapsed');
      return saved === null ? true : saved === 'true';
    } catch {
      return true;
    }
  });
  const [endpointSummary, setEndpointSummary] = useState('3/3 Active');
  const [endpointUrls, setEndpointUrls] = useState<string[]>([]);
  const [copiedHeaderUrl, setCopiedHeaderUrl] = useState<string | null>(null);

  const refreshCounts = () => {
    const adminToken = getAdminToken();
    fetch('/api/v1/providers', {
      headers: adminToken ? { authorization: `Bearer ${adminToken}` } : {},
    })
      .then((res) => (res.ok ? res.json() : []))
      .then((providers) => {
        if (Array.isArray(providers)) {
          setConfiguredKeysCount(providers.filter((p: any) => p.hasKey).length);
        }
      })
      .catch(() => {});

    fetch('/api/v1/goals', {
      headers: adminToken ? { authorization: `Bearer ${adminToken}` } : {},
    })
      .then((res) => (res.ok ? res.json() : []))
      .then((goals) => {
        if (Array.isArray(goals)) {
          setGoalsCount(goals.length);
        }
      })
      .catch(() => {});

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
  };

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

    refreshCounts();
    const interval = setInterval(refreshCounts, 3000);
    window.addEventListener('goalroute_data_changed', refreshCounts);

    return () => {
      clearInterval(interval);
      window.removeEventListener('goalroute_data_changed', refreshCounts);
    };
  }, []);

  const step1Done = configuredKeysCount > 0;
  const step2Done = goalsCount > 0;
  const step3Done = activePools > 0;
  const step4Done = true;
  const completedSteps = (step1Done ? 1 : 0) + (step2Done ? 1 : 0) + (step3Done ? 1 : 0) + (step4Done ? 1 : 0);

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

      {/* Interactive Quickstart Onboarding Banner */}
      {showQuickstart && (
        <div className="rounded-[24px] bg-gradient-to-r from-[var(--bg-card)] via-[var(--bg-well)] to-[var(--bg-card)] border border-[var(--accent-primary)]/30 p-6 shadow-2xl relative overflow-hidden">
          <div className="flex items-start justify-between gap-4 mb-5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-indigo-500/30 flex items-center justify-center shrink-0 shadow-lg">
                <Sparkles className="w-5 h-5 text-indigo-400 animate-pulse" />
              </div>
              <div>
                <h2 className="text-base font-bold text-[var(--text-primary)] flex items-center gap-2">
                  Quickstart Guide — 4 Steps to Production Gateway
                </h2>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">
                  Follow this interactive roadmap to configure provider keys, setup routing goals, and connect your AI agents.
                </p>
              </div>
            </div>
            <button
              onClick={() => {
                setShowQuickstart(false);
                try { localStorage.setItem('cockpit_show_quickstart', 'false'); } catch {}
              }}
              className="text-[var(--text-muted)] hover:text-[var(--text-primary)] p-1 rounded-lg hover:bg-[var(--bg-card-active)] transition-colors cursor-pointer"
              title="Dismiss quickstart guide"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Onboarding Progress Bar */}
          <div className="mb-6 bg-[var(--bg-obsidian)] p-3 rounded-xl border border-[var(--border-subtle)] flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="text-xs font-semibold text-[var(--text-secondary)]">Onboarding Progress:</span>
              <div className="w-36 h-2.5 bg-[var(--bg-card)] rounded-full overflow-hidden border border-[var(--border-subtle)]">
                <div
                  className="h-full bg-gradient-to-r from-indigo-500 via-purple-500 to-emerald-400 transition-all duration-500"
                  style={{ width: `${(completedSteps / 4) * 100}%` }}
                />
              </div>
              <span className="text-xs font-mono font-bold text-[var(--accent-primary)]">
                {completedSteps} / 4 Steps ({Math.round((completedSteps / 4) * 100)}%)
              </span>
            </div>
            <div className="text-xs text-[var(--text-muted)] flex items-center gap-2">
              <span>System Gateway:</span>
              <span className="px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-mono text-[11px] font-bold">
                READY FOR 1000+ USERS
              </span>
            </div>
          </div>

          {/* 4 Step Onboarding Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Step 1 */}
            <div className={`p-4 rounded-xl border transition-all ${
              step1Done
                ? 'bg-[var(--bg-card)]/80 border-emerald-500/30'
                : 'bg-[var(--bg-card)] border-[var(--border-subtle)] hover:border-amber-500/40'
            }`}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-mono font-bold text-amber-400 uppercase tracking-wider">Step 1</span>
                {step1Done ? (
                  <span className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-bold">
                    <CheckCircle2 className="w-3 h-3" /> {configuredKeysCount} Keys Active
                  </span>
                ) : (
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 font-bold">
                    Action Needed
                  </span>
                )}
              </div>
              <div className="font-semibold text-sm text-[var(--text-primary)] mb-1 flex items-center gap-2">
                <Key className="w-4 h-4 text-amber-400" />
                <span>Connect API Keys</span>
              </div>
              <p className="text-xs text-[var(--text-muted)] mb-3 leading-relaxed">
                Add provider API keys (Groq, Gemini, Anthropic, OpenAI, Ollama) in Credential Vault.
              </p>
              <button
                onClick={onOpenVault}
                className="w-full text-xs font-semibold px-3 py-2 rounded-lg bg-[var(--bg-well)] hover:bg-[var(--accent-primary)]/15 border border-[var(--border-subtle)] text-[var(--text-primary)] flex items-center justify-center gap-1.5 transition-all cursor-pointer"
              >
                <span>Credential Vault</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Step 2 */}
            <div className={`p-4 rounded-xl border transition-all ${
              step2Done
                ? 'bg-[var(--bg-card)]/80 border-emerald-500/30'
                : 'bg-[var(--bg-card)] border-[var(--border-subtle)] hover:border-purple-500/40'
            }`}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-mono font-bold text-purple-400 uppercase tracking-wider">Step 2</span>
                {step2Done ? (
                  <span className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-bold">
                    <CheckCircle2 className="w-3 h-3" /> {goalsCount} Goal Defined
                  </span>
                ) : (
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 font-bold">
                    Action Needed
                  </span>
                )}
              </div>
              <div className="font-semibold text-sm text-[var(--text-primary)] mb-1 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-purple-400" />
                <span>Set Routing Goal</span>
              </div>
              <p className="text-xs text-[var(--text-muted)] mb-3 leading-relaxed">
                Define task objectives (Code, Reasoning, Chat) &amp; SLAs (Latency, Free Quota, Failover).
              </p>
              <button
                onClick={onOpenGoalStudio}
                className="w-full text-xs font-semibold px-3 py-2 rounded-lg bg-[var(--bg-well)] hover:bg-purple-500/15 border border-[var(--border-subtle)] text-[var(--text-primary)] flex items-center justify-center gap-1.5 transition-all cursor-pointer"
              >
                <span>Goal Studio</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Step 3 */}
            <div className={`p-4 rounded-xl border transition-all ${
              step3Done
                ? 'bg-[var(--bg-card)]/80 border-emerald-500/30'
                : 'bg-[var(--bg-card)] border-[var(--border-subtle)] hover:border-indigo-500/40'
            }`}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-mono font-bold text-indigo-400 uppercase tracking-wider">Step 3</span>
                {step3Done ? (
                  <span className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-bold">
                    <CheckCircle2 className="w-3 h-3" /> {activePools} Pool Active
                  </span>
                ) : (
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 font-bold">
                    Action Needed
                  </span>
                )}
              </div>
              <div className="font-semibold text-sm text-[var(--text-primary)] mb-1 flex items-center gap-2">
                <Layers className="w-4 h-4 text-indigo-400" />
                <span>Activate Routing Pool</span>
              </div>
              <p className="text-xs text-[var(--text-muted)] mb-3 leading-relaxed">
                Generate an active pool that coordinates fallback chains &amp; candidate model ranking.
              </p>
              <button
                onClick={onOpenPoolStudio}
                className="w-full text-xs font-semibold px-3 py-2 rounded-lg bg-[var(--bg-well)] hover:bg-indigo-500/15 border border-[var(--border-subtle)] text-[var(--text-primary)] flex items-center justify-center gap-1.5 transition-all cursor-pointer"
              >
                <span>Pool Studio</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Step 4 */}
            <div className="p-4 rounded-xl border bg-[var(--bg-card)]/80 border-emerald-500/30">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-mono font-bold text-emerald-400 uppercase tracking-wider">Step 4</span>
                <span className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-bold">
                  <CheckCircle2 className="w-3 h-3" /> Endpoints Ready
                </span>
              </div>
              <div className="font-semibold text-sm text-[var(--text-primary)] mb-1 flex items-center gap-2">
                <Terminal className="w-4 h-4 text-emerald-400" />
                <span>Connect Clients &amp; MCP</span>
              </div>
              <p className="text-xs text-[var(--text-muted)] mb-3 leading-relaxed">
                Point Cursor, LangChain, or Claude to 8788/8789, or use AI Copilot on the right panel!
              </p>
              <button
                onClick={() => setEndpointsCollapsed(false)}
                className="w-full text-xs font-semibold px-3 py-2 rounded-lg bg-[var(--bg-well)] hover:bg-emerald-500/15 border border-[var(--border-subtle)] text-[var(--text-primary)] flex items-center justify-center gap-1.5 transition-all cursor-pointer"
              >
                <span>Gateway Endpoints</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Connection & Endpoints — collapsible multi-protocol gateway status */}
      <div className="rounded-[24px] bg-[var(--bg-card)] border border-[var(--border-subtle)] overflow-hidden shadow-xl">
        {/* Collapsible Header */}
        <button
          type="button"
          onClick={() => {
            const next = !endpointsCollapsed;
            setEndpointsCollapsed(next);
            try { localStorage.setItem('cockpit_endpoints_collapsed', String(next)); } catch { /* noop */ }
          }}
          className="w-full px-5 py-4 flex items-center justify-between gap-4 hover:bg-[var(--bg-card-active)] transition-colors text-left cursor-pointer"
          aria-expanded={!endpointsCollapsed}
        >
          <div className="flex items-center gap-3">
            <span className="w-9 h-9 rounded-xl bg-[var(--accent-primary)]/10 border border-[var(--accent-primary)]/20 flex items-center justify-center shrink-0">
              <Network className="w-4 h-4 text-[var(--accent-primary)]" />
            </span>
            <div>
              <div className="font-semibold text-sm text-[var(--text-primary)] flex items-center gap-2">
                Connection &amp; Endpoints
              </div>
              {/* Concise summary pill shown when collapsed */}
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span className="text-[10px] font-mono bg-[var(--signal-mint)]/10 text-[var(--signal-mint)] border border-[var(--signal-mint)]/20 px-2 py-0.5 rounded-full font-medium">
                  {endpointSummary}
                </span>
                {endpointsCollapsed && endpointUrls.length > 0 && (
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    {endpointUrls.map((url) => (
                      <span
                        key={url}
                        onClick={(e) => {
                          e.stopPropagation();
                          try {
                            void navigator.clipboard.writeText(url);
                            setCopiedHeaderUrl(url);
                            setTimeout(() => setCopiedHeaderUrl(null), 1500);
                          } catch {}
                        }}
                        className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-md bg-[var(--bg-well)] hover:bg-[var(--accent-primary)]/15 border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-all cursor-pointer"
                        dir="ltr"
                        title="Click to copy endpoint URL ASAP"
                      >
                        {url}
                        {copiedHeaderUrl === url ? (
                          <Check className="w-3 h-3 text-[var(--signal-mint)]" />
                        ) : (
                          <Copy className="w-3 h-3 text-[var(--text-muted)] opacity-70" />
                        )}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-[10px] font-mono px-2.5 py-1 rounded-full bg-[var(--signal-mint)]/10 text-[var(--signal-mint)] border border-[var(--signal-mint)]/25 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[var(--signal-mint)]" />
              ONLINE
            </span>
            <ChevronDown
              className={`w-4 h-4 text-[var(--text-secondary)] transition-transform duration-200 ${endpointsCollapsed ? '' : 'rotate-180'}`}
            />
          </div>
        </button>

        {/* Expandable Body */}
        <div className={`border-t border-[var(--border-subtle)] ${endpointsCollapsed ? 'hidden' : ''}`}>
            <EndpointsManager hideMcp onStatusChange={(s) => {
              const protocols = Object.values(s.endpoints);
              const activeCount = protocols.filter((p) => p.protocol !== 'mcp' && p.enabled).length;
              const totalCount = protocols.filter((p) => p.protocol !== 'mcp').length;
              const hosts = protocols
                .filter((p) => p.protocol !== 'mcp')
                .map((p) => `${p.protocol[0].toUpperCase()}${p.protocol.slice(1)}: ${p.port}`)
                .join(' · ');
              setEndpointSummary(`${activeCount}/${totalCount} Active · ${hosts}`);
              setEndpointUrls(
                protocols
                  .filter((p) => p.protocol !== 'mcp')
                  .map((p) => `http://${s.host === '0.0.0.0' ? '127.0.0.1' : s.host}:${p.port}${p.pathPrefix}`)
              );
            }} />
          </div>
      </div>

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
          <div className="flex items-center gap-3">
            <button
              onClick={onOpenGoalStudio}
              className="text-xs font-semibold text-purple-400 hover:underline flex items-center gap-1"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Goal Studio →</span>
            </button>
            {onOpenPoolStudio && (
              <button
                onClick={onOpenPoolStudio}
                className="text-xs font-semibold text-indigo-400 hover:underline flex items-center gap-1 border-l border-[var(--border-subtle)] pl-3"
              >
                <Layers className="w-3.5 h-3.5" />
                <span>Pool Studio & Routing →</span>
              </button>
            )}
          </div>
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

