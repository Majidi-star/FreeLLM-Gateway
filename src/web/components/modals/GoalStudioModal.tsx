import React, { useState } from 'react';
import { X, Sparkles, Zap, Code, MessageSquare, ShieldCheck, Check, SlidersHorizontal } from 'lucide-react';
import { GlossaryTerm } from '../common/GlossaryTerm.js';

interface GoalStudioModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApplyGoal?: (goal: { intent: string; maxLatency: number; targetQuality: number; minAvailability: number }) => void;
}

export const GoalStudioModal: React.FC<GoalStudioModalProps> = ({ isOpen, onClose, onApplyGoal }) => {
  const [selectedIntent, setSelectedIntent] = useState<'coding' | 'chat' | 'reasoning' | 'custom'>('coding');
  const [maxLatency, setMaxLatency] = useState(250);
  const [targetQuality, setTargetQuality] = useState(95);
  const [minAvailability, setMinAvailability] = useState(99.5);
  const [applied, setApplied] = useState(false);

  if (!isOpen) return null;

  const handleIntentSelect = (intent: 'coding' | 'chat' | 'reasoning' | 'custom') => {
    setSelectedIntent(intent);
    if (intent === 'coding') {
      setMaxLatency(200);
      setTargetQuality(98);
      setMinAvailability(99.9);
    } else if (intent === 'chat') {
      setMaxLatency(120);
      setTargetQuality(90);
      setMinAvailability(99.0);
    } else if (intent === 'reasoning') {
      setMaxLatency(400);
      setTargetQuality(99);
      setMinAvailability(99.5);
    }
  };

  const saveTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  const handleSave = () => {
    setApplied(true);
    if (onApplyGoal) {
      onApplyGoal({ intent: selectedIntent, maxLatency, targetQuality, minAvailability });
    }
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      setApplied(false);
      onClose();
    }, 600);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-2xl bg-[var(--bg-card)] border border-[var(--border-subtle)] rounded-[24px] shadow-2xl p-6 sm:p-8 overflow-hidden text-slate-100 animate-in fade-in zoom-in duration-200">
        
        {/* Header */}
        <div className="flex items-center justify-between pb-6 border-b border-[var(--border-subtle)]">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-[var(--accent-primary)]/10 border border-[var(--accent-primary)]/30 rounded-xl text-[var(--accent-primary)]">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white tracking-tight">Goal Studio & Constraint Optimizer</h2>
              <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                Define routing target requirements enforced by the <GlossaryTerm term="Greedy Set-Cover" definition="Optimization solver balancing latency and quality across free providers" /> solver.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-[var(--bg-card-active)] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Intent Presets */}
        <div className="py-6 space-y-3">
          <label className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">1. Select Optimization Preset Intent</label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <button
              onClick={() => handleIntentSelect('coding')}
              className={`p-3.5 rounded-2xl border text-left transition-all ${
                selectedIntent === 'coding'
                  ? 'border-[var(--accent-primary)] bg-[var(--bg-card-active)] shadow-lg shadow-[var(--accent-primary)]/10'
                  : 'border-[var(--border-subtle)] bg-[var(--bg-well)] hover:border-[var(--border-hover)]'
              }`}
            >
              <Code className="w-4 h-4 text-[var(--accent-primary)] mb-2" />
              <div className="font-semibold text-sm text-white">High-Speed Code</div>
              <div className="text-[11px] text-[var(--text-muted)] mt-1">Qwen 2.5 Coder + DeepSeek</div>
            </button>

            <button
              onClick={() => handleIntentSelect('chat')}
              className={`p-3.5 rounded-2xl border text-left transition-all ${
                selectedIntent === 'chat'
                  ? 'border-[var(--accent-primary)] bg-[var(--bg-card-active)] shadow-lg shadow-[var(--accent-primary)]/10'
                  : 'border-[var(--border-subtle)] bg-[var(--bg-well)] hover:border-[var(--border-hover)]'
              }`}
            >
              <Zap className="w-4 h-4 text-[var(--signal-mint)] mb-2" />
              <div className="font-semibold text-sm text-white">Sub-100ms Chat</div>
              <div className="text-[11px] text-[var(--text-muted)] mt-1">Groq & Cerebras Llama 3.3</div>
            </button>

            <button
              onClick={() => handleIntentSelect('reasoning')}
              className={`p-3.5 rounded-2xl border text-left transition-all ${
                selectedIntent === 'reasoning'
                  ? 'border-[var(--accent-primary)] bg-[var(--bg-card-active)] shadow-lg shadow-[var(--accent-primary)]/10'
                  : 'border-[var(--border-subtle)] bg-[var(--bg-well)] hover:border-[var(--border-hover)]'
              }`}
            >
              <MessageSquare className="w-4 h-4 text-[var(--signal-amber)] mb-2" />
              <div className="font-semibold text-sm text-white">Math & Reasoning</div>
              <div className="text-[11px] text-[var(--text-muted)] mt-1">DeepSeek-R1 Enclave</div>
            </button>

            <button
              onClick={() => handleIntentSelect('custom')}
              className={`p-3.5 rounded-2xl border text-left transition-all ${
                selectedIntent === 'custom'
                  ? 'border-[var(--accent-primary)] bg-[var(--bg-card-active)] shadow-lg shadow-[var(--accent-primary)]/10'
                  : 'border-[var(--border-subtle)] bg-[var(--bg-well)] hover:border-[var(--border-hover)]'
              }`}
            >
              <SlidersHorizontal className="w-4 h-4 text-purple-400 mb-2" />
              <div className="font-semibold text-sm text-white">Custom Sliders</div>
              <div className="text-[11px] text-[var(--text-muted)] mt-1">Manual Weight Tuning</div>
            </button>
          </div>
        </div>

        {/* Sliders & Constraints */}
        <div className="space-y-4 py-2">
          <label className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">2. Outcome Constraints & Thresholds</label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-[var(--bg-well)] p-4 rounded-2xl border border-[var(--border-subtle)]">
            
            {/* Latency Threshold */}
            <div className="space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-[var(--text-secondary)] font-medium">Max Allowed Latency</span>
                <span className="text-[var(--signal-mint)] font-mono font-bold" dir="ltr">{maxLatency} ms</span>
              </div>
              <input
                type="range"
                min="50"
                max="1000"
                step="10"
                value={maxLatency}
                onChange={(e) => setMaxLatency(Number(e.target.value))}
                className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-[var(--signal-mint)]"
              />
            </div>

            {/* Quality Target */}
            <div className="space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-[var(--text-secondary)] font-medium">Target Quality Benchmark</span>
                <span className="text-[var(--accent-primary)] font-mono font-bold" dir="ltr">{targetQuality}%</span>
              </div>
              <input
                type="range"
                min="70"
                max="99"
                step="1"
                value={targetQuality}
                onChange={(e) => setTargetQuality(Number(e.target.value))}
                className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-[var(--accent-primary)]"
              />
            </div>

            {/* Cost Ceiling (Always $0.00 Free) */}
            <div className="space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-[var(--text-secondary)] font-medium">Max Cost Allowance</span>
                <span className="text-[var(--signal-mint)] font-mono font-bold" dir="ltr">$0.00 / 1M (FREE ONLY)</span>
              </div>
              <div className="h-1.5 bg-[var(--signal-mint)]/20 rounded-full overflow-hidden">
                <div className="h-full bg-[var(--signal-mint)] w-full" />
              </div>
            </div>

            {/* Availability SLA */}
            <div className="space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-[var(--text-secondary)] font-medium">Minimum Availability SLA</span>
                <span className="text-[var(--signal-amber)] font-mono font-bold" dir="ltr">{minAvailability}%</span>
              </div>
              <input
                type="range"
                min="95"
                max="99.9"
                step="0.1"
                value={minAvailability}
                onChange={(e) => setMinAvailability(Number(e.target.value))}
                className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-[var(--signal-amber)]"
              />
            </div>
          </div>
        </div>

        {/* Greedy Set-Cover Receipt & Pareto Headroom */}
        <div className="mt-4 p-4 rounded-2xl bg-[var(--bg-rail)] border border-[var(--border-subtle)] space-y-3">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-slate-200 flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-[var(--signal-mint)]" />
              Greedy Set-Cover Receipt Optimization
            </span>
            <span className="text-[11px] text-[var(--signal-mint)] bg-[var(--signal-mint)]/10 px-2 py-0.5 rounded-md font-mono border border-[var(--signal-mint)]/20">
              100% COVERAGE GUARANTEE
            </span>
          </div>

          <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
            Optimal provider set selected: <strong className="text-white">DeepSeek-R1 (Primary)</strong> + <strong className="text-white">Qwen 2.5 Coder (Fast Fallback)</strong>. Zero cost tier active.
          </p>

          {/* Dual-tone Pareto Headroom Bar */}
          <div className="space-y-1.5">
            <div className="flex justify-between text-[11px] font-mono text-[var(--text-muted)]">
              <span><GlossaryTerm term="Pareto Headroom" /> Quality Buffer: {targetQuality}%</span>
              <span>Speed Margin: +{(500 - maxLatency)}ms</span>
            </div>
            <div className="h-2.5 w-full bg-slate-900 rounded-full overflow-hidden flex p-0.5 gap-0.5 border border-slate-800">
              <div className="h-full bg-[var(--accent-primary)] rounded-l-full" style={{ width: `${targetQuality}%` }} />
              <div className="h-full bg-[var(--signal-mint)] rounded-r-full flex-1" />
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="mt-6 flex items-center justify-end space-x-3 pt-4 border-t border-[var(--border-subtle)]">
          <button
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl text-xs font-semibold text-[var(--text-secondary)] hover:text-white hover:bg-[var(--bg-card-active)] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-6 py-2.5 rounded-xl text-xs font-semibold bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] text-slate-950 flex items-center space-x-2 transition-all shadow-lg shadow-[var(--accent-primary)]/20 active:scale-95"
          >
            {applied ? (
              <>
                <Check className="w-4 h-4" />
                <span>Strategy Activated!</span>
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                <span>Apply Goal Strategy</span>
              </>
            )}
          </button>
        </div>

      </div>
    </div>
  );
};
