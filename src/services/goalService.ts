import { GoalRepository, GoalRecord } from '../infra/db/repositories/goalRepo.js';
import { ConnectionRepository } from '../infra/db/repositories/connectionRepo.js';
import { ProviderRepository } from '../infra/db/repositories/providerRepo.js';
import { ModelRepository } from '../infra/db/repositories/modelRepo.js';
import { HealthRepository } from '../infra/db/repositories/healthRepo.js';
import { QuotaRepository } from '../infra/db/repositories/quotaRepo.js';
import { solveGoal } from '../domain/goal/solver.js';
import { GoalInput, CandidateSource, PoolPlan } from '../domain/goal/types.js';
import { NotFoundError } from '../shared/errors.js';

export class GoalService {
  constructor(
    private goalRepo: GoalRepository,
    private connectionRepo: ConnectionRepository,
    private providerRepo: ProviderRepository,
    private modelRepo: ModelRepository,
    private healthRepo: HealthRepository,
    private quotaRepo: QuotaRepository
  ) {}

  public createGoal(input: Omit<GoalRecord, 'id' | 'created_at' | 'updated_at'>): GoalRecord {
    return this.goalRepo.create(input);
  }

  public listGoals(): GoalRecord[] {
    return this.goalRepo.listAll();
  }

  public getGoal(id: string): GoalRecord {
    const goal = this.goalRepo.findById(id);
    if (!goal) throw new NotFoundError(`Goal with ID '${id}' not found`);
    return goal;
  }

  public solveGoalById(goalId: string): PoolPlan {
    const goalRecord = this.getGoal(goalId);
    const goalInput: GoalInput = {
      taskType: goalRecord.task_type,
      targetRequestsPerDay: goalRecord.target_requests_per_day || undefined,
      targetTokensPerDay: goalRecord.target_tokens_per_day || undefined,
      latencyPref: goalRecord.latency_pref,
      budgetPref: goalRecord.budget_pref,
      budgetCapUsdMonthly: goalRecord.budget_cap_usd_monthly || undefined,
      exhaustionPref: goalRecord.exhaustion_pref,
      reliabilityPref: goalRecord.reliability_pref,
      safetyMarginPct: goalRecord.safety_margin_pct,
    };

    const candidateSources = this.buildCandidateSources(goalRecord.task_type);
    return solveGoal(goalInput, candidateSources);
  }

  private buildCandidateSources(taskType: string): CandidateSource[] {
    const connections = this.connectionRepo.listAll();
    const candidates: CandidateSource[] = [];

    for (const conn of connections) {
      if (conn.status === 'banned' || conn.status === 'expired') continue;

      const provider = this.providerRepo.findById(conn.provider_id);
      if (!provider || !provider.is_active) continue;

      const models = this.modelRepo.listByProviderId(provider.id);
      const health = this.healthRepo.get(conn.id);
      const tokenPolicy = this.quotaRepo.getPolicy(conn.id, 'daily_tokens');
      const reqPolicy = this.quotaRepo.getPolicy(conn.id, 'daily_requests');

      for (const model of models) {
        const taskFitnessMap = JSON.parse(model.task_fitness || '{}');
        const fitness = taskFitnessMap[taskType] ?? 0.5;

        candidates.push({
          connectionId: conn.id,
          providerId: provider.id,
          providerSlug: provider.slug,
          providerDisplayName: provider.display_name,
          providerBaseUrl: provider.base_url,
          providerProtocol: provider.protocol,
          modelId: model.id,
          modelName: model.model_name,
          modelDisplayName: model.display_name,
          tier: conn.tier,
          dailyTokenCapacity: tokenPolicy ? tokenPolicy.limit_value : 5000000,
          dailyRequestCapacity: reqPolicy ? reqPolicy.limit_value : 2000,
          costPerRequestUsd: 0,
          costPer1kTokensUsd: model.cost_input_per_1k + model.cost_output_per_1k,
          benchTps: model.bench_tps || 100,
          benchTtftMs: model.bench_ttft_ms || 200,
          benchP95LatencyMs: model.bench_p95_latency_ms || 800,
          taskFitness: fitness,
          currentHealthState: health ? health.state : 'closed',
        });
      }
    }

    return candidates;
  }
}
