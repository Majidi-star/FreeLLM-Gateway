import Database from 'better-sqlite3';
import { generateId } from '../../../shared/ids.js';

export interface QuotaPolicyRecord {
  id: string;
  connection_id: string;
  dimension: string; // 'daily_tokens' | 'daily_requests' | 'rpm' | 'tpm'
  window_seconds: number;
  limit_value: number;
  reset_anchor: 'rolling' | 'fixed_utc_midnight';
}

export interface QuotaUsageRecord {
  connection_id: string;
  dimension: string;
  window_start: number;
  used_value: number;
}

export class QuotaRepository {
  constructor(private db: Database.Database) {}

  public setPolicy(policy: Omit<QuotaPolicyRecord, 'id'> & { id?: string }): QuotaPolicyRecord {
    const id = policy.id || generateId('qpol');
    const stmt = this.db.prepare(`
      INSERT INTO quota_policies (id, connection_id, dimension, window_seconds, limit_value, reset_anchor)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(connection_id, dimension) DO UPDATE SET
        window_seconds = excluded.window_seconds,
        limit_value = excluded.limit_value,
        reset_anchor = excluded.reset_anchor
    `);

    stmt.run(
      id,
      policy.connection_id,
      policy.dimension,
      policy.window_seconds,
      policy.limit_value,
      policy.reset_anchor || 'rolling'
    );

    return this.getPolicy(policy.connection_id, policy.dimension)!;
  }

  public getPolicy(connectionId: string, dimension: string): QuotaPolicyRecord | null {
    const stmt = this.db.prepare('SELECT * FROM quota_policies WHERE connection_id = ? AND dimension = ?');
    return (stmt.get(connectionId, dimension) as QuotaPolicyRecord) || null;
  }

  public getPoliciesForConnection(connectionId: string): QuotaPolicyRecord[] {
    const stmt = this.db.prepare('SELECT * FROM quota_policies WHERE connection_id = ?');
    return stmt.all(connectionId) as QuotaPolicyRecord[];
  }

  public getUsage(connectionId: string, dimension: string, windowStart: number): number {
    const stmt = this.db.prepare(
      'SELECT used_value FROM quota_usage WHERE connection_id = ? AND dimension = ? AND window_start = ?'
    );
    const row = stmt.get(connectionId, dimension, windowStart) as { used_value: number } | undefined;
    return row ? row.used_value : 0;
  }

  public recordUsage(connectionId: string, dimension: string, windowStart: number, amount: number): void {
    const stmt = this.db.prepare(`
      INSERT INTO quota_usage (connection_id, dimension, window_start, used_value)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(connection_id, dimension, window_start) DO UPDATE SET
        used_value = MAX(0, used_value + excluded.used_value)
    `);
    stmt.run(connectionId, dimension, windowStart, amount);
  }

  public reserveQuota(
    connectionId: string,
    dimension: string,
    windowStart: number,
    amount: number,
    limitValue: number
  ): boolean {
    if (amount > limitValue) return false;
    const stmt = this.db.prepare(`
      INSERT INTO quota_usage (connection_id, dimension, window_start, used_value)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(connection_id, dimension, window_start) DO UPDATE SET
        used_value = used_value + excluded.used_value
      WHERE used_value + excluded.used_value <= ?
    `);
    const result = stmt.run(connectionId, dimension, windowStart, amount, limitValue);
    return result.changes > 0;
  }
}
