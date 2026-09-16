import { ScoringCandidate, FactorWeights, ScoreBreakdown } from './types.js';

export const DEFAULT_FACTOR_WEIGHTS: FactorWeights = {
  quotaHeadroom: 0.20,
  health: 0.20,
  latencyFit: 0.20,
  benchmarkFit: 0.20,
  taskFit: 0.10,
  costEfficiency: 0.05,
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

    // 3. Latency & Throughput fit (combines TTFT, TPS, and P95 latency)
    // Formula: Latency penalty L(p) = TTFT + (100 tokens / TPS)
    const ttft = candidate.benchTtftMs ?? candidate.benchP95LatencyMs ?? 500;
    const tps = candidate.benchTps ?? 50;
    const estimatedLatencyMs = ttft + (100 / Math.max(1, tps)) * 1000;

    const maxLatencyMs = Math.max(
      ...allCandidates.map((c) => {
        const cTtft = c.benchTtftMs ?? c.benchP95LatencyMs ?? 500;
        const cTps = c.benchTps ?? 50;
        return cTtft + (100 / Math.max(1, cTps)) * 1000;
      }),
      1000
    );
    const latencyScore = Math.max(0, Math.min(1, 1 - estimatedLatencyMs / (maxLatencyMs * 1.2)));

    // 4. Benchmark Intelligence Fit (normalized 0..1 composite score across available benchmarks)
    const benchmarks = [
      candidate.benchReasoningScore,
      candidate.benchCodingScore,
      candidate.benchCommandScore,
      candidate.benchMathScore,
      candidate.benchVisionScore,
      candidate.benchLongContextScore,
    ].filter((b): b is number => typeof b === 'number' && Number.isFinite(b));

    const benchmarkScore = benchmarks.length > 0
      ? (benchmarks.reduce((sum, val) => sum + val, 0) / benchmarks.length) / 100
      : candidate.taskFitness;

    // 5. Task fit (0..1 from catalog)
    const taskScore = Math.max(0, Math.min(1, candidate.taskFitness));

    // 6. Cost efficiency (inverse cost normalized relative to max cost in pool)
    const maxCost = Math.max(...allCandidates.map((c) => c.costPer1kUsd || 0.001), 0.001);
    const candidateCost = candidate.costPer1kUsd || 0;
    const costScore = maxCost > 0 ? Math.max(0, Math.min(1, 1 - candidateCost / (maxCost * 1.5))) : 1.0;

    // 7. Stability
    const stabilityScore = 0.9;

    const compositeScore =
      quotaScore * weights.quotaHeadroom +
      healthScore * weights.health +
      latencyScore * weights.latencyFit +
      benchmarkScore * weights.benchmarkFit +
      taskScore * weights.taskFit +
      costScore * weights.costEfficiency +
      stabilityScore * weights.stability;

    return {
      compositeScore,
      factorScores: {
        quotaHeadroom: quotaScore,
        health: healthScore,
        latencyFit: latencyScore,
        benchmarkFit: benchmarkScore,
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
      weights.benchmarkFit +
      weights.taskFit +
      weights.costEfficiency +
      weights.stability;

    if (sum === 0) return DEFAULT_FACTOR_WEIGHTS;

    return {
      quotaHeadroom: weights.quotaHeadroom / sum,
      health: weights.health / sum,
      latencyFit: weights.latencyFit / sum,
      benchmarkFit: weights.benchmarkFit / sum,
      taskFit: weights.taskFit / sum,
      costEfficiency: weights.costEfficiency / sum,
      stability: weights.stability / sum,
    };
  }
}
