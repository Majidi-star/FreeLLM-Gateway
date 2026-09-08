import { HealthState, TaskType } from '../../shared/types.js';

export interface ScoringCandidate {
  connectionId: string;
  providerSlug: string;
  modelId: string;
  modelName: string;
  healthState: HealthState;
  quotaRemainingPct: number; // 0..1
  benchTtftMs?: number;
  benchP95LatencyMs?: number;
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
  };
}
