import React, { useState } from 'react';
import { X, CheckCircle2, AlertTriangle, Copy, Check, ChevronDown, ChevronRight, Cpu, Clock, DollarSign, Shield, Info, ArrowUpRight } from 'lucide-react';
import { GlossaryTerm } from '../common/GlossaryTerm.js';
import { sanitizeForClipboard } from '../../utils/clipboardSanitizer.js';

export interface DecisionTrace {
  id: string;
  timestamp: string;
  promptSnippet: string;
  selectedModel: string;
  selectedProvider: string;
  latencyMs: number;
  tokens: { prompt: number; completion: number; total: number };
  routingPolicy: string;
  heuristicScore: number;
  verdict: string;
  isFallback?: boolean;
  candidates: {
    name: string;
    provider: string;
    latencyMs: number;
    score: number;
    status: 'selected' | 'filtered' | 'evaluated';
    reason?: string;
  }[];
  factors: {
    latency: number; // 0 - 100
    cost: number;
    capability: number;
    health: number;
  };
}

interface DecisionInspectorDrawerProps {
  trace: DecisionTrace | null;
  isOpen: boolean;
  onClose: () => void;
}

export const DecisionInspectorDrawer: React.FC<DecisionInspectorDrawerProps> = ({ trace, isOpen, onClose }) => {
  const [copied, setCopied] = useState(false);
  const [showRawJson, setShowRawJson] = useState(false);
  const copyTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  if (!isOpen || !trace) return null;

  const handleCopyJson = () => {
    navigator.clipboard.writeText(sanitizeForClipboard(JSON.stringify(trace, null, 2)));
    setCopied(true);
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-black/60 backdrop-blur-xs">
      <div className="absolute inset-0" onClick={onClose} />
      
      <aside className="absolute inset-y-0 right-0 max-w-full flex pl-10">
        <div className="w-screen max-w-[460px] bg-[var(--bg-rail)] border-l border-[var(--border-subtle)] shadow-2xl flex flex-col justify-between text-slate-100 animate-in slide-in-from-right duration-300">
          
          {/* Header */}
          <div className="p-6 border-b border-[var(--border-subtle)] bg-[var(--bg-obsidian)] flex items-center justify-between">
            <div className="space-y-1">
              <div className="flex items-center space-x-2">
                <span className="px-2 py-0.5 text-[10px] font-mono font-bold tracking-wide uppercase bg-[var(--accent-primary)]/10 text-[var(--accent-primary)] border border-[var(--accent-primary)]/30 rounded-md">
                  Trace ID
                </span>
                <span className="text-xs font-mono text-[var(--text-secondary)]" dir="ltr">{trace.id}</span>
              </div>
              <h2 className="text-lg font-bold text-white tracking-tight">Why This Route? Decision Inspector</h2>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-xl text-[var(--text-muted)] hover:text-white hover:bg-[var(--bg-card-active)] transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Drawer Body - Scrollable */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
            
            {/* Routing Verdict Quote Card */}
            <div className="p-4 rounded-2xl bg-[var(--bg-card)] border border-[var(--border-hover)] space-y-2 relative overflow-hidden shadow-lg">
              <div className="absolute top-0 left-0 bottom-0 w-1 bg-[var(--accent-primary)]" />
              <div className="flex items-center justify-between text-xs text-[var(--accent-primary)] font-semibold">
                <span className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-[var(--signal-mint)]" />
                  Routing Decision Rationale
                </span>
                <span className="text-[11px] font-mono text-[var(--text-muted)]" dir="ltr">{trace.timestamp}</span>
              </div>
              <p className="text-xs text-slate-200 leading-relaxed font-sans italic">
                "{trace.verdict}"
              </p>
            </div>

            {/* Prompt & Request Overview */}
            <div className="p-4 rounded-2xl bg-[var(--bg-card)] border border-[var(--border-subtle)] space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">Target Prompt Context</div>
              <p className="text-xs font-mono text-slate-300 bg-[var(--bg-well)] p-2.5 rounded-xl border border-[var(--border-subtle)] truncate" dir="ltr">
                {trace.promptSnippet}
              </p>
              <div className="flex justify-between items-center text-xs text-[var(--text-muted)] pt-1">
                <span>Policy Applied: <strong className="text-white">{trace.routingPolicy}</strong></span>
                <span><GlossaryTerm term="Heuristic Score" />: <strong className="text-[var(--signal-mint)] font-mono">{trace.heuristicScore}/100</strong></span>
              </div>
            </div>

            {/* 3-Step Candidate Evaluation Timeline */}
            <div className="space-y-3">
              <div className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">3-Step Candidate Evaluation Timeline</div>
              <div className="space-y-2">
                {trace.candidates.map((cand, idx) => (
                  <div
                    key={idx}
                    className={`p-3.5 rounded-2xl border flex items-center justify-between text-xs transition-all ${
                      cand.status === 'selected'
                        ? 'bg-[var(--bg-card-active)] border-[var(--signal-mint)] shadow-md shadow-[var(--signal-mint)]/5'
                        : cand.status === 'filtered'
                        ? 'bg-[var(--bg-card)]/50 border-red-500/20 opacity-60'
                        : 'bg-[var(--bg-card)] border-[var(--border-subtle)]'
                    }`}
                  >
                    <div className="flex items-center space-x-3">
                      <div className={`p-1.5 rounded-lg ${
                        cand.status === 'selected' ? 'bg-[var(--signal-mint)]/20 text-[var(--signal-mint)]' : 'bg-slate-800 text-slate-400'
                      }`}>
                        <Cpu className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="font-semibold text-white flex items-center gap-2">
                          {cand.name}
                          <span className="text-[10px] text-[var(--text-muted)] font-mono" dir="ltr">({cand.provider})</span>
                        </div>
                        <div className="text-[11px] text-[var(--text-muted)] mt-0.5" dir="ltr">
                          {cand.status === 'selected' ? 'Selected Winner' : cand.reason || 'Evaluated'}
                        </div>
                      </div>
                    </div>

                    <div className="text-right font-mono" dir="ltr">
                      <div className="font-bold text-slate-200">{cand.latencyMs}ms</div>
                      <div className="text-[10px] text-[var(--accent-primary)]">{cand.score} pts</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* 4-Factor Metric Mini-bars */}
            <div className="p-4 rounded-2xl bg-[var(--bg-card)] border border-[var(--border-subtle)] space-y-3">
              <div className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">4-Factor Weight Evaluation</div>
              
              <div className="space-y-2.5 text-xs">
                {/* Latency Factor */}
                <div>
                  <div className="flex justify-between text-[11px] mb-1">
                    <span className="text-slate-300">Latency Weight (35%)</span>
                    <span className="font-mono text-[var(--signal-mint)]">{trace.factors.latency}%</span>
                  </div>
                  <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                    <div className="h-full bg-[var(--signal-mint)] rounded-full" style={{ width: `${trace.factors.latency}%` }} />
                  </div>
                </div>

                {/* Cost Factor */}
                <div>
                  <div className="flex justify-between text-[11px] mb-1">
                    <span className="text-slate-300">Cost Preference (40%)</span>
                    <span className="font-mono text-[var(--signal-mint)]">{trace.factors.cost}% ($0.00 FREE)</span>
                  </div>
                  <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                    <div className="h-full bg-[var(--signal-mint)] rounded-full" style={{ width: `${trace.factors.cost}%` }} />
                  </div>
                </div>

                {/* Capability Factor */}
                <div>
                  <div className="flex justify-between text-[11px] mb-1">
                    <span className="text-slate-300">Model Capability (15%)</span>
                    <span className="font-mono text-[var(--accent-primary)]">{trace.factors.capability}%</span>
                  </div>
                  <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                    <div className="h-full bg-[var(--accent-primary)] rounded-full" style={{ width: `${trace.factors.capability}%` }} />
                  </div>
                </div>

                {/* Health Factor */}
                <div>
                  <div className="flex justify-between text-[11px] mb-1">
                    <span className="text-slate-300">Provider Health SLA (10%)</span>
                    <span className="font-mono text-[var(--signal-amber)]">{trace.factors.health}%</span>
                  </div>
                  <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                    <div className="h-full bg-[var(--signal-amber)] rounded-full" style={{ width: `${trace.factors.health}%` }} />
                  </div>
                </div>
              </div>
            </div>

            {/* Token & Savings Ledger */}
            <div className="p-4 rounded-2xl bg-[var(--bg-well)] border border-[var(--border-subtle)] space-y-3">
              <div className="flex items-center justify-between text-xs font-semibold text-white">
                <span className="flex items-center gap-1.5">
                  <DollarSign className="w-4 h-4 text-[var(--signal-mint)]" />
                  Token & Zero-Cost Ledger
                </span>
                <span className="text-[11px] font-mono text-[var(--signal-mint)] bg-[var(--signal-mint)]/10 px-2 py-0.5 rounded-md">
                  $0.00 BILLABLE
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center" dir="ltr">
                <div className="bg-[var(--bg-card)] p-2 rounded-xl border border-[var(--border-subtle)]">
                  <div className="text-[10px] text-[var(--text-muted)] uppercase">Prompt</div>
                  <div className="font-mono font-bold text-xs text-white">{trace.tokens.prompt}</div>
                </div>
                <div className="bg-[var(--bg-card)] p-2 rounded-xl border border-[var(--border-subtle)]">
                  <div className="text-[10px] text-[var(--text-muted)] uppercase">Completion</div>
                  <div className="font-mono font-bold text-xs text-white">{trace.tokens.completion}</div>
                </div>
                <div className="bg-[var(--bg-card)] p-2 rounded-xl border border-[var(--border-subtle)]">
                  <div className="text-[10px] text-[var(--text-muted)] uppercase">Savings</div>
                  <div className="font-mono font-bold text-xs text-[var(--signal-mint)]">$0.0034</div>
                </div>
              </div>
            </div>

            {/* Raw JSON Disclosure */}
            <div className="border-t border-[var(--border-subtle)] pt-4">
              <button
                onClick={() => setShowRawJson(!showRawJson)}
                className="w-full flex items-center justify-between text-xs font-semibold text-[var(--text-secondary)] hover:text-white py-1 transition-colors"
              >
                <span>Raw Decision JSON Payload</span>
                {showRawJson ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              </button>

              {showRawJson && (
                <div className="mt-3 relative">
                  <button
                    onClick={handleCopyJson}
                    className="absolute top-3 right-3 p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs flex items-center space-x-1 border border-slate-700 transition-colors"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copied ? 'Copied' : 'Copy'}</span>
                  </button>
                  <pre className="p-4 bg-black rounded-xl border border-[var(--border-subtle)] text-[11px] font-mono text-emerald-400 overflow-x-auto max-h-60 custom-scrollbar" dir="ltr">
                    {JSON.stringify(trace, null, 2)}
                  </pre>
                </div>
              )}
            </div>

          </div>

          {/* Drawer Footer */}
          <div className="p-4 border-t border-[var(--border-subtle)] bg-[var(--bg-obsidian)] text-center text-xs text-[var(--text-muted)]">
            GoalRoute Engine v0.1.0 • Live Enclave Trace
          </div>
        </div>
      </aside>
    </div>
  );
};
