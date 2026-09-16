import { HealthState } from '../../shared/types.js';

export interface ScoringCandidate {
  connectionId: string;
  providerSlug: string;
  modelId: string;
  modelName: string;
  canonicalId?: string | null;
  healthState: HealthState;
  quotaRemainingPct: number; // 0..1
  benchTps?: number | null;
  benchTtftMs?: number | null;
  benchP95LatencyMs?: number | null;
  benchReasoningScore?: number | null;
  benchCodingScore?: number | null;
  benchCommandScore?: number | null;
  benchMathScore?: number | null;
  benchVisionScore?: number | null;
  benchLongContextScore?: number | null;
  taskFitness: number; // 0..1
  costPer1kUsd: number;
}

export interface FactorWeights {
  quotaHeadroom: number;
  health: number;
  latencyFit: number;
  taskFit: number;
  costEfficiency: number;
  stability: number;
  benchmarkFit: number;
}

export interface ScoreBreakdown {
  compositeScore: number;
  factorScores: {
    quotaHeadroom: number;
    health: number;
    latencyFit: number;
    taskFit: number;
    costEfficiency: number;
    stability: number;
    benchmarkFit: number;
  };
}
