import { PoolRepository, PoolRecord, PoolStepRecord } from '../infra/db/repositories/poolRepo.js';
import { GoalService } from './goalService.js';
import { RoutingPolicyName } from '../shared/types.js';
import { NotFoundError } from '../shared/errors.js';

export interface PoolDTO {
  id: string;
  goalId: string | null;
  name: string;
  policy: RoutingPolicyName;
  isActive: boolean;
  steps: PoolStepRecord[];
  createdAt: number;
}

export class PoolService {
  constructor(
    private poolRepo: PoolRepository,
    private goalService: GoalService
  ) {}

  public createPoolFromGoal(goalId: string, poolName?: string): PoolDTO {
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
      },
      stepInputs
    );

    return this.toDTO(result.pool, result.steps);
  }

  public getPool(id: string): PoolDTO {
    const pool = this.poolRepo.findPoolById(id);
    if (!pool) throw new NotFoundError(`Pool with ID '${id}' not found`);
    const steps = this.poolRepo.getPoolSteps(id);
    return this.toDTO(pool, steps);
  }

  public listPools(): PoolDTO[] {
    const pools = this.poolRepo.listPools();
    return pools.map((p) => {
      const steps = this.poolRepo.getPoolSteps(p.id);
      return this.toDTO(p, steps);
    });
  }

  public deactivatePool(id: string): void {
    const pool = this.poolRepo.findPoolById(id);
    if (!pool) throw new NotFoundError(`Pool with ID '${id}' not found`);
    this.poolRepo.setPoolActive(id, false);
  }

  private toDTO(pool: PoolRecord, steps: PoolStepRecord[]): PoolDTO {
    return {
      id: pool.id,
      goalId: pool.goal_id,
      name: pool.name,
      policy: pool.policy,
      isActive: Boolean(pool.is_active),
      steps,
      createdAt: pool.created_at,
    };
  }
}
