import Database from 'better-sqlite3';
import { generateId } from '../../../shared/ids.js';
import { RoutingPolicyName, StepRole } from '../../../shared/types.js';

export interface PoolRecord {
  id: string;
  goal_id: string | null;
  name: string;
  policy: RoutingPolicyName;
  is_active: number;
  created_at: number;
  updated_at: number;
}

export interface PoolStepRecord {
  id: string;
  pool_id: string;
  order_index: number;
  connection_id: string;
  model_id: string;
  role: StepRole;
  weight: number;
}

export class PoolRepository {
  constructor(private db: Database.Database) {}

  public createPool(
    pool: Omit<PoolRecord, 'id' | 'created_at' | 'updated_at'>,
    steps: Array<Omit<PoolStepRecord, 'id' | 'pool_id'>>
  ): { pool: PoolRecord; steps: PoolStepRecord[] } {
    const poolId = generateId('pool');
    const now = Date.now();

    const result = this.db.transaction(() => {
      const poolStmt = this.db.prepare(`
        INSERT INTO pools (id, goal_id, name, policy, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      poolStmt.run(poolId, pool.goal_id || null, pool.name, pool.policy, pool.is_active ?? 1, now, now);

      const stepStmt = this.db.prepare(`
        INSERT INTO pool_steps (id, pool_id, order_index, connection_id, model_id, role, weight)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      for (const step of steps) {
        const stepId = generateId('pstep');
        stepStmt.run(stepId, poolId, step.order_index, step.connection_id, step.model_id, step.role || 'primary', step.weight ?? 1.0);
      }

      return {
        pool: this.findPoolById(poolId)!,
        steps: this.getPoolSteps(poolId),
      };
    })();

    return result;
  }

  public findPoolById(id: string): PoolRecord | null {
    const stmt = this.db.prepare('SELECT * FROM pools WHERE id = ?');
    return (stmt.get(id) as PoolRecord) || null;
  }

  public getPoolSteps(poolId: string): PoolStepRecord[] {
    const stmt = this.db.prepare('SELECT * FROM pool_steps WHERE pool_id = ? ORDER BY order_index ASC');
    return stmt.all(poolId) as PoolStepRecord[];
  }

  public listPools(): PoolRecord[] {
    const stmt = this.db.prepare('SELECT * FROM pools ORDER BY created_at DESC');
    return stmt.all() as PoolRecord[];
  }

  public setPoolActive(poolId: string, isActive: boolean): void {
    const stmt = this.db.prepare('UPDATE pools SET is_active = ?, updated_at = ? WHERE id = ?');
    stmt.run(isActive ? 1 : 0, Date.now(), poolId);
  }
}
