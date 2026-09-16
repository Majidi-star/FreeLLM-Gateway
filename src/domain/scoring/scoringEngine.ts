import { ScoringCandidate, FactorWeights, ScoreBreakdown, ScoringOptions } from './types.js';

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

  public scoreCandidate(
    candidate: ScoringCandidate,
    allCandidates: ScoringCandidate[],
    options?: ScoringOptions
  ): ScoreBreakdown {
    const weights = this.normalizeWeights({ ...DEFAULT_FACTOR_WEIGHTS, ...this.customWeights });

    // 1. Quota headroom score (0..1)
    const quotaScore = Math.max(0, Math.min(1, candidate.quotaRemainingPct));

    // 2. Health score (1 for closed, 0.5 for half_open, 0 for open)
    const healthScore = candidate.healthState === 'closed' ? 1.0 : candidate.healthState === 'half_open' ? 0.5 : 0.0;

    // 3. Advanced 3-Tier Latency & Throughput Engine (TTFT vs ITL + Prefill/Decode + Mode Awareness + Concurrency Backpressure)
    const isStreaming = options?.isStreaming ?? true;
    const tokensIn = options?.estimatedPromptTokens ?? 1000;
    const tokensOut = options?.estimatedCompletionTokens ?? 200;

    // Baseline TTFT (Time to First Token) & ITL (Inter-Token Latency in ms/token)
    const baseTtftMs = candidate.benchTtftMs ?? 200;
    const tps = candidate.benchTps ?? 50;
    const itlMs = 1000 / Math.max(1, tps);

    // Prefill scaling penalty: 0.01ms per input token over baseline
    const prefillTtftMs = baseTtftMs + (tokensIn * 0.01);
    const decodeTimeMs = tokensOut * itlMs;
    const totalExecutionTimeMs = prefillTtftMs + decodeTimeMs;

    // Concurrency Backpressure Multiplier
    const activeInFlight = candidate.inFlightRequests ?? 0;
    const backpressureMultiplier = 1 + (activeInFlight * 0.15);
    const effectiveLatencyMs = (isStreaming ? prefillTtftMs : totalExecutionTimeMs) * backpressureMultiplier;

    const maxLatencyMs = Math.max(
      ...allCandidates.map((c) => {
        const cBaseTtft = c.benchTtftMs ?? 200;
        const cTps = c.benchTps ?? 50;
        const cItl = 1000 / Math.max(1, cTps);
        const cPrefill = cBaseTtft + (tokensIn * 0.01);
        const cTotal = cPrefill + (tokensOut * cItl);
        const cInFlight = c.inFlightRequests ?? 0;
        return (isStreaming ? cPrefill : cTotal) * (1 + cInFlight * 0.15);
      }),
      500
    );

    const latencyScore = Math.max(0, Math.min(1, 1 - effectiveLatencyMs / (maxLatencyMs * 1.2)));

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

  public rankCandidates(
    candidates: ScoringCandidate[],
    options?: ScoringOptions
  ): Array<{ candidate: ScoringCandidate; score: ScoreBreakdown }> {
    return candidates
      .map((candidate) => ({
        candidate,
        score: this.scoreCandidate(candidate, candidates, options),
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
