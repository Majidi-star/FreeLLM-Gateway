import Database from 'better-sqlite3';
import { HealthState } from '../../../shared/types.js';

export interface HealthStateRecord {
  connection_id: string;
  state: HealthState;
  consecutive_failures: number;
  opened_at: number | null;
  cooldown_until: number | null;
  updated_at: number;
}

export class HealthRepository {
  constructor(private db: Database.Database) {}

  public get(connectionId: string): HealthStateRecord | null {
    const stmt = this.db.prepare('SELECT * FROM health_state WHERE connection_id = ?');
    return (stmt.get(connectionId) as HealthStateRecord) || null;
  }

  public upsert(record: Omit<HealthStateRecord, 'updated_at'>): HealthStateRecord {
    const now = Date.now();
    const stmt = this.db.prepare(`
      INSERT INTO health_state (connection_id, state, consecutive_failures, opened_at, cooldown_until, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(connection_id) DO UPDATE SET
        state = excluded.state,
        consecutive_failures = excluded.consecutive_failures,
        opened_at = excluded.opened_at,
        cooldown_until = excluded.cooldown_until,
        updated_at = excluded.updated_at
    `);

    stmt.run(
      record.connection_id,
      record.state,
      record.consecutive_failures,
      record.opened_at || null,
      record.cooldown_until || null,
      now
    );

    return this.get(record.connection_id)!;
  }
}
