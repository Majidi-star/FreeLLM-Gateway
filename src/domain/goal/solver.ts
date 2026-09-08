import { GoalInput, CandidateSource, PoolPlan, PoolPlanStep, GapSuggestion } from './types.js';
import { RoutingPolicyName } from '../../shared/types.js';

export function solveGoal(goal: GoalInput, candidates: CandidateSource[]): PoolPlan {
  const decisionTrace: string[] = [];
  const warnings: string[] = [];

  const targetTokens = goal.targetTokensPerDay || 1000000;
  const targetRequests = goal.targetRequestsPerDay || 1000;
  const safetyMarginPct = goal.safetyMarginPct ?? 20;
  const marginMultiplier = 1 + safetyMarginPct / 100;

  decisionTrace.push(`Solving goal for task '${goal.taskType}' with target ${targetRequests} req/day, ${targetTokens} tokens/day (margin ${safetyMarginPct}%)`);

  // 1. Filter Phase
  const MIN_FITNESS = 0.4;
  const eligible = candidates.filter((c) => {
    if (c.currentHealthState === 'open') {
      decisionTrace.push(`Filtered out connection ${c.connectionId} (${c.providerSlug}): health state is open`);
      return false;
    }
    if (c.taskFitness < MIN_FITNESS) {
      decisionTrace.push(`Filtered out model ${c.modelName} (${c.providerSlug}): fitness ${c.taskFitness} < ${MIN_FITNESS}`);
      return false;
    }
    if (goal.budgetPref === 'free' && c.tier !== 'free') {
      decisionTrace.push(`Filtered out connection ${c.connectionId} (${c.providerSlug}): budget preference is 'free' but connection tier is '${c.tier}'`);
      return false;
    }
    return true;
  });

  if (eligible.length === 0) {
    decisionTrace.push('Infeasible plan: 0 eligible candidate connections match task type and budget preferences');
    return {
      steps: [],
      policy: selectPolicy(goal),
      projectedDailyTokenCapacity: 0,
      projectedDailyRequestCapacity: 0,
      confidenceScore: 0,
      feasible: false,
      estimatedMonthlyCostUsd: 0,
      decisionTrace,
      warnings: ['No active or healthy provider connections match the required task type and budget tier.'],
    };
  }

  // Check provider diversity
  const uniqueProviders = new Set(eligible.map((c) => c.providerId));
  if (uniqueProviders.size === 1) {
    warnings.push(`Only 1 provider (${eligible[0].providerDisplayName}) covers your task requirements; lack of provider diversity increases failure risk.`);
  }

  // 2. Fitness-order candidates
  const ordered = [...eligible].sort((a, b) => {
    const scoreA = calculateCandidateScore(a, goal);
    const scoreB = calculateCandidateScore(b, goal);
    return scoreB - scoreA;
  });

  // 3. Greedy Set-Cover
  const selectedSteps: PoolPlanStep[] = [];
  let coveredTokens = 0;
  let coveredRequests = 0;
  let orderIndex = 0;

  for (const candidate of ordered) {
    if (coveredTokens >= targetTokens * marginMultiplier && coveredRequests >= targetRequests * marginMultiplier) {
      break;
    }

    // Daily capacity default estimates if 0
    const candTokens = candidate.dailyTokenCapacity > 0 ? candidate.dailyTokenCapacity : 5000000;
    const candRequests = candidate.dailyRequestCapacity > 0 ? candidate.dailyRequestCapacity : 2000;

    selectedSteps.push({
      candidate,
      role: 'primary',
      orderIndex: orderIndex++,
      weight: 1.0,
      reason: `Primary cover: fitness ${candidate.taskFitness.toFixed(2)}, speed ${candidate.benchTtftMs}ms`,
    });

    coveredTokens += candTokens;
    coveredRequests += candRequests;
    decisionTrace.push(`Selected primary target ${candidate.providerSlug}/${candidate.modelName} (added capacity +${candTokens} tokens/day)`);
  }

  // 4. Reliability pass: Add backup capacity if maximum reliability requested
  if (goal.reliabilityPref === 'maximum') {
    const primaryProviderIds = new Set(selectedSteps.map((s) => s.candidate.providerId));
    const backupCandidates = ordered.filter((c) => !primaryProviderIds.has(c.providerId));

    for (const backup of backupCandidates.slice(0, 2)) {
      selectedSteps.push({
        candidate: backup,
        role: 'backup',
        orderIndex: orderIndex++,
        weight: 0.5,
        reason: 'Maximum reliability pass: added diverse provider backup',
      });
      decisionTrace.push(`Added backup target ${backup.providerSlug}/${backup.modelName} for cross-provider resilience`);
    }
  }

  // 5. Feasibility Verdict & Gap Suggestion
  const reqConfidence = coveredRequests / Math.max(targetRequests, 1);
  const tokenConfidence = coveredTokens / Math.max(targetTokens, 1);
  const confidenceScore = Math.min(reqConfidence, tokenConfidence);
  const feasible = confidenceScore >= 1.0;

  let gapSuggestion: GapSuggestion | undefined;
  if (!feasible && goal.budgetPref === 'free') {
    const remainingTokenGap = Math.max(0, targetTokens * marginMultiplier - coveredTokens);
    const remainingRequestGap = Math.max(0, targetRequests * marginMultiplier - coveredRequests);

    const paidCandidates = candidates.filter((c) => c.tier !== 'free' && c.taskFitness >= MIN_FITNESS && c.currentHealthState !== 'open');
    if (paidCandidates.length > 0) {
      const bestPaid = [...paidCandidates].sort((a, b) => a.costPer1kTokensUsd - b.costPer1kTokensUsd)[0];
      const estMonthlyUsd = (bestPaid.costPer1kTokensUsd * (remainingTokenGap / 1000)) * 30;

      gapSuggestion = {
        candidate: bestPaid,
        neededTokens: remainingTokenGap,
        neededRequests: remainingRequestGap,
        estimatedMonthlyCostUsd: estMonthlyUsd,
        reason: `Adding paid provider connection ${bestPaid.providerDisplayName} (${bestPaid.modelDisplayName}) closes remaining capacity gap for ~$${estMonthlyUsd.toFixed(2)}/mo.`,
      };
      decisionTrace.push(`Computed gap-closer suggestion: ${gapSuggestion.reason}`);
    }
  }

  const policy = selectPolicy(goal);
  decisionTrace.push(`Selected pool routing policy '${policy}' based on goal preferences`);

  const estimatedMonthlyCostUsd = selectedSteps.reduce((acc, step) => {
    if (step.candidate.tier === 'free') return acc;
    const tokensPerMonth = (step.candidate.dailyTokenCapacity || 1000000) * 30;
    return acc + (tokensPerMonth / 1000) * step.candidate.costPer1kTokensUsd;
  }, 0);

  return {
    steps: selectedSteps,
    policy,
    projectedDailyTokenCapacity: coveredTokens,
    projectedDailyRequestCapacity: coveredRequests,
    confidenceScore,
    feasible,
    estimatedMonthlyCostUsd,
    gapSuggestion,
    decisionTrace,
    warnings,
  };
}

function calculateCandidateScore(c: CandidateSource, goal: GoalInput): number {
  if (goal.latencyPref === 'instant') {
    // Latency weighted 60%, fitness 40%
    const speedScore = 1 - Math.min(1, c.benchTtftMs / 1000);
    return speedScore * 0.6 + c.taskFitness * 0.4;
  } else {
    // Task fitness weighted 70%, latency 30%
    const speedScore = 1 - Math.min(1, c.benchTtftMs / 2000);
    return c.taskFitness * 0.7 + speedScore * 0.3;
  }
}

export function selectPolicy(goal: GoalInput): RoutingPolicyName {
  if (goal.exhaustionPref === 'fill_first') return 'fill_first';
  if (goal.reliabilityPref === 'maximum') return 'auto_score';
  if (goal.latencyPref === 'instant') return 'fastest';
  if (goal.budgetPref === 'capped') return 'cheapest';
  if (goal.exhaustionPref === 'preserve_backup' && goal.reliabilityPref === 'standard') return 'balanced';
  return 'auto_score';
}
