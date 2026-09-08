import Database from 'better-sqlite3';
import { generateId } from '../../../shared/ids.js';

export interface RequestLogRecord {
  id: string;
  pool_id: string | null;
  connection_id: string | null;
  model_id: string | null;
  status: 'success' | 'failed' | 'timeout';
  latency_ms: number | null;
  tokens_in: number | null;
  tokens_out: number | null;
  cost_usd: number | null;
  error_code: string | null;
  decision_trace: string | null; // JSON string
  created_at: number;
}

export class RequestLogRepository {
  constructor(private db: Database.Database) {}

  public log(entry: Omit<RequestLogRecord, 'id' | 'created_at'> & { id?: string }): RequestLogRecord {
    const id = entry.id || generateId('req');
    const now = Date.now();

    const stmt = this.db.prepare(`
      INSERT INTO request_logs (
        id, pool_id, connection_id, model_id, status, latency_ms, tokens_in, tokens_out, cost_usd, error_code, decision_trace, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      entry.pool_id || null,
      entry.connection_id || null,
      entry.model_id || null,
      entry.status,
      entry.latency_ms || null,
      entry.tokens_in || null,
      entry.tokens_out || null,
      entry.cost_usd || null,
      entry.error_code || null,
      entry.decision_trace || null,
      now
    );

    return { ...entry, id, created_at: now };
  }

  public query(options?: { poolId?: string; limit?: number }): RequestLogRecord[] {
    const limit = options?.limit || 50;
    if (options?.poolId) {
      const stmt = this.db.prepare('SELECT * FROM request_logs WHERE pool_id = ? ORDER BY created_at DESC LIMIT ?');
      return stmt.all(options.poolId, limit) as RequestLogRecord[];
    } else {
      const stmt = this.db.prepare('SELECT * FROM request_logs ORDER BY created_at DESC LIMIT ?');
      return stmt.all(limit) as RequestLogRecord[];
    }
  }
}
