import { GoalInput, CandidateSource, PoolPlan, PoolPlanStep, GapSuggestion } from './types.js';
import { RoutingPolicyName } from '../../shared/types.js';

export function solveGoal(goal: GoalInput, candidates: CandidateSource[]): PoolPlan {
  const decisionTrace: string[] = [];
  const warnings: string[] = [];

  const targetTokens = goal.targetTokensPerDay || 1000000;
  const targetRequests = goal.targetRequestsPerDay || 1000;
  const safetyMarginPct = goal.safetyMarginPct ?? 20;
  const marginMultiplier = 1 + safetyMarginPct / 100;
  const marginedTargetTokens = targetTokens * marginMultiplier;
  const marginedTargetRequests = targetRequests * marginMultiplier;

  decisionTrace.push(`Solving goal for task '${goal.taskType}' with target ${targetRequests} req/day, ${targetTokens} tokens/day (margin ${safetyMarginPct}%)`);

  // 1. Filter Phase
  const MIN_FITNESS = 0.4;
  const qualityThreshold = goal.targetQuality ? goal.targetQuality / 100 : MIN_FITNESS;

  const eligible = candidates.filter((c) => {
    if (c.currentHealthState === 'open') {
      decisionTrace.push(`Filtered out connection ${c.connectionId} (${c.providerSlug}): health state is open`);
      return false;
    }
    if (c.taskFitness < MIN_FITNESS || (goal.targetQuality && c.taskFitness < qualityThreshold)) {
      decisionTrace.push(`Filtered out model ${c.modelName} (${c.providerSlug}): fitness ${c.taskFitness} < required ${qualityThreshold}`);
      return false;
    }
    if (goal.maxLatency && c.benchTtftMs > goal.maxLatency) {
      decisionTrace.push(`Filtered out model ${c.modelName} (${c.providerSlug}): TTFT ${c.benchTtftMs}ms exceeds maxLatency threshold ${goal.maxLatency}ms`);
      return false;
    }
    if (goal.minAvailability && goal.minAvailability > 99.0 && c.currentHealthState !== 'closed') {
      decisionTrace.push(`Filtered out connection ${c.connectionId} (${c.providerSlug}): state ${c.currentHealthState} does not satisfy minAvailability ${goal.minAvailability}%`);
      return false;
    }
    if (goal.budgetPref === 'free' && c.tier !== 'free') {
      decisionTrace.push(`Filtered out connection ${c.connectionId} (${c.providerSlug}): budget preference is 'free' but connection tier is '${c.tier}'`);
      return false;
    }
    return true;
  });

  if (eligible.length === 0) {
    decisionTrace.push('Infeasible plan: 0 eligible candidate connections match task type and constraint preferences');
    return {
      steps: [],
      policy: selectPolicy(goal),
      projectedDailyTokenCapacity: 0,
      projectedDailyRequestCapacity: 0,
      confidenceScore: 0,
      feasible: false,
      estimatedMonthlyCostUsd: 0,
      decisionTrace,
      warnings: ['No active or healthy provider connections match the required task type, quality, latency, or budget constraints.'],
    };
  }

  // Check provider diversity
  const uniqueProviders = new Set(eligible.map((c) => c.providerId));
  if (uniqueProviders.size === 1) {
    warnings.push(`Only 1 provider (${eligible[0].providerDisplayName}) covers your task requirements; lack of provider diversity increases failure risk.`);
  }

  // Check for missing quota policies
  const unconstrainedCandidates = eligible.filter((c) => c.hasTokenQuotaPolicy === false || c.hasRequestQuotaPolicy === false);
  if (unconstrainedCandidates.length > 0) {
    warnings.push('One or more candidate connections lack explicit quota limits; capacity projections assume untracked capacity.');
  }

  // 2. Fitness-order candidates
  const ordered = [...eligible].sort((a, b) => {
    const scoreA = calculateCandidateScore(a, goal);
    const scoreB = calculateCandidateScore(b, goal);
    return scoreB - scoreA;
  });

  // 3. Greedy Set-Cover (Deduplicate per-connection capacity)
  const selectedSteps: PoolPlanStep[] = [];
  const coveredConnections = new Set<string>();
  let coveredTokens = 0;
  let coveredRequests = 0;
  let orderIndex = 0;

  for (const candidate of ordered) {
    if (coveredTokens >= marginedTargetTokens && coveredRequests >= marginedTargetRequests) {
      break;
    }

    selectedSteps.push({
      candidate,
      role: 'primary',
      orderIndex: orderIndex++,
      weight: 1.0,
      reason: `Primary cover: fitness ${candidate.taskFitness.toFixed(2)}, speed ${candidate.benchTtftMs}ms`,
    });

    if (!coveredConnections.has(candidate.connectionId)) {
      coveredConnections.add(candidate.connectionId);
      const candTokens = candidate.dailyTokenCapacity > 0
        ? candidate.dailyTokenCapacity
        : (candidate.hasTokenQuotaPolicy === false ? 5000000 : 0);
      const candRequests = candidate.dailyRequestCapacity > 0
        ? candidate.dailyRequestCapacity
        : (candidate.hasRequestQuotaPolicy === false ? 2000 : 0);

      coveredTokens += candTokens;
      coveredRequests += candRequests;
      decisionTrace.push(`Selected primary target ${candidate.providerSlug}/${candidate.modelName} (added connection capacity +${candTokens} tokens/day)`);
    } else {
      decisionTrace.push(`Selected primary target ${candidate.providerSlug}/${candidate.modelName} (shares existing connection capacity)`);
    }
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
  let feasible = confidenceScore >= 1.0;

  if (feasible && (coveredTokens < marginedTargetTokens || coveredRequests < marginedTargetRequests)) {
    warnings.push(`Plan satisfies 100% of base target demand but does not achieve full ${safetyMarginPct}% safety margin headroom.`);
  }

  let gapSuggestion: GapSuggestion | undefined;
  if (!feasible && goal.budgetPref === 'free') {
    const remainingTokenGap = Math.max(0, marginedTargetTokens - coveredTokens);
    const remainingRequestGap = Math.max(0, marginedTargetRequests - coveredRequests);

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

  // 6. Cost Estimation based on Target Volume
  const primarySteps = selectedSteps.filter((s) => s.role === 'primary');
  const paidPrimarySteps = primarySteps.filter((s) => s.candidate.tier !== 'free');
  let estimatedMonthlyCostUsd = 0;

  if (paidPrimarySteps.length > 0) {
    const monthlyTokensToCover = targetTokens * 30;
    const stepTokenAllocation = monthlyTokensToCover / paidPrimarySteps.length;
    estimatedMonthlyCostUsd = paidPrimarySteps.reduce((acc, step) => {
      return acc + (stepTokenAllocation / 1000) * step.candidate.costPer1kTokensUsd;
    }, 0);
  }

  // Evaluate monthly budget cap
  if (goal.budgetPref === 'capped' && goal.budgetCapUsdMonthly != null) {
    if (estimatedMonthlyCostUsd > goal.budgetCapUsdMonthly) {
      warnings.push(`Projected monthly cost ($${estimatedMonthlyCostUsd.toFixed(2)}) exceeds monthly budget cap of $${goal.budgetCapUsdMonthly.toFixed(2)}.`);
      feasible = false;
    }
  }

  const policy = selectPolicy(goal);
  decisionTrace.push(`Selected pool routing policy '${policy}' based on goal preferences`);

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
  if (goal.exhaustionPref === 'preserve_backup') return 'balanced';
  if (goal.latencyPref === 'instant') return 'fastest';
  if (goal.budgetPref === 'capped') return 'cheapest';
  return 'auto_score';
}
