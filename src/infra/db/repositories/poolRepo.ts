import Database from 'better-sqlite3';
import { generateId } from '../../../shared/ids.js';
import { RoutingPolicyName, StepRole } from '../../../shared/types.js';

export interface PoolRecord {
  id: string;
  goal_id: string | null;
  name: string;
  policy: RoutingPolicyName;
  is_active: number;
  account_id: string | null;
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
    pool: Omit<PoolRecord, 'id' | 'created_at' | 'updated_at'> & { account_id?: string | null },
    steps: Array<Omit<PoolStepRecord, 'id' | 'pool_id'>>
  ): { pool: PoolRecord; steps: PoolStepRecord[] } {
    const poolId = generateId('pool');
    const now = Date.now();

    const result = this.db.transaction(() => {
      const poolStmt = this.db.prepare(`
        INSERT INTO pools (id, goal_id, name, policy, is_active, account_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const accountId = pool.account_id ?? (pool as any).accountId ?? null;
      poolStmt.run(poolId, pool.goal_id || null, pool.name, pool.policy, pool.is_active ?? 1, accountId, now, now);

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
  public listPools(accountId?: string | null): PoolRecord[] {
    if (accountId !== undefined) {
      const stmt = this.db.prepare('SELECT * FROM pools WHERE account_id = ? OR account_id IS NULL ORDER BY created_at DESC');
      return stmt.all(accountId) as PoolRecord[];
    }
    const stmt = this.db.prepare('SELECT * FROM pools ORDER BY created_at DESC');
    return stmt.all() as PoolRecord[];
  }

  public getPoolSteps(poolId: string): PoolStepRecord[] {
    const stmt = this.db.prepare('SELECT * FROM pool_steps WHERE pool_id = ? ORDER BY order_index ASC');
    return stmt.all(poolId) as PoolStepRecord[];
  }

  public setPoolActive(poolId: string, isActive: boolean): void {
    const stmt = this.db.prepare('UPDATE pools SET is_active = ?, updated_at = ? WHERE id = ?');
    stmt.run(isActive ? 1 : 0, Date.now(), poolId);
  }

  public updatePool(id: string, updates: Partial<Pick<PoolRecord, 'name' | 'policy' | 'is_active' | 'goal_id'>>): PoolRecord | null {
    const pool = this.findPoolById(id);
    if (!pool) return null;

    const merged = { ...pool, ...updates, updated_at: Date.now() };
    const stmt = this.db.prepare(`
      UPDATE pools SET name = ?, policy = ?, is_active = ?, goal_id = ?, updated_at = ?
      WHERE id = ?
    `);
    stmt.run(merged.name, merged.policy, merged.is_active, merged.goal_id, merged.updated_at, id);
    return this.findPoolById(id);
  }

  public replacePoolSteps(poolId: string, steps: Array<Omit<PoolStepRecord, 'id' | 'pool_id'>>): PoolStepRecord[] {
    return this.db.transaction(() => {
      const delStmt = this.db.prepare('DELETE FROM pool_steps WHERE pool_id = ?');
      delStmt.run(poolId);

      const insertStmt = this.db.prepare(`
        INSERT INTO pool_steps (id, pool_id, order_index, connection_id, model_id, role, weight)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const stepId = generateId('pstep');
        insertStmt.run(
          stepId,
          poolId,
          step.order_index ?? i,
          step.connection_id,
          step.model_id,
          step.role || 'primary',
          step.weight ?? 1.0
        );
      }

      const touchStmt = this.db.prepare('UPDATE pools SET updated_at = ? WHERE id = ?');
      touchStmt.run(Date.now(), poolId);

      return this.getPoolSteps(poolId);
    })();
  }

  public deletePool(id: string): boolean {
    return this.db.transaction(() => {
      this.db.prepare('DELETE FROM pool_steps WHERE pool_id = ?').run(id);
      const res = this.db.prepare('DELETE FROM pools WHERE id = ?').run(id);
      return res.changes > 0;
    })();
  }
}
