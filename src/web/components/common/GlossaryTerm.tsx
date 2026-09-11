import React from 'react';

export interface GlossaryTermProps {
  term: string;
  definition?: string;
  children?: React.ReactNode;
}

export const GLOSSARY_DEFINITIONS: Record<string, string> = {
  'Greedy Set-Cover': 'Optimization technique that selects the smallest, highest-scoring subset of free providers to guarantee 100% target capability coverage.',
  'Pareto Headroom': 'Quantified quality and latency buffer indicating safety margin before fallbacks or quality degradation occurs.',
  'Heuristic Score': 'Composite ranking calculated dynamically from real-time TTFT, throughput, health history, and cost constraints.',
  'Enclave Enforcing': 'Zero-trust cryptographic key isolation policy preventing raw provider API keys from leaving local proxy memory.',
  'Jitter Shield': 'Sub-millisecond sliding-window filter that absorbs network variance and reroutes requests around provider spikes.',
};

export const GlossaryTerm: React.FC<GlossaryTermProps> = ({ term, definition, children }) => {
  const tooltipText = definition || GLOSSARY_DEFINITIONS[term] || term;
  return (
    <span className="glossary-term cursor-help border-b border-dashed border-[var(--border-hover)] text-[var(--text-primary)] hover:text-[var(--accent-primary)] transition-colors" title={tooltipText}>
      {children || term}
    </span>
  );
};
