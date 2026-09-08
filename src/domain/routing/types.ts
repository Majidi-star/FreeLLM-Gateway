import { StepRole, RoutingPolicyName, HealthState } from '../../shared/types.js';

export interface PoolStepInfo {
  id: string;
  poolId: string;
  orderIndex: number;
  connectionId: string;
  providerSlug: string;
  providerBaseUrl: string;
  providerProtocol: 'openai' | 'anthropic' | 'gemini' | 'custom';
  modelId: string;
  modelName: string;
  role: StepRole;
  weight: number;
  healthState: HealthState;
  isCooldownActive: boolean;
  quotaRemainingPct: number; // 0..1
  benchTtftMs?: number;
  benchP95LatencyMs?: number;
  costPer1kUsd: number;
  taskFitness: number;
}

export type RoutingPolicyFunction = (steps: PoolStepInfo[]) => PoolStepInfo[];
