import { UsageRepository, UsageQuery, RollupRow } from '../infra/db/repositories/usageRepo.js';
import { RequestLogRepository, RequestLogRecord } from '../infra/db/repositories/requestLogRepo.js';
import { AppError } from '../shared/errors.js';

export interface StatsWindow {
  from: number;
  to: number;
  granularity: 'hour' | 'day';
}

export interface UsageSummary {
  requests: number;
  requestsSuccess: number;
  requestsFailed: number;
  requestsTimeout: number;
  successRate: number;
  tokensIn: number;
  tokensOut: number;
  tokensTotal: number;
  tokensCached: number;
  tokensReasoning: number;
  costUsd: number;
  avgLatencyMs: number;
  maxLatencyMs: number;
  avgTtftMs: number | null;
  fallbackRate: number;
}

export interface TimeSeriesBucket {
  bucketStart: number;
  requests: number;
  requestsSuccess: number;
  requestsFailed: number;
  requestsTimeout: number;
  successRate: number;
  tokensIn: number;
  tokensOut: number;
  tokensTotal: number;
  tokensCached: number;
  tokensReasoning: number;
  costUsd: number;
  avgLatencyMs: number;
  maxLatencyMs: number;
  avgTtftMs: number | null;
  fallbackRate: number;
}

export interface BreakdownRow {
  dimensionValue: string;
  requests: number;
  requestsSuccess: number;
  requestsFailed: number;
  requestsTimeout: number;
  successRate: number;
  tokensIn: number;
  tokensOut: number;
  tokensTotal: number;
  tokensCached: number;
  tokensReasoning: number;
  costUsd: number;
  avgLatencyMs: number;
  maxLatencyMs: number;
  avgTtftMs: number | null;
  fallbackRate: number;
}

export interface TopModelRow {
  modelName: string;
  providerSlug: string;
  requests: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}

export interface AccountOverview {
  today: UsageSummary;
  last7d: UsageSummary;
  last30d: UsageSummary;
  budgetConsumedPct: number | null;
  rateLimitHeadroom: {
    rpmLimit: number | null;
    rpmCurrent: number;
    tpmLimit: number | null;
    tpmCurrent: number;
  };
}

interface Filters {
  accountId?: string;
  apiKeyId?: string;
  poolId?: string;
  provider?: string;
  model?: string;
}

function validateWindow(from: number, to: number): void {
  if (from >= to) {
    throw new AppError('from must be less than to', 'VALIDATION_ERROR', 400);
  }
  const maxWindowMs = 366 * 24 * 60 * 60 * 1000;
  if (to - from > maxWindowMs) {
    throw new AppError('Window exceeds maximum of 366 days', 'VALIDATION_ERROR', 400);
  }
}

function defaultGranularity(from: number, to: number): 'hour' | 'day' {
  const windowMs = to - from;
  return windowMs <= 48 * 60 * 60 * 1000 ? 'hour' : 'day';
}

function buildUsageQuery(filters: Filters, window: StatsWindow): UsageQuery {
  return {
    accountId: filters.accountId ?? undefined,
    apiKeyId: filters.apiKeyId ?? undefined,
    poolId: filters.poolId ?? undefined,
    providerSlug: filters.provider ?? undefined,
    modelName: filters.model ?? undefined,
    from: window.from,
    to: window.to,
    granularity: window.granularity,
    groupBy: ['bucket_start'],
  };
}

function rollupToSummary(rows: RollupRow[]): UsageSummary {
  if (rows.length === 0) {
    return {
      requests: 0,
      requestsSuccess: 0,
      requestsFailed: 0,
      requestsTimeout: 0,
      successRate: 0,
      tokensIn: 0,
      tokensOut: 0,
      tokensTotal: 0,
      tokensCached: 0,
      tokensReasoning: 0,
      costUsd: 0,
      avgLatencyMs: 0,
      maxLatencyMs: 0,
      avgTtftMs: null,
      fallbackRate: 0,
    };
  }

  const totalRequests = rows.reduce((sum, r) => sum + r.requests, 0);
  const totalSuccess = rows.reduce((sum, r) => sum + r.requests_success, 0);
  const totalFailed = rows.reduce((sum, r) => sum + r.requests_failed, 0);
  const totalTimeout = rows.reduce((sum, r) => sum + r.requests_timeout, 0);
  const totalTokensIn = rows.reduce((sum, r) => sum + r.tokens_in, 0);
  const totalTokensOut = rows.reduce((sum, r) => sum + r.tokens_out, 0);
  const totalTokensCached = rows.reduce((sum, r) => sum + r.tokens_cached, 0);
  const totalTokensReasoning = rows.reduce((sum, r) => sum + r.tokens_reasoning, 0);
  const totalCostUsd = rows.reduce((sum, r) => sum + r.cost_usd, 0);
  const totalLatencySum = rows.reduce((sum, r) => sum + r.latency_sum_ms, 0);
  const maxLatencyMs = rows.reduce((max, r) => Math.max(max, r.latency_max_ms), 0);
  const totalTtftSum = rows.reduce((sum, r) => sum + r.ttft_sum_ms, 0);
  const totalTtftCount = rows.reduce((sum, r) => sum + r.ttft_count, 0);
  const totalFallbackCount = rows.reduce((sum, r) => sum + r.fallback_count, 0);

  return {
    requests: totalRequests,
    requestsSuccess: totalSuccess,
    requestsFailed: totalFailed,
    requestsTimeout: totalTimeout,
    successRate: totalRequests > 0 ? totalSuccess / totalRequests : 0,
    tokensIn: totalTokensIn,
    tokensOut: totalTokensOut,
    tokensTotal: totalTokensIn + totalTokensOut,
    tokensCached: totalTokensCached,
    tokensReasoning: totalTokensReasoning,
    costUsd: totalCostUsd,
    avgLatencyMs: totalRequests > 0 ? totalLatencySum / totalRequests : 0,
    maxLatencyMs,
    avgTtftMs: totalTtftCount > 0 ? totalTtftSum / totalTtftCount : null,
    fallbackRate: totalRequests > 0 ? totalFallbackCount / totalRequests : 0,
  };
}

function rollupToTimeSeriesBucket(row: RollupRow): TimeSeriesBucket {
  const totalRequests = row.requests;
  const totalSuccess = row.requests_success;
  const totalFailed = row.requests_failed;
  const totalTimeout = row.requests_timeout;
  const totalTokensIn = row.tokens_in;
  const totalTokensOut = row.tokens_out;
  const totalTokensCached = row.tokens_cached;
  const totalTokensReasoning = row.tokens_reasoning;
  const totalCostUsd = row.cost_usd;
  const totalLatencySum = row.latency_sum_ms;
  const maxLatencyMs = row.latency_max_ms;
  const totalTtftSum = row.ttft_sum_ms;
  const totalTtftCount = row.ttft_count;
  const totalFallbackCount = row.fallback_count;

  return {
    bucketStart: row.bucket_start,
    requests: totalRequests,
    requestsSuccess: totalSuccess,
    requestsFailed: totalFailed,
    requestsTimeout: totalTimeout,
    successRate: totalRequests > 0 ? totalSuccess / totalRequests : 0,
    tokensIn: totalTokensIn,
    tokensOut: totalTokensOut,
    tokensTotal: totalTokensIn + totalTokensOut,
    tokensCached: totalTokensCached,
    tokensReasoning: totalTokensReasoning,
    costUsd: totalCostUsd,
    avgLatencyMs: totalRequests > 0 ? totalLatencySum / totalRequests : 0,
    maxLatencyMs,
    avgTtftMs: totalTtftCount > 0 ? totalTtftSum / totalTtftCount : null,
    fallbackRate: totalRequests > 0 ? totalFallbackCount / totalRequests : 0,
  };
}

function rollupToBreakdownRow(row: RollupRow, dimensionValue: string): BreakdownRow {
  const totalRequests = row.requests;
  const totalSuccess = row.requests_success;
  const totalFailed = row.requests_failed;
  const totalTimeout = row.requests_timeout;
  const totalTokensIn = row.tokens_in;
  const totalTokensOut = row.tokens_out;
  const totalTokensCached = row.tokens_cached;
  const totalTokensReasoning = row.tokens_reasoning;
  const totalCostUsd = row.cost_usd;
  const totalLatencySum = row.latency_sum_ms;
  const maxLatencyMs = row.latency_max_ms;
  const totalTtftSum = row.ttft_sum_ms;
  const totalTtftCount = row.ttft_count;
  const totalFallbackCount = row.fallback_count;

  return {
    dimensionValue,
    requests: totalRequests,
    requestsSuccess: totalSuccess,
    requestsFailed: totalFailed,
    requestsTimeout: totalTimeout,
    successRate: totalRequests > 0 ? totalSuccess / totalRequests : 0,
    tokensIn: totalTokensIn,
    tokensOut: totalTokensOut,
    tokensTotal: totalTokensIn + totalTokensOut,
    tokensCached: totalTokensCached,
    tokensReasoning: totalTokensReasoning,
    costUsd: totalCostUsd,
    avgLatencyMs: totalRequests > 0 ? totalLatencySum / totalRequests : 0,
    maxLatencyMs,
    avgTtftMs: totalTtftCount > 0 ? totalTtftSum / totalTtftCount : null,
    fallbackRate: totalRequests > 0 ? totalFallbackCount / totalRequests : 0,
  };
}

function generateZeroFilledBuckets(from: number, to: number, granularity: 'hour' | 'day'): TimeSeriesBucket[] {
  const bucketMs = granularity === 'hour' ? 3_600_000 : 86_400_000;
  const start = Math.floor(from / bucketMs) * bucketMs;
  const end = Math.floor(to / bucketMs) * bucketMs;
  const buckets: TimeSeriesBucket[] = [];

  for (let bucketStart = start; bucketStart < end; bucketStart += bucketMs) {
    buckets.push({
      bucketStart,
      requests: 0,
      requestsSuccess: 0,
      requestsFailed: 0,
      requestsTimeout: 0,
      successRate: 0,
      tokensIn: 0,
      tokensOut: 0,
      tokensTotal: 0,
      tokensCached: 0,
      tokensReasoning: 0,
      costUsd: 0,
      avgLatencyMs: 0,
      maxLatencyMs: 0,
      avgTtftMs: null,
      fallbackRate: 0,
    });
  }

  return buckets;
}
export class StatsService {
  constructor(
    private usageRepo: UsageRepository,
    private logRepo: RequestLogRepository
  ) {}

  summary(filters: Filters, from: number, to: number, granularity?: 'hour' | 'day'): UsageSummary {
    validateWindow(from, to);
    const g = granularity ?? defaultGranularity(from, to);
    const window: StatsWindow = { from, to, granularity: g };
    const query = buildUsageQuery(filters, window);
    query.groupBy = ['bucket_start'];
    const rows = this.usageRepo.query(query);
    return rollupToSummary(rows);
  }

  timeseries(filters: Filters, from: number, to: number, granularity?: 'hour' | 'day'): TimeSeriesBucket[] {
    validateWindow(from, to);
    const g = granularity ?? defaultGranularity(from, to);
    const window: StatsWindow = { from, to, granularity: g };
    const query = buildUsageQuery(filters, window);
    const rows = this.usageRepo.query(query);

    const zeroFilled = generateZeroFilledBuckets(from, to, g);
    const rowMap = new Map<number, RollupRow>();
    for (const row of rows) {
      rowMap.set(row.bucket_start, row);
    }

    return zeroFilled.map((bucket) => {
      const row = rowMap.get(bucket.bucketStart);
      if (!row) return bucket;
      return rollupToTimeSeriesBucket(row);
    });
  }

  breakdown(filters: Filters, from: number, to: number, dimension: 'provider' | 'model' | 'key' | 'pool' | 'account', granularity?: 'hour' | 'day'): BreakdownRow[] {
    validateWindow(from, to);
    const g = granularity ?? defaultGranularity(from, to);
    const window: StatsWindow = { from, to, granularity: g };

    const dimensionMap: Record<string, 'provider_slug' | 'model_name' | 'api_key_id' | 'pool_id' | 'account_id'> = {
      provider: 'provider_slug',
      model: 'model_name',
      key: 'api_key_id',
      pool: 'pool_id',
      account: 'account_id',
    };

    const groupByCol = dimensionMap[dimension];
    if (!groupByCol) {
      throw new AppError('Invalid dimension', 'VALIDATION_ERROR', 400);
    }

    const query: UsageQuery = {
      accountId: filters.accountId ?? undefined,
      apiKeyId: filters.apiKeyId ?? undefined,
      poolId: filters.poolId ?? undefined,
      providerSlug: filters.provider ?? undefined,
      modelName: filters.model ?? undefined,
      from: window.from,
      to: window.to,
      granularity: window.granularity,
      groupBy: [groupByCol],
    };

    const rows = this.usageRepo.query(query);
    return rows.map((row) => rollupToBreakdownRow(row, String(row[groupByCol] ?? '')));
  }

  topModels(filters: Filters, from: number, to: number, limit = 10, granularity?: 'hour' | 'day'): TopModelRow[] {
    validateWindow(from, to);
    const g = granularity ?? defaultGranularity(from, to);
    const window: StatsWindow = { from, to, granularity: g };

    const query: UsageQuery = {
      accountId: filters.accountId ?? undefined,
      apiKeyId: filters.apiKeyId ?? undefined,
      poolId: filters.poolId ?? undefined,
      providerSlug: filters.provider ?? undefined,
      modelName: filters.model ?? undefined,
      from: window.from,
      to: window.to,
      granularity: window.granularity,
      groupBy: ['model_name', 'provider_slug'],
    };

    const rows = this.usageRepo.query(query);
    return rows
      .map((row) => ({
        modelName: row.model_name,
        providerSlug: row.provider_slug,
        requests: row.requests,
        tokensIn: row.tokens_in,
        tokensOut: row.tokens_out,
        costUsd: row.cost_usd,
      }))
      .sort((a, b) => b.requests - a.requests)
      .slice(0, limit);
  }

  accountOverview(accountId: string): AccountOverview {
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;

    const todayFrom = Math.floor(now / dayMs) * dayMs;
    const todayTo = todayFrom + dayMs;

    const last7dFrom = now - 7 * dayMs;
    const last7dTo = now;

    const last30dFrom = now - 30 * dayMs;
    const last30dTo = now;

    const filters: Filters = { accountId };

    const today = this.summary(filters, todayFrom, todayTo, 'hour');
    const last7d = this.summary(filters, last7dFrom, last7dTo, 'day');
    const last30d = this.summary(filters, last30dFrom, last30dTo, 'day');

    return {
      today,
      last7d,
      last30d,
      budgetConsumedPct: null,
      rateLimitHeadroom: {
        rpmLimit: null,
        rpmCurrent: 0,
        tpmLimit: null,
        tpmCurrent: 0,
      },
    };
  }

  requestLogs(opts: {
    accountId?: string;
    apiKeyId?: string;
    poolId?: string;
    provider?: string;
    model?: string;
    status?: string;
    from?: number;
    to?: number;
    cursor?: string;
    limit?: number;
  }): { rows: RequestLogRecord[]; nextCursor: string | null } {
    return this.logRepo.query({
      accountId: opts.accountId,
      apiKeyId: opts.apiKeyId,
      poolId: opts.poolId,
      providerSlug: opts.provider,
      modelName: opts.model,
      status: opts.status,
      from: opts.from,
      to: opts.to,
      cursor: opts.cursor,
      limit: opts.limit,
    });
  }

  requestLogById(id: string): RequestLogRecord | null {
    const record = this.logRepo.findById(id);
    if (!record) return null;
    return {
      ...record,
      decision_trace: record.decision_trace ? JSON.parse(record.decision_trace) : null,
    } as any;
  }
}