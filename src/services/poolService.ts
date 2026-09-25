import { PoolRepository, PoolRecord, PoolStepRecord } from '../infra/db/repositories/poolRepo.js';
import { ModelRepository } from '../infra/db/repositories/modelRepo.js';
import { ProviderRepository } from '../infra/db/repositories/providerRepo.js';
import { ConnectionRepository } from '../infra/db/repositories/connectionRepo.js';
import { GoalService } from './goalService.js';
import { RoutingPolicyName, StepRole } from '../shared/types.js';
import { NotFoundError } from '../shared/errors.js';

export interface DetailedPoolStep extends PoolStepRecord {
  modelName?: string;
  modelDisplayName?: string;
  providerSlug?: string;
  providerDisplayName?: string;
}

export interface PoolDTO {
  id: string;
  goalId: string | null;
  name: string;
  policy: RoutingPolicyName;
  isActive: boolean;
  steps: DetailedPoolStep[];
  createdAt: number;
  updatedAt?: number;
  goalName?: string | null;
}

export class PoolService {
  constructor(
    private poolRepo: PoolRepository,
    private goalService: GoalService,
    private modelRepo?: ModelRepository,
    private providerRepo?: ProviderRepository,
    private connectionRepo?: ConnectionRepository
  ) {}

  public createPoolFromGoal(goalId: string, poolName?: string, accountId?: string | null): PoolDTO {
    const goal = this.goalService.getGoal(goalId);
    const plan = this.goalService.solveGoalById(goalId);

    if (plan.steps.length === 0) {
      throw new Error(`Cannot create pool from goal '${goalId}': GoalSolver produced 0 steps.`);
    }

    const name = poolName || `Pool for ${goal.name}`;

    const stepInputs = plan.steps.map((step) => ({
      order_index: step.orderIndex,
      connection_id: step.candidate.connectionId,
      model_id: step.candidate.modelId,
      role: step.role,
      weight: step.weight,
    }));

    const result = this.poolRepo.createPool(
      {
        goal_id: goalId,
        name,
        policy: plan.policy,
        is_active: 1,
        account_id: accountId ?? goal.account_id ?? null,
      },
      stepInputs
    );

    return this.toDTO(result.pool, result.steps);
  }

  public createCustomPool(input: {
    name: string;
    policy?: RoutingPolicyName;
    goalId?: string | null;
    accountId?: string | null;
    steps: Array<{
      connectionId: string;
      modelId: string;
      role?: StepRole;
      weight?: number;
      orderIndex?: number;
    }>;
  }): PoolDTO {
    const stepInputs = input.steps.map((step, idx) => ({
      order_index: step.orderIndex ?? idx,
      connection_id: step.connectionId,
      model_id: step.modelId,
      role: step.role || 'primary',
      weight: step.weight ?? 1.0,
    }));

    const result = this.poolRepo.createPool(
      {
        goal_id: input.goalId || null,
        name: input.name,
        policy: input.policy || 'balanced',
        is_active: 1,
        account_id: input.accountId || null,
      },
      stepInputs
    );

    return this.toDTO(result.pool, result.steps);
  }

  public regeneratePoolFromGoal(poolId: string): PoolDTO {
    const pool = this.poolRepo.findPoolById(poolId);
    if (!pool) throw new NotFoundError(`Pool with ID '${poolId}' not found`);
    if (!pool.goal_id) throw new Error(`Pool '${poolId}' is not associated with a Goal.`);

    const plan = this.goalService.solveGoalById(pool.goal_id);
    if (plan.steps.length === 0) {
      throw new Error(`GoalSolver produced 0 steps for goal '${pool.goal_id}'.`);
    }

    const stepInputs = plan.steps.map((step) => ({
      order_index: step.orderIndex,
      connection_id: step.candidate.connectionId,
      model_id: step.candidate.modelId,
      role: step.role,
      weight: step.weight,
    }));

    this.poolRepo.updatePool(poolId, { policy: plan.policy });
    const updatedSteps = this.poolRepo.replacePoolSteps(poolId, stepInputs);
    const updatedPool = this.poolRepo.findPoolById(poolId)!;

    return this.toDTO(updatedPool, updatedSteps);
  }

  public getPool(id: string): PoolDTO {
    const pool = this.poolRepo.findPoolById(id);
    if (!pool) throw new NotFoundError(`Pool with ID '${id}' not found`);
    const steps = this.poolRepo.getPoolSteps(id);
    return this.toDTO(pool, steps);
  }

  public listPools(accountId?: string | null): PoolDTO[] {
    const pools = this.poolRepo.listPools(accountId);
    return pools.map((p) => {
      const steps = this.poolRepo.getPoolSteps(p.id);
      return this.toDTO(p, steps);
    });
  }

  public updatePool(
    id: string,
    updates: {
      name?: string;
      policy?: RoutingPolicyName;
      isActive?: boolean;
      goalId?: string | null;
      steps?: Array<{
        connectionId: string;
        modelId: string;
        role?: StepRole;
        weight?: number;
        orderIndex?: number;
      }>;
    }
  ): PoolDTO {
    const pool = this.poolRepo.findPoolById(id);
    if (!pool) throw new NotFoundError(`Pool with ID '${id}' not found`);

    const poolUpdates: Partial<Pick<PoolRecord, 'name' | 'policy' | 'is_active' | 'goal_id'>> = {};
    if (updates.name !== undefined) poolUpdates.name = updates.name;
    if (updates.policy !== undefined) poolUpdates.policy = updates.policy;
    if (updates.isActive !== undefined) poolUpdates.is_active = updates.isActive ? 1 : 0;
    if (updates.goalId !== undefined) poolUpdates.goal_id = updates.goalId;

    if (Object.keys(poolUpdates).length > 0) {
      this.poolRepo.updatePool(id, poolUpdates);
    }

    let steps = this.poolRepo.getPoolSteps(id);
    if (updates.steps !== undefined) {
      const stepInputs = updates.steps.map((s, idx) => ({
        order_index: s.orderIndex ?? idx,
        connection_id: s.connectionId,
        model_id: s.modelId,
        role: s.role || 'primary',
        weight: s.weight ?? 1.0,
      }));
      steps = this.poolRepo.replacePoolSteps(id, stepInputs);
    }

    const updatedPool = this.poolRepo.findPoolById(id)!;
    return this.toDTO(updatedPool, steps);
  }

  public deactivatePool(id: string): void {
    const pool = this.poolRepo.findPoolById(id);
    if (!pool) throw new NotFoundError(`Pool with ID '${id}' not found`);
    this.poolRepo.setPoolActive(id, false);
  }

  public deletePool(id: string): void {
    const pool = this.poolRepo.findPoolById(id);
    if (!pool) throw new NotFoundError(`Pool with ID '${id}' not found`);
    this.poolRepo.deletePool(id);
  }

  private toDTO(pool: PoolRecord, steps: PoolStepRecord[]): PoolDTO {
    let goalName: string | null = null;
    if (pool.goal_id) {
      try {
        const goal = this.goalService.getGoal(pool.goal_id);
        goalName = goal ? goal.name : null;
      } catch {}
    }

    const detailedSteps: DetailedPoolStep[] = steps.map((s) => {
      const detailed: DetailedPoolStep = { ...s };
      if (this.modelRepo) {
        const model = this.modelRepo.findById(s.model_id);
        if (model) {
          detailed.modelName = model.model_name;
          detailed.modelDisplayName = model.display_name;
        }
      }
      if (this.connectionRepo && this.providerRepo) {
        const conn = this.connectionRepo.findById(s.connection_id);
        if (conn) {
          const provider = this.providerRepo.findById(conn.provider_id);
          if (provider) {
            detailed.providerSlug = provider.slug;
            detailed.providerDisplayName = provider.display_name;
          }
        }
      }
      return detailed;
    });

    return {
      id: pool.id,
      goalId: pool.goal_id,
      name: pool.name,
      policy: pool.policy,
      isActive: Boolean(pool.is_active),
      steps: detailedSteps,
      createdAt: pool.created_at,
      updatedAt: pool.updated_at,
      goalName,
    };
  }
}
