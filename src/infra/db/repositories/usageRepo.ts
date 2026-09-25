import Database from 'better-sqlite3';

export interface UsageFact {
  at: number;
  accountId: string | null;
  apiKeyId: string | null;
  poolId: string | null;
  providerSlug: string | null;
  modelName: string | null;
  status: 'success' | 'failed' | 'timeout';
  tokensIn: number;
  tokensOut: number;
  tokensCached: number;
  tokensReasoning: number;
  costUsd: number;
  latencyMs: number;
  ttftMs: number | null;
  fallbackUsed: boolean;
}

export interface RollupRow {
  bucket_start: number;
  granularity: string;
  account_id: string;
  api_key_id: string;
  pool_id: string;
  provider_slug: string;
  model_name: string;
  requests: number;
  requests_success: number;
  requests_failed: number;
  requests_timeout: number;
  tokens_in: number;
  tokens_out: number;
  tokens_cached: number;
  tokens_reasoning: number;
  cost_usd: number;
  latency_sum_ms: number;
  latency_max_ms: number;
  ttft_sum_ms: number;
  ttft_count: number;
  fallback_count: number;
}

export interface UsageQuery {
  accountId?: string;
  apiKeyId?: string;
  poolId?: string;
  providerSlug?: string;
  modelName?: string;
  from: number;
  to: number;
  granularity: 'hour' | 'day';
  groupBy: Array<'provider_slug' | 'model_name' | 'api_key_id' | 'pool_id' | 'account_id' | 'bucket_start'>;
}

export class UsageRepository {
  private upsertStmt: any;
  constructor(private db: Database.Database) {
    // Prepare upsert statement (used for both hour and day)
    this.upsertStmt = this.db.prepare(`
      INSERT INTO usage_rollups (
        bucket_start, granularity, account_id, api_key_id, pool_id, provider_slug, model_name,
        requests, requests_success, requests_failed, requests_timeout,
        tokens_in, tokens_out, tokens_cached, tokens_reasoning, cost_usd,
        latency_sum_ms, latency_max_ms, ttft_sum_ms, ttft_count, fallback_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(bucket_start, granularity, account_id, api_key_id, pool_id, provider_slug, model_name)
      DO UPDATE SET
        requests = requests + 1,
        requests_success = requests_success + excluded.requests_success,
        requests_failed = requests_failed + excluded.requests_failed,
        requests_timeout = requests_timeout + excluded.requests_timeout,
        tokens_in = tokens_in + excluded.tokens_in,
        tokens_out = tokens_out + excluded.tokens_out,
        tokens_cached = tokens_cached + excluded.tokens_cached,
        tokens_reasoning = tokens_reasoning + excluded.tokens_reasoning,
        cost_usd = cost_usd + excluded.cost_usd,
        latency_sum_ms = latency_sum_ms + excluded.latency_sum_ms,
        latency_max_ms = MAX(latency_max_ms, excluded.latency_max_ms),
        ttft_sum_ms = ttft_sum_ms + excluded.ttft_sum_ms,
        ttft_count = ttft_count + excluded.ttft_count,
        fallback_count = fallback_count + excluded.fallback_count
    `);
  }

  public static floorBucket(at: number, g: 'hour' | 'day'): number {
    if (g === 'hour') {
      return Math.floor(at / 3_600_000) * 3_600_000;
    } else {
      // day: UTC midnight
      return Math.floor(at / 86_400_000) * 86_400_000;
    }
  }
public record(fact: UsageFact): void {
    const hourBucket = UsageRepository.floorBucket(fact.at, 'hour');
    const dayBucket = UsageRepository.floorBucket(fact.at, 'day');
    const accountId = fact.accountId ?? '';
    const apiKeyId = fact.apiKeyId ?? '';
    const poolId = fact.poolId ?? '';
    const providerSlug = fact.providerSlug ?? '';
    const modelName = fact.modelName ?? '';

    const success = fact.status === 'success' ? 1 : 0;
    const failed = fact.status === 'failed' ? 1 : 0;
    const timeout = fact.status === 'timeout' ? 1 : 0;
    const ttftCount = fact.ttftMs !== null ? 1 : 0;
    const fallbackCount = fact.fallbackUsed ? 1 : 0;

    // Hour upsert
    this.upsertStmt.run(
      hourBucket,
      'hour',
      accountId,
      apiKeyId,
      poolId,
      providerSlug,
      modelName,
      1, // requests
      success,
      failed,
      timeout,
      fact.tokensIn,
      fact.tokensOut,
      fact.tokensCached,
      fact.tokensReasoning,
      fact.costUsd,
      fact.latencyMs,
      fact.latencyMs, // latency_max_ms same as latency_ms for single record
      fact.ttftMs ?? 0,
      ttftCount,
      fallbackCount
    );
    // Day upsert
    this.upsertStmt.run(
      dayBucket,
      'day',
      accountId,
      apiKeyId,
      poolId,
      providerSlug,
      modelName,
      1,
      success,
      failed,
      timeout,
      fact.tokensIn,
      fact.tokensOut,
      fact.tokensCached,
      fact.tokensReasoning,
      fact.costUsd,
      fact.latencyMs,
      fact.latencyMs,
      fact.ttftMs ?? 0,
      ttftCount,
      fallbackCount
    );
  }
public query(q: UsageQuery): RollupRow[] {
    const validGroupBy = new Set(['provider_slug','model_name','api_key_id','pool_id','account_id','bucket_start']);
    const groupByCols = q.groupBy.filter(col => validGroupBy.has(col));
    if (groupByCols.length === 0) {
      throw new Error('At least one valid groupBy column required');
    }
    const selectCols = [...groupByCols, 
      'SUM(requests) AS requests',
      'SUM(requests_success) AS requests_success',
      'SUM(requests_failed) AS requests_failed',
      'SUM(requests_timeout) AS requests_timeout',
      'SUM(tokens_in) AS tokens_in',
      'SUM(tokens_out) AS tokens_out',
      'SUM(tokens_cached) AS tokens_cached',
      'SUM(tokens_reasoning) AS tokens_reasoning',
      'SUM(cost_usd) AS cost_usd',
      'SUM(latency_sum_ms) AS latency_sum_ms',
      'MAX(latency_max_ms) AS latency_max_ms',
      'SUM(ttft_sum_ms) AS ttft_sum_ms',
      'SUM(ttft_count) AS ttft_count',
      'SUM(fallback_count) AS fallback_count'
    ].join(', ');
    const sql = `
      SELECT ${selectCols}
      FROM usage_rollups
      WHERE granularity = ?
        AND bucket_start >= ?
        AND bucket_start < ?
        ${q.accountId !== undefined ? 'AND account_id = ?' : ''}
        ${q.apiKeyId !== undefined ? 'AND api_key_id = ?' : ''}
        ${q.poolId !== undefined ? 'AND pool_id = ?' : ''}
        ${q.providerSlug !== undefined ? 'AND provider_slug = ?' : ''}
        ${q.modelName !== undefined ? 'AND model_name = ?' : ''}
      GROUP BY ${groupByCols.join(', ')}
      ORDER BY bucket_start ASC
    `;
    // Build params array
    const params: any[] = [
      q.granularity,
      q.from,
      q.to
    ];
    if (q.accountId !== undefined) params.push(q.accountId ?? '');
    if (q.apiKeyId !== undefined) params.push(q.apiKeyId ?? '');
    if (q.poolId !== undefined) params.push(q.poolId ?? '');
    if (q.providerSlug !== undefined) params.push(q.providerSlug ?? '');
    if (q.modelName !== undefined) params.push(q.modelName ?? '');
    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as RollupRow[];
    return rows;
  }
public purgeOlderThan(cutoffMs: number, granularity: 'hour' | 'day'): void {
    if (granularity !== 'hour') {
      // Never purge day per spec
      return;
    }
    const stmt = this.db.prepare('DELETE FROM usage_rollups WHERE granularity = ? AND bucket_start < ?');
    stmt.run(granularity, cutoffMs);
  }
}