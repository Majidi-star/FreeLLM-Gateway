import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Sparkles,
  Zap,
  Code,
  MessageSquare,
  ShieldCheck,
  Check,
  SlidersHorizontal,
  Layers,
  TrendingUp,
  AlertTriangle,
  DollarSign,
  Activity,
  Cpu,
  ChevronDown,
  ChevronUp,
  RefreshCw,
} from 'lucide-react';
import { GlossaryTerm } from '../common/GlossaryTerm.js';

interface GoalStudioModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApplyGoal?: (goal: { intent: string; maxLatency: number; targetQuality: number; minAvailability: number }) => void;
}

export type TaskType = 'coding_agent' | 'chatbot' | 'batch' | 'research' | 'general';
export type LatencyPreference = 'instant' | 'relaxed';
export type BudgetPreference = 'free' | 'capped' | 'unlimited';
export type ExhaustionPreference = 'fill_first' | 'preserve_backup';
export type ReliabilityPreference = 'standard' | 'maximum';

export interface PoolPlanStep {
  candidate: {
    connectionId: string;
    providerSlug: string;
    providerDisplayName: string;
    modelId: string;
    modelDisplayName: string;
    tier: 'free' | 'paid' | 'subscription';
    dailyTokenCapacity: number;
    dailyRequestCapacity: number;
    costPer1kTokensUsd: number;
    benchTtftMs: number;
    taskFitness: number;
  };
  role: 'primary' | 'backup' | 'overflow';
  orderIndex: number;
  weight: number;
  reason: string;
}

export interface GapSuggestion {
  candidate: {
    connectionId: string;
    providerDisplayName: string;
    modelDisplayName: string;
    costPer1kTokensUsd: number;
  };
  neededTokens: number;
  neededRequests: number;
  estimatedMonthlyCostUsd: number;
  reason: string;
}

export interface PoolPlan {
  steps: PoolPlanStep[];
  policy: string;
  projectedDailyTokenCapacity: number;
  projectedDailyRequestCapacity: number;
  confidenceScore: number;
  feasible: boolean;
  estimatedMonthlyCostUsd: number;
  gapSuggestion?: GapSuggestion;
  decisionTrace: string[];
  warnings: string[];
}

const getAdminToken = () =>
  sessionStorage.getItem('goalroute_admin_token') ||
  localStorage.getItem('goalroute_admin_token') ||
  (import.meta as any).env?.VITE_ADMIN_API_TOKEN ||
  'dev-admin-secret-token';

export const GoalStudioModal: React.FC<GoalStudioModalProps> = ({ isOpen, onClose, onApplyGoal }) => {
  // Preset Intent
  const [selectedIntent, setSelectedIntent] = useState<'coding' | 'chat' | 'reasoning' | 'custom'>('coding');

  // 1. Task Type
  const [taskType, setTaskType] = useState<TaskType>('coding_agent');

  // 2. Budget Preference
  const [budgetPref, setBudgetPref] = useState<BudgetPreference>('free');
  const [budgetCapUsdMonthly, setBudgetCapUsdMonthly] = useState<number>(50);

  // 3. Demand Volume Targets
  const [targetTokensPerDay, setTargetTokensPerDay] = useState<number>(1000000);
  const [targetRequestsPerDay, setTargetRequestsPerDay] = useState<number>(1000);

  // 4. Safety Margin Headroom
  const [safetyMarginPct, setSafetyMarginPct] = useState<number>(20);

  // 5. Exhaustion Preference
  const [exhaustionPref, setExhaustionPref] = useState<ExhaustionPreference>('preserve_backup');

  // 6. Reliability Preference
  const [reliabilityPref, setReliabilityPref] = useState<ReliabilityPreference>('standard');

  // Latency & Quality Sliders
  const [latencyPref, setLatencyPref] = useState<LatencyPreference>('instant');
  const [maxLatency, setMaxLatency] = useState(200);
  const [targetQuality, setTargetQuality] = useState(98);
  const [minAvailability, setMinAvailability] = useState(99.9);

  // Live Solver Receipt State
  const [solvePlan, setSolvePlan] = useState<PoolPlan | null>(null);
  const [isSolving, setIsSolving] = useState(false);
  const [showTrace, setShowTrace] = useState(false);

  // Saving State
  const [applied, setApplied] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const solveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (solveDebounceRef.current) clearTimeout(solveDebounceRef.current);
    };
  }, []);

  // Fetch live solver preview
  const fetchLiveSolvePreview = async () => {
    setIsSolving(true);
    try {
      const res = await fetch('/api/v1/goals/preview-solve', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(getAdminToken() ? { authorization: `Bearer ${getAdminToken()}` } : {}),
        },
        body: JSON.stringify({
          taskType,
          targetRequestsPerDay,
          targetTokensPerDay,
          latencyPref,
          budgetPref,
          budgetCapUsdMonthly: budgetPref === 'capped' ? budgetCapUsdMonthly : undefined,
          exhaustionPref,
          reliabilityPref,
          safetyMarginPct,
        }),
      });

      if (res.ok) {
        const plan: PoolPlan = await res.json();
        setSolvePlan(plan);
      }
    } catch {
      // Fall back silently
    } finally {
      setIsSolving(false);
    }
  };

  // Trigger live solver update on constraint changes
  useEffect(() => {
    if (!isOpen) return;
    if (solveDebounceRef.current) clearTimeout(solveDebounceRef.current);

    solveDebounceRef.current = setTimeout(() => {
      fetchLiveSolvePreview();
    }, 200);
  }, [
    isOpen,
    taskType,
    budgetPref,
    budgetCapUsdMonthly,
    targetTokensPerDay,
    targetRequestsPerDay,
    safetyMarginPct,
    exhaustionPref,
    reliabilityPref,
    latencyPref,
  ]);

  const handleIntentSelect = (intent: 'coding' | 'chat' | 'reasoning' | 'custom') => {
    setSelectedIntent(intent);
    if (intent === 'coding') {
      setTaskType('coding_agent');
      setLatencyPref('instant');
      setReliabilityPref('standard');
      setExhaustionPref('fill_first');
      setBudgetPref('free');
      setMaxLatency(200);
      setTargetQuality(98);
      setMinAvailability(99.9);
      setTargetTokensPerDay(2000000);
      setTargetRequestsPerDay(1500);
      setSafetyMarginPct(20);
    } else if (intent === 'chat') {
      setTaskType('chatbot');
      setLatencyPref('instant');
      setReliabilityPref('standard');
      setExhaustionPref('preserve_backup');
      setBudgetPref('free');
      setMaxLatency(120);
      setTargetQuality(90);
      setMinAvailability(99.0);
      setTargetTokensPerDay(1000000);
      setTargetRequestsPerDay(3000);
      setSafetyMarginPct(20);
    } else if (intent === 'reasoning') {
      setTaskType('research');
      setLatencyPref('relaxed');
      setReliabilityPref('maximum');
      setExhaustionPref('preserve_backup');
      setBudgetPref('free');
      setMaxLatency(400);
      setTargetQuality(99);
      setMinAvailability(99.5);
      setTargetTokensPerDay(3000000);
      setTargetRequestsPerDay(1000);
      setSafetyMarginPct(30);
    } else if (intent === 'custom') {
      setTaskType('general');
    }
  };

  const handleSave = async () => {
    setSaveError(null);
    setIsSaving(true);
    try {
      const intentLabels: Record<string, string> = {
        coding: 'High-Speed Code',
        chat: 'Sub-100ms Chat',
        reasoning: 'Math & Reasoning',
        custom: 'Custom Constraint Optimization',
      };

      const res = await fetch('/api/v1/goals', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(getAdminToken() ? { authorization: `Bearer ${getAdminToken()}` } : {}),
        },
        body: JSON.stringify({
          name: `Goal - ${intentLabels[selectedIntent] || 'Custom'}`,
          task_type: taskType,
          target_requests_per_day: targetRequestsPerDay,
          target_tokens_per_day: targetTokensPerDay,
          latency_pref: latencyPref,
          budget_pref: budgetPref,
          budget_cap_usd_monthly: budgetPref === 'capped' ? budgetCapUsdMonthly : null,
          exhaustion_pref: exhaustionPref,
          reliability_pref: reliabilityPref,
          safety_margin_pct: safetyMarginPct,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `Failed to persist goal (HTTP ${res.status})`);
      }

      const createdGoal = await res.json();

      // Solve goal immediately to update pool plan if endpoint available
      fetch(`/api/v1/goals/${createdGoal.id}/solve`, {
        method: 'POST',
        headers: {
          ...(getAdminToken() ? { authorization: `Bearer ${getAdminToken()}` } : {}),
        },
      }).catch(() => {});

      setApplied(true);
      if (onApplyGoal) {
        onApplyGoal({ intent: selectedIntent, maxLatency, targetQuality, minAvailability });
      }

      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        setApplied(false);
        onClose();
      }, 600);
    } catch (e: any) {
      setSaveError(e.message || 'Failed to persist goal');
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  // Needed tokens & requests with safety headroom multiplier
  const effectiveTargetTokens = Math.round(targetTokensPerDay * (1 + safetyMarginPct / 100));
  const effectiveTargetRequests = Math.round(targetRequestsPerDay * (1 + safetyMarginPct / 100));

  const tokenCoveragePct = solvePlan
    ? Math.min(100, Math.round((solvePlan.projectedDailyTokenCapacity / effectiveTargetTokens) * 100))
    : 0;
  const requestCoveragePct = solvePlan
    ? Math.min(100, Math.round((solvePlan.projectedDailyRequestCapacity / effectiveTargetRequests) * 100))
    : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md p-3 sm:p-4 overflow-y-auto">
      <div className="relative w-full max-w-3xl max-h-[92vh] flex flex-col bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[24px] shadow-2xl overflow-hidden text-slate-100 animate-in fade-in zoom-in duration-200">
        
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-[var(--border-subtle)] bg-[var(--bg-card)] sticky top-0 z-10">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-[var(--accent-primary)]/10 border border-[var(--accent-primary)]/30 rounded-xl text-[var(--accent-primary)]">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-[var(--text-bright)] tracking-tight">Goal Studio & Solver Optimizer</h2>
              <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                Configure full constraint parameters enforced by the <GlossaryTerm term="Greedy Set-Cover" definition="Optimization solver balancing latency and quality across free & paid providers" /> routing engine.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-[var(--text-muted)] hover:text-[var(--text-bright)] hover:bg-[var(--bg-card-active)] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Content Body */}
        <div className="p-6 space-y-6 overflow-y-auto flex-1">
          
          {/* Section 1: Intent Presets & Task Type */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                1. Select Optimization Preset Intent
              </label>
              <span className="text-[11px] text-[var(--accent-primary)] font-medium">
                Preset: {selectedIntent.toUpperCase()}
              </span>
            </div>
            
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <button
                type="button"
                onClick={() => handleIntentSelect('coding')}
                className={`p-3.5 rounded-2xl border text-left transition-all ${
                  selectedIntent === 'coding'
                    ? 'border-[var(--accent-primary)] bg-[var(--bg-card-active)] shadow-lg shadow-[var(--accent-primary)]/10'
                    : 'border-[var(--border-subtle)] bg-[var(--bg-well)] hover:border-[var(--border-hover)]'
                }`}
              >
                <Code className="w-4 h-4 text-[var(--accent-primary)] mb-2" />
                <div className="font-semibold text-sm text-[var(--text-bright)]">High-Speed Code</div>
                <div className="text-[11px] text-[var(--text-muted)] mt-1">Coding Agent + Low TTFT</div>
              </button>

              <button
                type="button"
                onClick={() => handleIntentSelect('chat')}
                className={`p-3.5 rounded-2xl border text-left transition-all ${
                  selectedIntent === 'chat'
                    ? 'border-[var(--accent-primary)] bg-[var(--bg-card-active)] shadow-lg shadow-[var(--accent-primary)]/10'
                    : 'border-[var(--border-subtle)] bg-[var(--bg-well)] hover:border-[var(--border-hover)]'
                }`}
              >
                <Zap className="w-4 h-4 text-[var(--signal-mint)] mb-2" />
                <div className="font-semibold text-sm text-[var(--text-bright)]">Sub-100ms Chat</div>
                <div className="text-[11px] text-[var(--text-muted)] mt-1">Groq & Cerebras Llama 3.3</div>
              </button>

              <button
                type="button"
                onClick={() => handleIntentSelect('reasoning')}
                className={`p-3.5 rounded-2xl border text-left transition-all ${
                  selectedIntent === 'reasoning'
                    ? 'border-[var(--accent-primary)] bg-[var(--bg-card-active)] shadow-lg shadow-[var(--accent-primary)]/10'
                    : 'border-[var(--border-subtle)] bg-[var(--bg-well)] hover:border-[var(--border-hover)]'
                }`}
              >
                <MessageSquare className="w-4 h-4 text-[var(--signal-amber)] mb-2" />
                <div className="font-semibold text-sm text-[var(--text-bright)]">Math & Reasoning</div>
                <div className="text-[11px] text-[var(--text-muted)] mt-1">DeepSeek-R1 Enclave</div>
              </button>

              <button
                type="button"
                onClick={() => handleIntentSelect('custom')}
                className={`p-3.5 rounded-2xl border text-left transition-all ${
                  selectedIntent === 'custom'
                    ? 'border-[var(--accent-primary)] bg-[var(--bg-card-active)] shadow-lg shadow-[var(--accent-primary)]/10'
                    : 'border-[var(--border-subtle)] bg-[var(--bg-well)] hover:border-[var(--border-hover)]'
                }`}
              >
                <SlidersHorizontal className="w-4 h-4 text-purple-400 mb-2" />
                <div className="font-semibold text-sm text-[var(--text-bright)]">Custom Sliders</div>
                <div className="text-[11px] text-[var(--text-muted)] mt-1">Full Parameter Control</div>
              </button>
            </div>

            {/* Task Type Selector */}
            <div className="mt-3 p-3 bg-[var(--bg-well)] rounded-xl border border-[var(--border-subtle)] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
              <div className="flex items-center space-x-2 text-xs text-[var(--text-secondary)]">
                <Cpu className="w-4 h-4 text-[var(--accent-primary)]" />
                <span className="font-medium">Target Task Fitness Benchmark:</span>
              </div>
              <div className="flex flex-wrap gap-1.5 w-full sm:w-auto">
                {[
                  { id: 'coding_agent', label: 'Coding Agent' },
                  { id: 'chatbot', label: 'Chatbot' },
                  { id: 'research', label: 'Research' },
                  { id: 'batch', label: 'Batch Processing' },
                  { id: 'general', label: 'General / Custom' },
                ].map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      setTaskType(t.id as TaskType);
                      setSelectedIntent('custom');
                    }}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-mono font-medium transition-all ${
                      taskType === t.id
                        ? 'bg-[var(--accent-primary)] text-slate-950 shadow-sm font-semibold'
                        : 'bg-slate-900/60 text-[var(--text-secondary)] hover:bg-slate-800'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Section 2: Target Volume & Safety Headroom */}
          <div className="space-y-3">
            <label className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
              2. Target Daily Volume & Over-Provisioning Headroom
            </label>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 bg-[var(--bg-well)] p-4 rounded-2xl border border-[var(--border-subtle)]">
              {/* Daily Token Target */}
              <div className="space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-[var(--text-secondary)] font-medium">Daily Target Tokens</span>
                  <span className="text-[var(--accent-primary)] font-mono font-bold">
                    {(targetTokensPerDay / 1000000).toFixed(2)}M / day
                  </span>
                </div>
                <input
                  type="range"
                  min="500000"
                  max="20000000"
                  step="500000"
                  value={targetTokensPerDay}
                  onChange={(e) => {
                    setTargetTokensPerDay(Number(e.target.value));
                    setSelectedIntent('custom');
                  }}
                  className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-[var(--accent-primary)]"
                />
                <div className="flex justify-between text-[10px] text-[var(--text-muted)] font-mono">
                  <span>500k</span>
                  <span>10M</span>
                  <span>20M</span>
                </div>
              </div>

              {/* Daily Requests Target */}
              <div className="space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-[var(--text-secondary)] font-medium">Daily Target Requests</span>
                  <span className="text-[var(--signal-mint)] font-mono font-bold">
                    {targetRequestsPerDay.toLocaleString()} reqs / day
                  </span>
                </div>
                <input
                  type="range"
                  min="500"
                  max="10000"
                  step="250"
                  value={targetRequestsPerDay}
                  onChange={(e) => {
                    setTargetRequestsPerDay(Number(e.target.value));
                    setSelectedIntent('custom');
                  }}
                  className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-[var(--signal-mint)]"
                />
                <div className="flex justify-between text-[10px] text-[var(--text-muted)] font-mono">
                  <span>500</span>
                  <span>5k</span>
                  <span>10k</span>
                </div>
              </div>

              {/* Safety Margin Headroom */}
              <div className="space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-[var(--text-secondary)] font-medium">Safety Headroom Margin</span>
                  <span className="text-[var(--signal-amber)] font-mono font-bold">
                    +{safetyMarginPct}%
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="5"
                  value={safetyMarginPct}
                  onChange={(e) => {
                    setSafetyMarginPct(Number(e.target.value));
                    setSelectedIntent('custom');
                  }}
                  className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-[var(--signal-amber)]"
                />
                <div className="text-[10px] text-[var(--text-muted)] font-mono text-right">
                  Target + Headroom: {(effectiveTargetTokens / 1000000).toFixed(2)}M tokens
                </div>
              </div>
            </div>
          </div>

          {/* Section 3: Exhaustion & Routing Policy Controls */}
          <div className="space-y-3">
            <label className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
              3. Exhaustion Strategy & Reliability Controls
            </label>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Exhaustion Strategy Selector */}
              <div className="bg-[var(--bg-well)] p-4 rounded-2xl border border-[var(--border-subtle)] space-y-2.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-[var(--text-bright)] flex items-center gap-1.5">
                    <Activity className="w-3.5 h-3.5 text-sky-400" />
                    Exhaustion Quota Strategy
                  </span>
                  <span className="text-[10px] font-mono text-[var(--text-muted)]">{exhaustionPref}</span>
                </div>
                <div className="grid grid-cols-2 gap-2 p-1 bg-slate-900 rounded-xl border border-slate-800">
                  <button
                    type="button"
                    onClick={() => {
                      setExhaustionPref('fill_first');
                      setSelectedIntent('custom');
                    }}
                    className={`px-3 py-2 rounded-lg text-xs font-medium transition-all text-center ${
                      exhaustionPref === 'fill_first'
                        ? 'bg-[var(--accent-primary)] text-slate-950 font-bold shadow-md'
                        : 'text-[var(--text-secondary)] hover:text-white'
                    }`}
                  >
                    Drain Free First
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setExhaustionPref('preserve_backup');
                      setSelectedIntent('custom');
                    }}
                    className={`px-3 py-2 rounded-lg text-xs font-medium transition-all text-center ${
                      exhaustionPref === 'preserve_backup'
                        ? 'bg-[var(--accent-primary)] text-slate-950 font-bold shadow-md'
                        : 'text-[var(--text-secondary)] hover:text-white'
                    }`}
                  >
                    Balance & Preserve
                  </button>
                </div>
                <p className="text-[11px] text-[var(--text-muted)] leading-normal">
                  {exhaustionPref === 'fill_first'
                    ? 'Fill First completely exhausts one provider quota before routing to the next.'
                    : 'Balance & Preserve spreads request load across all active healthy providers.'}
                </p>
              </div>

              {/* Reliability Redundancy Mode Toggle */}
              <div className="bg-[var(--bg-well)] p-4 rounded-2xl border border-[var(--border-subtle)] space-y-2.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-[var(--text-bright)] flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5 text-[var(--signal-amber)]" />
                    Multi-Provider Reliability Mode
                  </span>
                  <span className="text-[10px] font-mono text-[var(--text-muted)]">{reliabilityPref}</span>
                </div>
                <div className="grid grid-cols-2 gap-2 p-1 bg-slate-900 rounded-xl border border-slate-800">
                  <button
                    type="button"
                    onClick={() => {
                      setReliabilityPref('standard');
                      setSelectedIntent('custom');
                    }}
                    className={`px-3 py-2 rounded-lg text-xs font-medium transition-all text-center ${
                      reliabilityPref === 'standard'
                        ? 'bg-[var(--signal-mint)] text-slate-950 font-bold shadow-md'
                        : 'text-[var(--text-secondary)] hover:text-white'
                    }`}
                  >
                    Standard Single
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setReliabilityPref('maximum');
                      setSelectedIntent('custom');
                    }}
                    className={`px-3 py-2 rounded-lg text-xs font-medium transition-all text-center ${
                      reliabilityPref === 'maximum'
                        ? 'bg-[var(--signal-amber)] text-slate-950 font-bold shadow-md'
                        : 'text-[var(--text-secondary)] hover:text-white'
                    }`}
                  >
                    Maximum Redundant
                  </button>
                </div>
                <p className="text-[11px] text-[var(--text-muted)] leading-normal">
                  {reliabilityPref === 'maximum'
                    ? 'Maximum forces cross-provider backup steps and triggers 6-factor auto_score policy.'
                    : 'Standard routes based on primary greedy candidate selection.'}
                </p>
              </div>
            </div>

            {/* Section 4: Budget Preference Toggle */}
            <div className="bg-[var(--bg-well)] p-4 rounded-2xl border border-[var(--border-subtle)] space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-[var(--text-bright)] flex items-center gap-1.5">
                  <DollarSign className="w-4 h-4 text-[var(--signal-mint)]" />
                  Cost Allowance & Budget Preference
                </span>
                <span className="text-[11px] font-mono text-[var(--signal-mint)] font-bold">
                  {budgetPref === 'free' ? '$0.00 FREE ONLY' : budgetPref === 'capped' ? `CAPPED ($${budgetCapUsdMonthly}/MO)` : 'UNLIMITED'}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2 p-1 bg-slate-900 rounded-xl border border-slate-800">
                <button
                  type="button"
                  onClick={() => {
                    setBudgetPref('free');
                    setSelectedIntent('custom');
                  }}
                  className={`px-3 py-2 rounded-lg text-xs font-medium transition-all text-center ${
                    budgetPref === 'free'
                      ? 'bg-[var(--signal-mint)] text-slate-950 font-bold shadow-md'
                      : 'text-[var(--text-secondary)] hover:text-white'
                  }`}
                >
                  Free Only ($0.00)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setBudgetPref('capped');
                    setSelectedIntent('custom');
                  }}
                  className={`px-3 py-2 rounded-lg text-xs font-medium transition-all text-center ${
                    budgetPref === 'capped'
                      ? 'bg-[var(--signal-amber)] text-slate-950 font-bold shadow-md'
                      : 'text-[var(--text-secondary)] hover:text-white'
                  }`}
                >
                  Capped Paid Fallback
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setBudgetPref('unlimited');
                    setSelectedIntent('custom');
                  }}
                  className={`px-3 py-2 rounded-lg text-xs font-medium transition-all text-center ${
                    budgetPref === 'unlimited'
                      ? 'bg-purple-400 text-slate-950 font-bold shadow-md'
                      : 'text-[var(--text-secondary)] hover:text-white'
                  }`}
                >
                  Unlimited Paid
                </button>
              </div>

              {budgetPref === 'capped' && (
                <div className="flex items-center space-x-3 pt-2">
                  <label className="text-xs text-[var(--text-secondary)]">Max Monthly Cap (USD):</label>
                  <div className="relative flex-1 max-w-[140px]">
                    <span className="absolute left-3 top-2 text-xs font-mono text-[var(--text-muted)]">$</span>
                    <input
                      type="number"
                      min="1"
                      max="1000"
                      value={budgetCapUsdMonthly}
                      onChange={(e) => setBudgetCapUsdMonthly(Number(e.target.value))}
                      className="w-full pl-7 pr-3 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs font-mono text-[var(--text-bright)] focus:border-[var(--accent-primary)] outline-none"
                    />
                  </div>
                  <span className="text-[11px] text-[var(--text-muted)]">Monthly budget limit</span>
                </div>
              )}
            </div>

          </div>

          {/* Section 5: Dynamic Solver Receipt & Paid Gap Suggestion */}
          <div className="p-4 rounded-2xl bg-[var(--bg-rail)] border border-[var(--border-subtle)] space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[var(--border-subtle)] pb-3">
              <div className="flex items-center space-x-2">
                <ShieldCheck className={`w-5 h-5 ${solvePlan?.feasible ? 'text-[var(--signal-mint)]' : 'text-amber-400'}`} />
                <div>
                  <div className="font-semibold text-xs text-[var(--text-bright)] flex items-center gap-2">
                    <span>Greedy Set-Cover Dynamic Receipt</span>
                    {isSolving && <RefreshCw className="w-3 h-3 text-[var(--accent-primary)] animate-spin" />}
                  </div>
                  <div className="text-[11px] text-[var(--text-muted)] font-mono">
                    Policy Selected: <span className="text-[var(--accent-primary)] font-bold">{solvePlan?.policy || 'calculating...'}</span>
                  </div>
                </div>
              </div>

              <div>
                {solvePlan?.feasible ? (
                  <span className="text-[11px] text-[var(--signal-mint)] bg-[var(--signal-mint)]/10 px-2.5 py-1 rounded-lg font-mono border border-[var(--signal-mint)]/30 font-bold flex items-center gap-1">
                    <Check className="w-3.5 h-3.5" /> 100% COVERAGE GUARANTEE
                  </span>
                ) : (
                  <span className="text-[11px] text-amber-400 bg-amber-400/10 px-2.5 py-1 rounded-lg font-mono border border-amber-400/30 font-bold flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5" /> CAPACITY SHORTFALL
                  </span>
                )}
              </div>
            </div>

            {/* Live Token & Request Capacity Progress Bars */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Tokens Coverage */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-[11px] font-mono">
                  <span className="text-[var(--text-secondary)]">Token Capacity Coverage</span>
                  <span className={`font-bold ${tokenCoveragePct >= 100 ? 'text-[var(--signal-mint)]' : 'text-amber-400'}`}>
                    {tokenCoveragePct}% ({((solvePlan?.projectedDailyTokenCapacity || 0) / 1000000).toFixed(2)}M / {(effectiveTargetTokens / 1000000).toFixed(2)}M)
                  </span>
                </div>
                <div className="h-2 w-full bg-slate-900 rounded-full overflow-hidden border border-slate-800">
                  <div
                    className={`h-full transition-all duration-300 ${tokenCoveragePct >= 100 ? 'bg-[var(--signal-mint)]' : 'bg-amber-400'}`}
                    style={{ width: `${tokenCoveragePct}%` }}
                  />
                </div>
              </div>

              {/* Requests Coverage */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-[11px] font-mono">
                  <span className="text-[var(--text-secondary)]">Request Capacity Coverage</span>
                  <span className={`font-bold ${requestCoveragePct >= 100 ? 'text-[var(--signal-mint)]' : 'text-amber-400'}`}>
                    {requestCoveragePct}% ({((solvePlan?.projectedDailyRequestCapacity || 0)).toLocaleString()} / {effectiveTargetRequests.toLocaleString()})
                  </span>
                </div>
                <div className="h-2 w-full bg-slate-900 rounded-full overflow-hidden border border-slate-800">
                  <div
                    className={`h-full transition-all duration-300 ${requestCoveragePct >= 100 ? 'bg-[var(--signal-mint)]' : 'bg-amber-400'}`}
                    style={{ width: `${requestCoveragePct}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Active Selected Steps */}
            {solvePlan && solvePlan.steps.length > 0 && (
              <div className="space-y-2 pt-1">
                <div className="text-[11px] font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
                  Chained Pool Candidates ({solvePlan.steps.length}):
                </div>
                <div className="flex flex-wrap gap-2">
                  {solvePlan.steps.map((step, idx) => (
                    <div
                      key={idx}
                      className="px-2.5 py-1 rounded-lg bg-slate-900/80 border border-slate-800 text-[11px] font-mono flex items-center space-x-1.5"
                    >
                      <span className={`w-2 h-2 rounded-full ${step.role === 'primary' ? 'bg-[var(--signal-mint)]' : 'bg-sky-400'}`} />
                      <span className="text-[var(--text-bright)] font-semibold">{step.candidate.providerDisplayName}</span>
                      <span className="text-[var(--text-muted)]">({step.candidate.modelDisplayName})</span>
                      <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-[var(--text-secondary)]">{step.role}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Paid Gap Suggestion Card */}
            {solvePlan && !solvePlan.feasible && solvePlan.gapSuggestion && (
              <div className="p-3.5 rounded-xl bg-amber-950/30 border border-amber-500/40 space-y-2 text-xs">
                <div className="flex items-center space-x-2 text-amber-400 font-semibold">
                  <TrendingUp className="w-4 h-4" />
                  <span>Solver Capacity Gap Suggestion:</span>
                </div>
                <p className="text-[11px] text-amber-200/90 leading-relaxed">
                  {solvePlan.gapSuggestion.reason}
                </p>
                <div className="flex items-center justify-between pt-1">
                  <span className="text-[11px] font-mono text-amber-300">
                    Est. Cost: ${solvePlan.gapSuggestion.estimatedMonthlyCostUsd.toFixed(2)}/mo
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setBudgetPref('capped');
                      setSelectedIntent('custom');
                    }}
                    className="px-3 py-1 rounded-lg bg-[var(--signal-amber)] hover:opacity-90 text-slate-950 font-bold text-[11px] transition-all"
                  >
                    Enable Capped Paid Fallback
                  </button>
                </div>
              </div>
            )}

            {/* Decision Trace Toggle */}
            {solvePlan && solvePlan.decisionTrace.length > 0 && (
              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => setShowTrace(!showTrace)}
                  className="flex items-center space-x-1 text-[11px] font-mono text-[var(--text-muted)] hover:text-[var(--text-bright)] transition-colors"
                >
                  {showTrace ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  <span>{showTrace ? 'Hide' : 'View'} Solver Decision Trace ({solvePlan.decisionTrace.length} steps)</span>
                </button>
                {showTrace && (
                  <div className="mt-2 p-3 bg-slate-950 rounded-xl border border-slate-800 max-h-36 overflow-y-auto font-mono text-[10px] text-slate-300 space-y-1">
                    {solvePlan.decisionTrace.map((log, i) => (
                      <div key={i} className="leading-snug text-slate-400">
                        <span className="text-slate-600 mr-2">#{i + 1}</span>
                        {log}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

          </div>

        </div>

        {/* Footer Actions */}
        <div className="p-6 border-t border-[var(--border-subtle)] bg-[var(--bg-card)] flex items-center justify-end space-x-3 sticky bottom-0 z-10">
          {saveError && (
            <span className="mr-auto text-[11px] font-mono text-red-400">{saveError}</span>
          )}
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--text-bright)] hover:bg-[var(--bg-card-active)] transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className="px-6 py-2.5 rounded-xl text-xs font-semibold bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] text-slate-950 flex items-center space-x-2 transition-all shadow-lg shadow-[var(--accent-primary)]/20 active:scale-95 disabled:opacity-50"
          >
            {applied ? (
              <>
                <Check className="w-4 h-4" />
                <span>Strategy Activated!</span>
              </>
            ) : (
              <>
                <Sparkles className={`w-4 h-4 ${isSaving ? 'animate-pulse' : ''}`} />
                <span>{isSaving ? 'Persisting Goal Strategy...' : 'Apply Goal Strategy'}</span>
              </>
            )}
          </button>
        </div>

      </div>
    </div>
  );
};
