export type TaskType = 'coding_agent' | 'chatbot' | 'batch' | 'research' | 'general';

export type LatencyPreference = 'instant' | 'relaxed';

export type BudgetPreference = 'free' | 'capped' | 'unlimited';

export type ExhaustionPreference = 'fill_first' | 'preserve_backup';

export type ReliabilityPreference = 'standard' | 'maximum';

export type RoutingPolicyName = 'fill_first' | 'balanced' | 'fastest' | 'cheapest' | 'auto_score';

export type HealthState = 'closed' | 'open' | 'half_open';

export type ConnectionTier = 'free' | 'paid' | 'subscription';

export type ConnectionStatus = 'untested' | 'healthy' | 'unavailable' | 'expired' | 'banned' | 'revoked' | 'deleted' | 'active';

export type StepRole = 'primary' | 'backup' | 'overflow';

export interface DecisionTraceEntry {
  stepIndex: number;
  connectionId: string;
  providerSlug: string;
  modelId: string;
  status: 'selected' | 'skipped' | 'attempted_failed';
  reason?: string;
  scores?: Record<string, number>;
  latencyMs?: number;
  error?: string;
}
