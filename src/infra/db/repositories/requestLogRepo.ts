import Database from 'better-sqlite3';
import { generateId } from '../../../shared/ids.js';
import { redactSensitiveData } from '../../logger.js';

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
  account_id: string | null;
  api_key_id: string | null;
  provider_slug: string | null;
  model_name: string | null;
  route_protocol: string | null;
  is_stream: string | null;
  client_name: string | null;
  trace_id: string | null;
  ttft_ms: number | null;
  attempt_count: number | null;
  fallback_used: number | null;
  tokens_cached: number | null;
  tokens_reasoning: number | null;
  created_at: number;
}

export class RequestLogRepository {
  private logStmt: any;
  private findByIdStmt: any;
  private purgeStmt: any;
  constructor(private db: Database.Database) {
    this.logStmt = this.db.prepare(`INSERT INTO request_logs (id, pool_id, connection_id, model_id, status, latency_ms, tokens_in, tokens_out, cost_usd, error_code, decision_trace, account_id, api_key_id, provider_slug, model_name, route_protocol, is_stream, client_name, trace_id, ttft_ms, attempt_count, fallback_used, tokens_cached, tokens_reasoning, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    this.findByIdStmt = this.db.prepare('SELECT * FROM request_logs WHERE id = ?');
    this.purgeStmt = this.db.prepare('DELETE FROM request_logs WHERE created_at < ?');
  }

  public log(entry: Omit<RequestLogRecord, 'id' | 'created_at'> & { id?: string; created_at?: number }): RequestLogRecord {
    const id = entry.id || generateId('req');
    const createdAt = entry.created_at ?? Date.now();

    const stmt = this.db.prepare(`
      INSERT INTO request_logs (
        id, pool_id, connection_id, model_id, status, latency_ms, tokens_in, tokens_out, cost_usd, error_code, decision_trace,
        account_id, api_key_id, provider_slug, model_name, route_protocol, is_stream, client_name, trace_id,
        ttft_ms, attempt_count, fallback_used, tokens_cached, tokens_reasoning, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      entry.decision_trace ? redactSensitiveData(entry.decision_trace) : null,
      entry.account_id || null,
      entry.api_key_id || null,
      entry.provider_slug || null,
      entry.model_name || null,
      entry.route_protocol || null,
      entry.is_stream || null,
      entry.client_name || null,
      entry.trace_id || null,
      entry.ttft_ms ?? null,
      entry.attempt_count ?? null,
      entry.fallback_used ?? null,
      entry.tokens_cached ?? null,
      entry.tokens_reasoning ?? null,
      createdAt
    );

    return { ...entry, id, created_at: createdAt };
  }

  public query(opts: {
    accountId?: string;
    apiKeyId?: string;
    poolId?: string;
    providerSlug?: string;
    modelName?: string;
    status?: string;
    from?: number;
    to?: number;
    cursor?: string; // opaque: `${created_at}:${id}`
    limit?: number;
  }): { rows: RequestLogRecord[]; nextCursor: string | null } {
    const limit = opts?.limit ?? 50;
    if (limit < 1 || limit > 500) {
      throw new Error('limit must be between 1 and 500');
    }
    const whereParts: string[] = [];
    const vals: any[] = [];
    if (opts.accountId !== undefined) {
      whereParts.push('account_id = ?');
      vals.push(opts.accountId);
    }
    if (opts.apiKeyId !== undefined) {
      whereParts.push('api_key_id = ?');
      vals.push(opts.apiKeyId);
    }
    if (opts.poolId !== undefined) {
      whereParts.push('pool_id = ?');
      vals.push(opts.poolId);
    }
    if (opts.providerSlug !== undefined) {
      whereParts.push('provider_slug = ?');
      vals.push(opts.providerSlug);
    }
    if (opts.modelName !== undefined) {
      whereParts.push('model_name = ?');
      vals.push(opts.modelName);
    }
    if (opts.status !== undefined) {
      whereParts.push('status = ?');
      vals.push(opts.status);
    }
    if (opts.from !== undefined) {
      whereParts.push('created_at >= ?');
      vals.push(opts.from);
    }
    if (opts.to !== undefined) {
      whereParts.push('created_at < ?');
      vals.push(opts.to);
    }
    // keyset pagination: we need to handle cursor
    let cursorCreatedAt: number | null = null;
    let cursorId: string | null = null;
    if (opts.cursor != null) {
      const parts = opts.cursor.split(':');
      if (parts.length !== 2) {
        throw new Error('invalid cursor');
      }
      cursorCreatedAt = Number(parts[0]);
      cursorId = parts[1];
      if (Number.isNaN(cursorCreatedAt) || !cursorId) {
        throw new Error('invalid cursor');
      }
      whereParts.push('(created_at < ? OR (created_at = ? AND id < ?))');
      vals.push(cursorCreatedAt, cursorCreatedAt, cursorId);
    }
    const whereClause = whereParts.length ? 'WHERE ' + whereParts.join(' AND ') : '';
    const sql = `
      SELECT * FROM request_logs
      ${whereClause}
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `;
    vals.push(limit + 1); // fetch extra to detect next page
    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...vals) as RequestLogRecord[];
    let nextCursor: string | null = null;
    if (rows.length === limit + 1) {
      rows.pop(); // remove the extra probe item
      const last = rows[rows.length - 1];
      nextCursor = `${last.created_at}:${last.id}`;
    }
    return { rows, nextCursor };
  }

  public findById(id: string): RequestLogRecord | null {
    const stmt = this.db.prepare('SELECT * FROM request_logs WHERE id = ?');
    const row = stmt.get(id);
    return row as RequestLogRecord || null;
  }

  public purgeOlderThan(cutoffMs: number): number {
    const stmt = this.db.prepare('DELETE FROM request_logs WHERE created_at < ?');
    const result = stmt.run(cutoffMs);
    return result.changes;
  }
}
