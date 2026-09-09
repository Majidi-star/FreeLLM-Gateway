import React, { useState } from 'react';
import { Activity, Zap, Cpu, ArrowUpRight, CheckCircle2, AlertTriangle, Sparkles, Sliders, RefreshCw, ChevronRight } from 'lucide-react';
import { DecisionTrace } from '../drawers/DecisionInspectorDrawer.js';
import { GlossaryTerm } from '../common/GlossaryTerm.js';

interface CockpitDashboardProps {
  onOpenGoalStudio: () => void;
  onSelectTrace: (trace: DecisionTrace) => void;
}

const SAMPLE_TRACES: DecisionTrace[] = [
  {
    id: 'tr-94a20f18',
    timestamp: '14:28:42.102',
    promptSnippet: 'def generate_set_cover_algorithm(candidates, constraints): ...',
    selectedModel: 'DeepSeek-R1',
    selectedProvider: 'OpenRouter',
    latencyMs: 42,
    tokens: { prompt: 142, completion: 380, total: 522 },
    routingPolicy: 'Greedy Set-Cover',
    heuristicScore: 98,
    verdict: 'Selected DeepSeek-R1 via OpenRouter due to 42ms TTFT advantage over Gemini Flash while satisfying 98% reasoning accuracy constraint.',
    candidates: [
      { name: 'DeepSeek-R1', provider: 'OpenRouter', latencyMs: 42, score: 98, status: 'selected' },
      { name: 'Qwen 2.5 Coder 32B', provider: 'HuggingFace', latencyMs: 88, score: 86, status: 'evaluated', reason: 'Higher latency than DeepSeek-R1' },
      { name: 'Gemini 2.5 Flash', provider: 'Google AI', latencyMs: 110, score: 82, status: 'evaluated', reason: 'Lower math reasoning score' },
      { name: 'Llama 3.3 70B', provider: 'Groq', latencyMs: 195, score: 78, status: 'filtered', reason: 'Exceeded 150ms target threshold' },
    ],
    factors: { latency: 95, cost: 100, capability: 98, health: 100 },
  },
  {
    id: 'tr-88c11b02',
    timestamp: '14:28:38.991',
    promptSnippet: 'Explain quantum entanglement spin conservation principles...',
    selectedModel: 'Gemini 2.5 Flash',
    selectedProvider: 'Google AI Studio',
    latencyMs: 85,
    tokens: { prompt: 98, completion: 210, total: 308 },
    routingPolicy: 'Balanced Pareto',
    heuristicScore: 92,
    verdict: 'Selected Gemini 2.5 Flash for optimal throughput and zero latency jitter under high concurrent load.',
    candidates: [
      { name: 'Gemini 2.5 Flash', provider: 'Google AI', latencyMs: 85, score: 92, status: 'selected' },
      { name: 'DeepSeek-R1', provider: 'OpenRouter', latencyMs: 140, score: 89, status: 'evaluated', reason: 'Slightly higher TTFT' },
      { name: 'Llama 3.3 70B', provider: 'Cerebras', latencyMs: 62, score: 84, status: 'evaluated', reason: 'Lower scientific context score' },
    ],
    factors: { latency: 88, cost: 100, capability: 92, health: 98 },
  },
  {
    id: 'tr-71e99d44',
    timestamp: '14:28:31.450',
    promptSnippet: 'Write unit tests for Fastify JWT auth middleware...',
    selectedModel: 'Qwen 2.5 Coder 32B',
    selectedProvider: 'HuggingFace Hub',
    latencyMs: 64,
    tokens: { prompt: 215, completion: 490, total: 705 },
    routingPolicy: 'High-Speed Code',
    heuristicScore: 96,
    verdict: 'Selected Qwen 2.5 Coder 32B via HuggingFace for 100% code syntax compliance and sub-70ms response.',
    candidates: [
      { name: 'Qwen 2.5 Coder 32B', provider: 'HuggingFace', latencyMs: 64, score: 96, status: 'selected' },
      { name: 'Llama 3.3 70B', provider: 'Groq', latencyMs: 58, score: 91, status: 'evaluated', reason: 'Slightly lower code pass-rate' },
    ],
    factors: { latency: 96, cost: 100, capability: 95, health: 100 },
  },
];

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
    id: evt.traceId || evt.id || `tr-${Math.random().toString(36).substring(2, 9)}`,
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
  '';

export const CockpitDashboard: React.FC<CockpitDashboardProps> = ({ onOpenGoalStudio, onSelectTrace }) => {
  const [activeSetupPreset, setActiveSetupPreset] = useState<'standard' | 'high_perf' | 'cost_saver' | 'reasoning'>('standard');
  const [traces, setTraces] = useState<DecisionTrace[]>(SAMPLE_TRACES);
  const [streamStatus, setStreamStatus] = useState<StreamStatus>('connecting');

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
            <div className="font-bold text-sm text-white flex items-center gap-2">
              GoalRoute Self-Healing Routing Engine
              <span className="text-[10px] font-mono bg-[var(--signal-mint)]/10 text-[var(--signal-mint)] border border-[var(--signal-mint)]/20 px-2 py-0.5 rounded-full">
                ONLINE
              </span>
            </div>
            <div className="text-xs text-[var(--text-muted)] mt-0.5">
              6/6 Free Enclave Provider Connections Active
            </div>
          </div>
        </div>

        {/* Live Metrics Ribbon */}
        <div className="flex items-center space-x-6 text-xs font-mono" dir="ltr">
          <div className="text-right">
            <div className="text-[var(--text-muted)] text-[10px] uppercase">Throughput</div>
            <div className="font-bold text-white text-sm">14,280 <span className="text-[10px] text-slate-400">req/m</span></div>
          </div>

          <div className="h-8 w-px bg-[var(--border-subtle)]" />

          <div className="text-right">
            <div className="text-[var(--text-muted)] text-[10px] uppercase">Avg Latency</div>
            <div className="font-bold text-[var(--signal-mint)] text-sm">142 ms</div>
          </div>

          <div className="h-8 w-px bg-[var(--border-subtle)]" />

          <div className="text-right">
            <div className="text-[var(--text-muted)] text-[10px] uppercase">Success Rate</div>
            <div className="font-bold text-white text-sm">99.8%</div>
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
          <button
            onClick={() => setActiveSetupPreset('standard')}
            className={`p-3.5 rounded-2xl border text-left transition-all ${
              activeSetupPreset === 'standard'
                ? 'bg-[var(--bg-card-active)] border-[var(--accent-primary)] shadow-md shadow-[var(--accent-primary)]/10'
                : 'bg-[var(--bg-card)] border-[var(--border-subtle)] hover:border-[var(--border-hover)]'
            }`}
          >
            <div className="font-bold text-xs text-white">Standard Balanced</div>
            <div className="text-[11px] text-[var(--text-muted)] mt-0.5">Equal speed & accuracy</div>
          </button>

          <button
            onClick={() => setActiveSetupPreset('high_perf')}
            className={`p-3.5 rounded-2xl border text-left transition-all ${
              activeSetupPreset === 'high_perf'
                ? 'bg-[var(--bg-card-active)] border-[var(--accent-primary)] shadow-md shadow-[var(--accent-primary)]/10'
                : 'bg-[var(--bg-card)] border-[var(--border-subtle)] hover:border-[var(--border-hover)]'
            }`}
          >
            <div className="font-bold text-xs text-white">Ultra Low Latency</div>
            <div className="text-[11px] text-[var(--text-muted)] mt-0.5">Sub-80ms Groq & Cerebras</div>
          </button>

          <button
            onClick={() => setActiveSetupPreset('cost_saver')}
            className={`p-3.5 rounded-2xl border text-left transition-all ${
              activeSetupPreset === 'cost_saver'
                ? 'bg-[var(--bg-card-active)] border-[var(--accent-primary)] shadow-md shadow-[var(--accent-primary)]/10'
                : 'bg-[var(--bg-card)] border-[var(--border-subtle)] hover:border-[var(--border-hover)]'
            }`}
          >
            <div className="font-bold text-xs text-white">Maximum Free Quota</div>
            <div className="text-[11px] text-[var(--text-muted)] mt-0.5">Distributes across all 6 keys</div>
          </button>

          <button
            onClick={() => setActiveSetupPreset('reasoning')}
            className={`p-3.5 rounded-2xl border text-left transition-all ${
              activeSetupPreset === 'reasoning'
                ? 'bg-[var(--bg-card-active)] border-[var(--accent-primary)] shadow-md shadow-[var(--accent-primary)]/10'
                : 'bg-[var(--bg-card)] border-[var(--border-subtle)] hover:border-[var(--border-hover)]'
            }`}
          >
            <div className="font-bold text-xs text-white">Deep Reasoning</div>
            <div className="text-[11px] text-[var(--text-muted)] mt-0.5">DeepSeek-R1 priority</div>
          </button>
        </div>
      </div>

      {/* Active Free Routing Team Cards Grid */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">Active Free Routing Team Models</label>
          <span className="text-xs text-[var(--text-muted)]">4 High-Priority Free Tier Models Active</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          
          {/* Model Card 1 */}
          <div className="squircle-card p-4 bg-[var(--bg-card)] border border-[var(--border-subtle)] hover:border-[var(--border-hover)] hover:bg-[var(--bg-card-active)] transition-all space-y-3">
            <div className="flex items-center justify-between">
              <span className="px-2 py-0.5 text-[10px] font-mono font-bold bg-[var(--accent-primary)]/10 text-[var(--accent-primary)] rounded-md border border-[var(--accent-primary)]/20">
                Reasoning Leader
              </span>
              <span className="text-[10px] font-mono text-[var(--signal-mint)]" dir="ltr">42ms TTFT</span>
            </div>
            <div>
              <h3 className="font-bold text-sm text-white">DeepSeek-R1</h3>
              <p className="text-[11px] text-[var(--text-muted)] font-mono" dir="ltr">OpenRouter Free Tier</p>
            </div>
            <div className="space-y-1 text-xs font-mono" dir="ltr">
              <div className="flex justify-between text-[11px]">
                <span className="text-[var(--text-muted)]">Reliability:</span>
                <span className="text-[var(--signal-mint)] font-bold">99.9%</span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span className="text-[var(--text-muted)]">Daily Quota:</span>
                <span className="text-white">65% left</span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span className="text-[var(--text-muted)]">Cost / 1M:</span>
                <span className="text-[var(--signal-mint)] font-bold">$0.00 FREE</span>
              </div>
            </div>
          </div>

          {/* Model Card 2 */}
          <div className="squircle-card p-4 bg-[var(--bg-card)] border border-[var(--border-subtle)] hover:border-[var(--border-hover)] hover:bg-[var(--bg-card-active)] transition-all space-y-3">
            <div className="flex items-center justify-between">
              <span className="px-2 py-0.5 text-[10px] font-mono font-bold bg-[var(--signal-mint)]/10 text-[var(--signal-mint)] rounded-md border border-[var(--signal-mint)]/20">
                Multimodal Fast
              </span>
              <span className="text-[10px] font-mono text-[var(--signal-mint)]" dir="ltr">85ms TTFT</span>
            </div>
            <div>
              <h3 className="font-bold text-sm text-white">Gemini 2.5 Flash</h3>
              <p className="text-[11px] text-[var(--text-muted)] font-mono" dir="ltr">Google AI Studio</p>
            </div>
            <div className="space-y-1 text-xs font-mono" dir="ltr">
              <div className="flex justify-between text-[11px]">
                <span className="text-[var(--text-muted)]">Reliability:</span>
                <span className="text-[var(--signal-mint)] font-bold">100%</span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span className="text-[var(--text-muted)]">Daily Quota:</span>
                <span className="text-white">40% left</span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span className="text-[var(--text-muted)]">Cost / 1M:</span>
                <span className="text-[var(--signal-mint)] font-bold">$0.00 FREE</span>
              </div>
            </div>
          </div>

          {/* Model Card 3 */}
          <div className="squircle-card p-4 bg-[var(--bg-card)] border border-[var(--border-subtle)] hover:border-[var(--border-hover)] hover:bg-[var(--bg-card-active)] transition-all space-y-3">
            <div className="flex items-center justify-between">
              <span className="px-2 py-0.5 text-[10px] font-mono font-bold bg-amber-500/10 text-amber-400 rounded-md border border-amber-500/20">
                Code Specialist
              </span>
              <span className="text-[10px] font-mono text-[var(--signal-mint)]" dir="ltr">64ms TTFT</span>
            </div>
            <div>
              <h3 className="font-bold text-sm text-white">Qwen 2.5 Coder 32B</h3>
              <p className="text-[11px] text-[var(--text-muted)] font-mono" dir="ltr">HuggingFace Hub</p>
            </div>
            <div className="space-y-1 text-xs font-mono" dir="ltr">
              <div className="flex justify-between text-[11px]">
                <span className="text-[var(--text-muted)]">Reliability:</span>
                <span className="text-[var(--signal-mint)] font-bold">99.7%</span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span className="text-[var(--text-muted)]">Daily Quota:</span>
                <span className="text-white">88% left</span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span className="text-[var(--text-muted)]">Cost / 1M:</span>
                <span className="text-[var(--signal-mint)] font-bold">$0.00 FREE</span>
              </div>
            </div>
          </div>

          {/* Model Card 4 */}
          <div className="squircle-card p-4 bg-[var(--bg-card)] border border-[var(--border-subtle)] hover:border-[var(--border-hover)] hover:bg-[var(--bg-card-active)] transition-all space-y-3">
            <div className="flex items-center justify-between">
              <span className="px-2 py-0.5 text-[10px] font-mono font-bold bg-purple-500/10 text-purple-400 rounded-md border border-purple-500/20">
                Llama Power
              </span>
              <span className="text-[10px] font-mono text-[var(--signal-mint)]" dir="ltr">48ms TTFT</span>
            </div>
            <div>
              <h3 className="font-bold text-sm text-white">Llama 3.3 70B</h3>
              <p className="text-[11px] text-[var(--text-muted)] font-mono" dir="ltr">Groq / Cerebras</p>
            </div>
            <div className="space-y-1 text-xs font-mono" dir="ltr">
              <div className="flex justify-between text-[11px]">
                <span className="text-[var(--text-muted)]">Reliability:</span>
                <span className="text-[var(--signal-mint)] font-bold">100%</span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span className="text-[var(--text-muted)]">Daily Quota:</span>
                <span className="text-white">82% left</span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span className="text-[var(--text-muted)]">Cost / 1M:</span>
                <span className="text-[var(--signal-mint)] font-bold">$0.00 FREE</span>
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* Live Traffic & Decision Stream */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-white uppercase tracking-wider">Live Traffic & Routing Decision Stream</h2>
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
                    <span className="text-xs font-mono text-slate-300 font-bold" dir="ltr">{tr.selectedModel}</span>
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

                  <p className="text-xs font-mono text-slate-300 truncate max-w-xl bg-[var(--bg-well)] p-2 rounded-lg border border-[var(--border-subtle)] mt-1" dir="ltr">
                    {tr.promptSnippet}
                  </p>
                </div>

                <div className="flex items-center space-x-4 shrink-0 font-mono text-xs" dir="ltr">
                  <div className="text-right">
                    <div className="text-slate-200 font-bold">{tr.latencyMs}ms</div>
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
        </div>
      </div>

    </div>
  );
};
