import { ScoringCandidate, FactorWeights, ScoreBreakdown } from './types.js';

export const DEFAULT_FACTOR_WEIGHTS: FactorWeights = {
  quotaHeadroom: 0.25,
  health: 0.25,
  latencyFit: 0.20,
  taskFit: 0.15,
  costEfficiency: 0.10,
  stability: 0.05,
};

export class ScoringEngine {
  constructor(private customWeights?: Partial<FactorWeights>) {}

  public scoreCandidate(candidate: ScoringCandidate, allCandidates: ScoringCandidate[]): ScoreBreakdown {
    const weights = this.normalizeWeights({ ...DEFAULT_FACTOR_WEIGHTS, ...this.customWeights });

    // 1. Quota headroom score (0..1)
    const quotaScore = Math.max(0, Math.min(1, candidate.quotaRemainingPct));

    // 2. Health score (1 for closed, 0.5 for half_open, 0 for open)
    const healthScore = candidate.healthState === 'closed' ? 1.0 : candidate.healthState === 'half_open' ? 0.5 : 0.0;

    // 3. Latency fit (normalized inverse p95 latency relative to max in pool)
    const maxP95 = Math.max(...allCandidates.map((c) => c.benchP95LatencyMs || 1000), 100);
    const candidateP95 = candidate.benchP95LatencyMs || 1000;
    const latencyScore = Math.max(0, Math.min(1, 1 - candidateP95 / (maxP95 * 1.2)));

    // 4. Task fit (0..1 from catalog)
    const taskScore = Math.max(0, Math.min(1, candidate.taskFitness));

    // 5. Cost efficiency (inverse cost normalized relative to max cost in pool)
    const maxCost = Math.max(...allCandidates.map((c) => c.costPer1kUsd || 0.001), 0.001);
    const candidateCost = candidate.costPer1kUsd || 0;
    const costScore = maxCost > 0 ? Math.max(0, Math.min(1, 1 - candidateCost / (maxCost * 1.5))) : 1.0;

    // 6. Stability (fixed or derived from latency variance)
    const stabilityScore = 0.9;

    const compositeScore =
      quotaScore * weights.quotaHeadroom +
      healthScore * weights.health +
      latencyScore * weights.latencyFit +
      taskScore * weights.taskFit +
      costScore * weights.costEfficiency +
      stabilityScore * weights.stability;

    return {
      compositeScore,
      factorScores: {
        quotaHeadroom: quotaScore,
        health: healthScore,
        latencyFit: latencyScore,
        taskFit: taskScore,
        costEfficiency: costScore,
        stability: stabilityScore,
      },
    };
  }

  public rankCandidates(candidates: ScoringCandidate[]): Array<{ candidate: ScoringCandidate; score: ScoreBreakdown }> {
    return candidates
      .map((candidate) => ({
        candidate,
        score: this.scoreCandidate(candidate, candidates),
      }))
      .sort((a, b) => b.score.compositeScore - a.score.compositeScore);
  }

  private normalizeWeights(weights: FactorWeights): FactorWeights {
    const sum =
      weights.quotaHeadroom +
      weights.health +
      weights.latencyFit +
      weights.taskFit +
      weights.costEfficiency +
      weights.stability;

    if (sum === 0) return DEFAULT_FACTOR_WEIGHTS;

    return {
      quotaHeadroom: weights.quotaHeadroom / sum,
      health: weights.health / sum,
      latencyFit: weights.latencyFit / sum,
      taskFit: weights.taskFit / sum,
      costEfficiency: weights.costEfficiency / sum,
      stability: weights.stability / sum,
    };
  }
}
