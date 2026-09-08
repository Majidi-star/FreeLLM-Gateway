import { describe, it, expect } from 'vitest';
import { solveGoal, selectPolicy } from './solver.js';
import { CandidateSource, GoalInput } from './types.js';

describe('GoalSolver Engine', () => {
  const mockCandidates: CandidateSource[] = [
    {
      connectionId: 'conn_groq_1',
      providerId: 'prov_groq',
      providerSlug: 'groq',
      providerDisplayName: 'Groq Cloud',
      providerBaseUrl: 'https://api.groq.com/openai/v1',
      providerProtocol: 'openai',
      modelId: 'mdl_groq_llama',
      modelName: 'llama-3.3-70b-versatile',
      modelDisplayName: 'Llama 3.3 70B',
      tier: 'free',
      dailyTokenCapacity: 5000000,
      dailyRequestCapacity: 2000,
      costPerRequestUsd: 0,
      costPer1kTokensUsd: 0,
      benchTps: 280,
      benchTtftMs: 220,
      benchP95LatencyMs: 850,
      taskFitness: 0.9,
      currentHealthState: 'closed',
    },
    {
      connectionId: 'conn_cerebras_1',
      providerId: 'prov_cerebras',
      providerSlug: 'cerebras',
      providerDisplayName: 'Cerebras',
      providerBaseUrl: 'https://api.cerebras.ai/v1',
      providerProtocol: 'openai',
      modelId: 'mdl_cerebras_llama',
      modelName: 'llama3.1-70b',
      modelDisplayName: 'Cerebras Llama 3.1 70B',
      tier: 'free',
      dailyTokenCapacity: 8000000,
      dailyRequestCapacity: 3000,
      costPerRequestUsd: 0,
      costPer1kTokensUsd: 0,
      benchTps: 1800,
      benchTtftMs: 90,
      benchP95LatencyMs: 250,
      taskFitness: 0.88,
      currentHealthState: 'closed',
    },
    {
      connectionId: 'conn_deepseek_1',
      providerId: 'prov_deepseek',
      providerSlug: 'deepseek',
      providerDisplayName: 'DeepSeek Platform',
      providerBaseUrl: 'https://api.deepseek.com/v1',
      providerProtocol: 'openai',
      modelId: 'mdl_deepseek_v3',
      modelName: 'deepseek-chat',
      modelDisplayName: 'DeepSeek V3',
      tier: 'paid',
      dailyTokenCapacity: 20000000,
      dailyRequestCapacity: 10000,
      costPerRequestUsd: 0.0003,
      costPer1kTokensUsd: 0.0002,
      benchTps: 85,
      benchTtftMs: 450,
      benchP95LatencyMs: 1200,
      taskFitness: 0.98,
      currentHealthState: 'closed',
    },
  ];

  it('(a) solves trivially feasible goal with abundant free capacity', () => {
    const goal: GoalInput = {
      taskType: 'coding_agent',
      targetRequestsPerDay: 4000,
      targetTokensPerDay: 10000000,
      latencyPref: 'relaxed',
      budgetPref: 'free',
      exhaustionPref: 'preserve_backup',
      reliabilityPref: 'standard',
    };

    const plan = solveGoal(goal, mockCandidates);

    expect(plan.feasible).toBe(true);
    expect(plan.confidenceScore).toBeGreaterThanOrEqual(1.0);
    expect(plan.steps.length).toBeGreaterThanOrEqual(2);
    expect(plan.steps.every((s) => s.candidate.tier === 'free')).toBe(true);
    expect(plan.policy).toBe('balanced');
  });

  it('(b) generates gap suggestion for infeasible free goal', () => {
    const goal: GoalInput = {
      taskType: 'coding_agent',
      targetRequestsPerDay: 20000, // Demands 20k requests, free pool only has 5k
      targetTokensPerDay: 50000000,
      budgetPref: 'free',
    };

    const plan = solveGoal(goal, mockCandidates);

    expect(plan.feasible).toBe(false);
    expect(plan.gapSuggestion).toBeDefined();
    expect(plan.gapSuggestion?.candidate.providerSlug).toBe('deepseek');
  });

  it('(c) reliabilityPref: maximum adds diverse backups', () => {
    const goal: GoalInput = {
      taskType: 'coding_agent',
      targetRequestsPerDay: 1000,
      targetTokensPerDay: 1000000,
      budgetPref: 'free',
      reliabilityPref: 'maximum',
    };

    const plan = solveGoal(goal, mockCandidates);

    const roles = plan.steps.map((s) => s.role);
    expect(roles).toContain('backup');

    const primaryProviderId = plan.steps.find((s) => s.role === 'primary')?.candidate.providerId;
    const backupProviderId = plan.steps.find((s) => s.role === 'backup')?.candidate.providerId;
    expect(backupProviderId).not.toBe(primaryProviderId);
  });

  it('(d) exhaustionPref produces different policies', () => {
    const goalFillFirst: GoalInput = { taskType: 'chatbot', exhaustionPref: 'fill_first' };
    const goalBalanced: GoalInput = { taskType: 'chatbot', exhaustionPref: 'preserve_backup', reliabilityPref: 'standard' };

    expect(selectPolicy(goalFillFirst)).toBe('fill_first');
    expect(selectPolicy(goalBalanced)).toBe('balanced');
  });

  it('(e) empty candidate pool returns clean infeasible result', () => {
    const goal: GoalInput = { taskType: 'general' };
    const plan = solveGoal(goal, []);

    expect(plan.feasible).toBe(false);
    expect(plan.steps.length).toBe(0);
    expect(plan.confidenceScore).toBe(0);
  });
});
