import { PoolStepInfo, RoutingPolicyFunction } from '../types.js';
import { ScoringEngine } from '../../scoring/scoringEngine.js';
import { ScoringCandidate } from '../../scoring/types.js';

export const autoScorePolicy: RoutingPolicyFunction = (steps: PoolStepInfo[]): PoolStepInfo[] => {
  const engine = new ScoringEngine();

  const candidates: ScoringCandidate[] = steps.map((s) => ({
    connectionId: s.connectionId,
    providerSlug: s.providerSlug,
    modelId: s.modelId,
    modelName: s.modelName,
    healthState: s.healthState,
    quotaRemainingPct: s.quotaRemainingPct,
    benchTtftMs: s.benchTtftMs,
    benchP95LatencyMs: s.benchP95LatencyMs,
    taskFitness: s.taskFitness,
    costPer1kUsd: s.costPer1kUsd,
  }));

  const ranked = engine.rankCandidates(candidates);
  const rankedConnectionIds = ranked.map((r) => r.candidate.connectionId);

  return [...steps].sort((a, b) => {
    const indexA = rankedConnectionIds.indexOf(a.connectionId);
    const indexB = rankedConnectionIds.indexOf(b.connectionId);
    return indexA - indexB;
  });
};
