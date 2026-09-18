import React from 'react';
import { X, Check, Minus, Award } from 'lucide-react';

export interface ModelDetail {
  id: string;
  canonicalId?: string | null;
  modelName: string;
  displayName: string;
  providerSlug: string;
  providerDisplayName: string;
  contextWindow: number;
  supportsTools: boolean;
  supportsVision: boolean;
  costInputPer1k: number;
  costOutputPer1k: number;
  benchTps?: number | null;
  benchTtftMs?: number | null;
  benchP95LatencyMs?: number | null;
  benchReasoningScore?: number | null;
  benchCodingScore?: number | null;
  benchCommandScore?: number | null;
  benchMathScore?: number | null;
  benchVisionScore?: number | null;
  benchLongContextScore?: number | null;
  isActive: boolean;
}

interface ModelCompareModalProps {
  isOpen: boolean;
  models: ModelDetail[];
  onClose: () => void;
  onRemoveModel?: (modelId: string) => void;
}

export const ModelCompareModal: React.FC<ModelCompareModalProps> = ({
  isOpen,
  models,
  onClose,
  onRemoveModel,
}) => {
  if (!isOpen || models.length === 0) return null;

  const renderScoreBar = (score: number | null | undefined, colorClass = 'bg-[var(--accent-primary)]') => {
    if (score === null || score === undefined) {
      return <span className="text-[var(--text-muted)] text-xs font-mono">N/A</span>;
    }
    return (
      <div className="space-y-1 w-full">
        <div className="flex justify-between items-center text-xs font-mono">
          <span className="font-bold text-[var(--text-primary)]">{score.toFixed(1)}</span>
          <span className="text-[var(--text-muted)] text-[10px]">/ 100</span>
        </div>
        <div className="w-full bg-[var(--bg-well)] rounded-full h-1.5 overflow-hidden border border-[var(--border-subtle)]">
          <div
            className={`h-full rounded-full transition-all duration-500 ${colorClass}`}
            style={{ width: `${Math.min(100, Math.max(0, score))}%` }}
          />
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 md:p-6 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
      <div className="relative w-full max-w-6xl max-h-[90vh] bg-[var(--bg-rail)] border border-[var(--border-hover)] rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-subtle)] bg-[var(--bg-obsidian)]">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-xl bg-[var(--accent-primary)]/10 text-[var(--accent-primary)] border border-[var(--accent-primary)]/20">
              <Award className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-[var(--text-primary)] tracking-tight">
                Model Benchmark & Specs Comparison
              </h2>
              <p className="text-xs text-[var(--text-muted)] font-mono">
                Comparing {models.length} model{models.length > 1 ? 's' : ''} side-by-side
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl hover:bg-[var(--bg-card)] text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Scrollable Content */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-6">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[600px]">
              <thead>
                <tr>
                  <th className="p-3 text-xs font-bold uppercase tracking-wider text-[var(--text-muted)] bg-[var(--bg-well)] border-b border-[var(--border-subtle)] w-48 rounded-tl-xl">
                    Specification / Metric
                  </th>
                  {models.map((m) => (
                    <th
                      key={m.id}
                      className="p-3 bg-[var(--bg-well)] border-b border-[var(--border-subtle)] align-top min-w-[200px]"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="font-bold text-sm text-[var(--text-primary)] leading-tight">
                            {m.displayName}
                          </div>
                          <div className="text-xs text-[var(--accent-primary)] font-mono font-medium">
                            {m.providerDisplayName}
                          </div>
                          <div className="text-[10px] text-[var(--text-muted)] font-mono mt-0.5 truncate">
                            {m.modelName}
                          </div>
                        </div>
                        {onRemoveModel && models.length > 1 && (
                          <button
                            onClick={() => onRemoveModel(m.id)}
                            className="p-1 rounded text-[var(--text-muted)] hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
                            title="Remove from comparison"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)] text-xs">
                
                {/* Section Header: Benchmarks */}
                <tr className="bg-[var(--bg-obsidian)]">
                  <td colSpan={models.length + 1} className="py-2.5 px-3 font-bold uppercase tracking-wider text-[var(--signal-mint)] text-[11px] font-mono">
                    ✦ Core Benchmark Scores (0–100)
                  </td>
                </tr>

                <tr>
                  <td className="p-3 font-medium text-[var(--text-secondary)]">Reasoning Score</td>
                  {models.map((m) => (
                    <td key={m.id} className="p-3">
                      {renderScoreBar(m.benchReasoningScore, 'bg-emerald-500')}
                    </td>
                  ))}
                </tr>

                <tr>
                  <td className="p-3 font-medium text-[var(--text-secondary)]">Coding Score</td>
                  {models.map((m) => (
                    <td key={m.id} className="p-3">
                      {renderScoreBar(m.benchCodingScore, 'bg-cyan-500')}
                    </td>
                  ))}
                </tr>

                <tr>
                  <td className="p-3 font-medium text-[var(--text-secondary)]">Math Score</td>
                  {models.map((m) => (
                    <td key={m.id} className="p-3">
                      {renderScoreBar(m.benchMathScore, 'bg-purple-500')}
                    </td>
                  ))}
                </tr>

                <tr>
                  <td className="p-3 font-medium text-[var(--text-secondary)]">Vision Benchmark</td>
                  {models.map((m) => (
                    <td key={m.id} className="p-3">
                      {renderScoreBar(m.benchVisionScore, 'bg-amber-500')}
                    </td>
                  ))}
                </tr>

                <tr>
                  <td className="p-3 font-medium text-[var(--text-secondary)]">Long Context Fitness</td>
                  {models.map((m) => (
                    <td key={m.id} className="p-3">
                      {renderScoreBar(m.benchLongContextScore, 'bg-blue-500')}
                    </td>
                  ))}
                </tr>

                <tr>
                  <td className="p-3 font-medium text-[var(--text-secondary)]">Command Execution</td>
                  {models.map((m) => (
                    <td key={m.id} className="p-3">
                      {renderScoreBar(m.benchCommandScore, 'bg-indigo-500')}
                    </td>
                  ))}
                </tr>

                {/* Section Header: Hardware & Performance */}
                <tr className="bg-[var(--bg-obsidian)]">
                  <td colSpan={models.length + 1} className="py-2.5 px-3 font-bold uppercase tracking-wider text-[var(--accent-primary)] text-[11px] font-mono">
                    ✦ Latency & Throughput Specs
                  </td>
                </tr>

                <tr>
                  <td className="p-3 font-medium text-[var(--text-secondary)]">Throughput (TPS)</td>
                  {models.map((m) => (
                    <td key={m.id} className="p-3 font-mono font-bold text-[var(--text-primary)]">
                      {m.benchTps ? `${m.benchTps} tok/s` : <span className="text-[var(--text-muted)] font-normal">N/A</span>}
                    </td>
                  ))}
                </tr>

                <tr>
                  <td className="p-3 font-medium text-[var(--text-secondary)]">Time To First Token (TTFT)</td>
                  {models.map((m) => (
                    <td key={m.id} className="p-3 font-mono font-bold text-[var(--text-primary)]">
                      {m.benchTtftMs ? `${m.benchTtftMs} ms` : <span className="text-[var(--text-muted)] font-normal">N/A</span>}
                    </td>
                  ))}
                </tr>

                <tr>
                  <td className="p-3 font-medium text-[var(--text-secondary)]">P95 Latency</td>
                  {models.map((m) => (
                    <td key={m.id} className="p-3 font-mono font-bold text-[var(--text-primary)]">
                      {m.benchP95LatencyMs ? `${m.benchP95LatencyMs} ms` : <span className="text-[var(--text-muted)] font-normal">N/A</span>}
                    </td>
                  ))}
                </tr>

                {/* Section Header: Context & Pricing */}
                <tr className="bg-[var(--bg-obsidian)]">
                  <td colSpan={models.length + 1} className="py-2.5 px-3 font-bold uppercase tracking-wider text-[var(--text-primary)] text-[11px] font-mono">
                    ✦ Context Limit & Token Pricing
                  </td>
                </tr>

                <tr>
                  <td className="p-3 font-medium text-[var(--text-secondary)]">Context Window</td>
                  {models.map((m) => (
                    <td key={m.id} className="p-3 font-mono font-bold text-[var(--text-primary)]">
                      {(m.contextWindow / 1024).toFixed(0)}K tokens
                    </td>
                  ))}
                </tr>

                <tr>
                  <td className="p-3 font-medium text-[var(--text-secondary)]">Input Cost (per 1K)</td>
                  {models.map((m) => (
                    <td key={m.id} className="p-3 font-mono">
                      {m.costInputPer1k === 0 ? (
                        <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-bold border border-emerald-500/20">
                          FREE
                        </span>
                      ) : (
                        <span className="text-[var(--text-primary)] font-bold">${m.costInputPer1k.toFixed(5)}</span>
                      )}
                    </td>
                  ))}
                </tr>

                <tr>
                  <td className="p-3 font-medium text-[var(--text-secondary)]">Output Cost (per 1K)</td>
                  {models.map((m) => (
                    <td key={m.id} className="p-3 font-mono">
                      {m.costOutputPer1k === 0 ? (
                        <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-bold border border-emerald-500/20">
                          FREE
                        </span>
                      ) : (
                        <span className="text-[var(--text-primary)] font-bold">${m.costOutputPer1k.toFixed(5)}</span>
                      )}
                    </td>
                  ))}
                </tr>

                {/* Section Header: Capabilities */}
                <tr className="bg-[var(--bg-obsidian)]">
                  <td colSpan={models.length + 1} className="py-2.5 px-3 font-bold uppercase tracking-wider text-amber-400 text-[11px] font-mono">
                    ✦ Native Capabilities
                  </td>
                </tr>

                <tr>
                  <td className="p-3 font-medium text-[var(--text-secondary)]">Tool Calling (Function)</td>
                  {models.map((m) => (
                    <td key={m.id} className="p-3">
                      {m.supportsTools ? (
                        <span className="inline-flex items-center space-x-1 text-emerald-400 font-bold">
                          <Check className="w-4 h-4" /> <span>Supported</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center space-x-1 text-[var(--text-muted)]">
                          <Minus className="w-4 h-4" /> <span>No</span>
                        </span>
                      )}
                    </td>
                  ))}
                </tr>

                <tr>
                  <td className="p-3 font-medium text-[var(--text-secondary)]">Vision Input</td>
                  {models.map((m) => (
                    <td key={m.id} className="p-3">
                      {m.supportsVision ? (
                        <span className="inline-flex items-center space-x-1 text-cyan-400 font-bold">
                          <Check className="w-4 h-4" /> <span>Multimodal Vision</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center space-x-1 text-[var(--text-muted)]">
                          <Minus className="w-4 h-4" /> <span>Text Only</span>
                        </span>
                      )}
                    </td>
                  ))}
                </tr>

              </tbody>
            </table>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 border-t border-[var(--border-subtle)] bg-[var(--bg-obsidian)] flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl bg-[var(--bg-well)] hover:bg-[var(--bg-card)] border border-[var(--border-hover)] text-sm font-bold text-[var(--text-primary)] transition-all cursor-pointer"
          >
            Close Comparison
          </button>
        </div>

      </div>
    </div>
  );
};
