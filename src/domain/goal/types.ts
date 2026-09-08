import {
  TaskType,
  LatencyPreference,
  BudgetPreference,
  ExhaustionPreference,
  ReliabilityPreference,
  RoutingPolicyName,
  StepRole,
} from '../../shared/types.js';

export interface GoalInput {
  taskType: TaskType;
  targetRequestsPerDay?: number;
  targetTokensPerDay?: number;
  latencyPref?: LatencyPreference;
  budgetPref?: BudgetPreference;
  budgetCapUsdMonthly?: number;
  exhaustionPref?: ExhaustionPreference;
  reliabilityPref?: ReliabilityPreference;
  safetyMarginPct?: number; // default 20
}

export interface CandidateSource {
  connectionId: string;
  providerId: string;
  providerSlug: string;
  providerDisplayName: string;
  providerBaseUrl: string;
  providerProtocol: 'openai' | 'anthropic' | 'gemini' | 'custom';
  modelId: string;
  modelName: string;
  modelDisplayName: string;
  tier: 'free' | 'paid' | 'subscription';
  dailyTokenCapacity: number;
  dailyRequestCapacity: number;
  costPerRequestUsd: number;
  costPer1kTokensUsd: number;
  benchTps: number;
  benchTtftMs: number;
  benchP95LatencyMs: number;
  taskFitness: number; // 0..1 for current taskType
  currentHealthState: 'closed' | 'open' | 'half_open';
}

export interface PoolPlanStep {
  candidate: CandidateSource;
  role: StepRole;
  orderIndex: number;
  weight: number;
  reason: string;
}

export interface GapSuggestion {
  candidate: CandidateSource;
  neededTokens: number;
  neededRequests: number;
  estimatedMonthlyCostUsd: number;
  reason: string;
}

export interface PoolPlan {
  steps: PoolPlanStep[];
  policy: RoutingPolicyName;
  projectedDailyTokenCapacity: number;
  projectedDailyRequestCapacity: number;
  confidenceScore: number;
  feasible: boolean;
  estimatedMonthlyCostUsd: number;
  gapSuggestion?: GapSuggestion;
  decisionTrace: string[];
  warnings: string[];
}
