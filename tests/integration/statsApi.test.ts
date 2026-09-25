import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildApp } from '../../src/api/server.js';
import { getConfig } from '../../src/infra/config.js';
import { closeDatabase, getDatabase } from '../../src/infra/db/client.js';
import { runMigrations } from '../../src/infra/db/migrationRunner.js';
import { UsageRepository } from '../../src/infra/db/repositories/usageRepo.js';
import { RequestLogRepository } from '../../src/infra/db/repositories/requestLogRepo.js';

describe('Stats API Integration', () => {
  let app: any;
  let adminToken: string;
  let db: any;
  let usageRepo: UsageRepository;
  let logRepo: RequestLogRepository;

  beforeEach(async () => {
    process.env.ENCRYPTION_MASTER_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    process.env.DATABASE_PATH = ':memory:';
    app = await buildApp();
    adminToken = getConfig().ADMIN_API_TOKEN;

    db = getDatabase();
    usageRepo = new UsageRepository(db);
    logRepo = new RequestLogRepository(db);
  });

  afterEach(async () => {
    await app.close();
    closeDatabase();
  });

  function seedRollups() {
    const now = Date.now();
    const hourMs = 3_600_000;
    const bucket1 = Math.floor(now / hourMs) * hourMs;
    const bucket2 = bucket1 - hourMs;

    usageRepo.record({
      at: bucket1 + 1000,
      accountId: 'acc1',
      apiKeyId: 'key1',
      poolId: 'pool1',
      providerSlug: 'provider-a',
      modelName: 'model-a1',
      status: 'success',
      tokensIn: 100,
      tokensOut: 50,
      tokensCached: 10,
      tokensReasoning: 5,
      costUsd: 0.001,
      latencyMs: 150,
      ttftMs: 80,
      fallbackUsed: false,
    });
    usageRepo.record({
      at: bucket1 + 2000,
      accountId: 'acc1',
      apiKeyId: 'key1',
      poolId: 'pool1',
      providerSlug: 'provider-a',
      modelName: 'model-a1',
      status: 'success',
      tokensIn: 200,
      tokensOut: 100,
      tokensCached: 20,
      tokensReasoning: 10,
      costUsd: 0.002,
      latencyMs: 200,
      ttftMs: 100,
      fallbackUsed: true,
    });
    usageRepo.record({
      at: bucket2 + 1000,
      accountId: 'acc1',
      apiKeyId: 'key1',
      poolId: 'pool1',
      providerSlug: 'provider-a',
      modelName: 'model-a1',
      status: 'failed',
      tokensIn: 50,
      tokensOut: 0,
      tokensCached: 0,
      tokensReasoning: 0,
      costUsd: 0,
      latencyMs: 500,
      ttftMs: null,
      fallbackUsed: false,
    });

    usageRepo.record({
      at: bucket1 + 3000,
      accountId: 'acc1',
      apiKeyId: 'key2',
      poolId: 'pool1',
      providerSlug: 'provider-b',
      modelName: 'model-b1',
      status: 'success',
      tokensIn: 300,
      tokensOut: 150,
      tokensCached: 30,
      tokensReasoning: 15,
      costUsd: 0.003,
      latencyMs: 250,
      ttftMs: 120,
      fallbackUsed: false,
    });
  }

  function seedRequestLogs() {
    const now = Date.now();
    for (let i = 0; i < 10; i++) {
      logRepo.log({
        pool_id: null,
        connection_id: null,
        model_id: null,
        status: i % 3 === 0 ? 'failed' : 'success',
        latency_ms: 100 + i * 10,
        tokens_in: 100 + i * 10,
        tokens_out: 50 + i * 5,
        cost_usd: 0.001 * (i + 1),
        error_code: i % 3 === 0 ? 'rate_limit' : null,
        decision_trace: JSON.stringify([{ step: 1, status: 'selected' }]),
        account_id: 'acc1',
        api_key_id: 'key1',
        provider_slug: 'provider-a',
        model_name: 'model-a1',
        route_protocol: 'openai',
        is_stream: 'false',
        client_name: 'Test Client',
        trace_id: `trace-${i}`,
        ttft_ms: 50 + i * 5,
        attempt_count: 1,
        fallback_used: 0,
        tokens_cached: 10,
        tokens_reasoning: 5,
        created_at: now - (10 - i) * 1000,
      });
    }
  }

  it('summary returns aggregated stats', async () => {
    seedRollups();
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/stats/summary?accountId=acc1',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode, `Response body: ${res.body}`).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.requests).toBe(4);
    expect(body.requestsSuccess).toBe(3);
    expect(body.requestsFailed).toBe(1);
    expect(body.requestsTimeout).toBe(0);
    expect(body.successRate).toBe(0.75);
    expect(body.tokensIn).toBe(650);
    expect(body.tokensOut).toBe(300);
    expect(body.tokensTotal).toBe(950);
    expect(body.costUsd).toBeCloseTo(0.006, 3);
    expect(typeof body.avgLatencyMs).toBe('number');
    expect(typeof body.maxLatencyMs).toBe('number');
    expect(body.fallbackRate).toBe(0.25);
  });

  it('summary on account with zero traffic returns all zeros', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/stats/summary?accountId=empty-account',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.requests).toBe(0);
    expect(body.requestsSuccess).toBe(0);
    expect(body.requestsFailed).toBe(0);
    expect(body.requestsTimeout).toBe(0);
    expect(body.successRate).toBe(0);
    expect(Number.isNaN(body.successRate)).toBe(false);
    expect(body.tokensIn).toBe(0);
    expect(body.tokensOut).toBe(0);
    expect(body.costUsd).toBe(0);
    expect(body.avgLatencyMs).toBe(0);
    expect(body.maxLatencyMs).toBe(0);
    expect(body.avgTtftMs).toBeNull();
    expect(body.fallbackRate).toBe(0);
  });

  it('timeseries returns zero-filled buckets for empty window', async () => {
    const to = Date.now();
    const from = to - 6 * 3_600_000;
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/stats/timeseries?accountId=empty-account&from=${from}&to=${to}&granularity=hour`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(6);
    for (const bucket of body) {
      expect(bucket.requests).toBe(0);
      expect(bucket.successRate).toBe(0);
      expect(bucket.bucketStart).toBeDefined();
    }
  });

  it('timeseries returns data with correct buckets', async () => {
    seedRollups();
    const now = Date.now();
    const hourMs = 3_600_000;
    const bucket1 = Math.floor(now / hourMs) * hourMs;
    const from = bucket1 - hourMs;
    const to = bucket1 + hourMs;
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/stats/timeseries?accountId=acc1&from=${from}&to=${to}&granularity=hour`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(2);
    const bucket1Data = body.find((b: any) => b.bucketStart === bucket1);
    expect(bucket1Data).toBeDefined();
    expect(bucket1Data.requests).toBe(3);
    expect(bucket1Data.requestsSuccess).toBe(3);
    expect(bucket1Data.requestsFailed).toBe(0);
    expect(bucket1Data.tokensIn).toBe(600);
    expect(bucket1Data.tokensOut).toBe(300);
  });

  it('breakdown by provider returns correct sums', async () => {
    seedRollups();
    const now = Date.now();
    const hourMs = 3_600_000;
    const bucket1 = Math.floor(now / hourMs) * hourMs;
    const from = bucket1 - hourMs;
    const to = bucket1 + hourMs;
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/stats/breakdown?accountId=acc1&from=${from}&to=${to}&dimension=provider`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(2);
    const providerA = body.find((r: any) => r.dimensionValue === 'provider-a');
    const providerB = body.find((r: any) => r.dimensionValue === 'provider-b');
    expect(providerA).toBeDefined();
    expect(providerA.requests).toBe(3);
    expect(providerA.tokensIn).toBe(350);
    expect(providerB).toBeDefined();
    expect(providerB.requests).toBe(1);
    expect(providerB.tokensIn).toBe(300);
  });

  it('breakdown requires dimension parameter', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/stats/breakdown?accountId=acc1',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it('account overview returns today, 7d, 30d summaries', async () => {
    seedRollups();
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/stats/accounts/acc1/overview',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.today).toBeDefined();
    expect(body.last7d).toBeDefined();
    expect(body.last30d).toBeDefined();
    expect(body.budgetConsumedPct).toBeNull();
    expect(body.rateLimitHeadroom).toBeDefined();
  });

  it('request-logs keyset pagination returns every row exactly once', async () => {
    seedRequestLogs();
    let allRows: any[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 5; page++) {
      const url = cursor
        ? `/api/v1/request-logs?accountId=acc1&limit=3&cursor=${encodeURIComponent(cursor)}`
        : '/api/v1/request-logs?accountId=acc1&limit=3';
      const res = await app.inject({
        method: 'GET',
        url,
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.rows).toBeDefined();
      expect(body.nextCursor).toBeDefined();
      allRows.push(...body.rows);
      if (!body.nextCursor) break;
      cursor = body.nextCursor;
    }
    expect(allRows.length).toBe(10);
    const uniqueIds = new Set(allRows.map((r) => r.id));
    expect(uniqueIds.size).toBe(10);
  });

  it('request-logs/:id returns parsed decisionTrace', async () => {
    seedRequestLogs();
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/request-logs?accountId=acc1&limit=1',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    const listBody = JSON.parse(listRes.body);
    const firstId = listBody.rows[0].id;

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/request-logs/${firstId}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.id).toBe(firstId);
    expect(body.decision_trace).toBeDefined();
    expect(Array.isArray(body.decision_trace)).toBe(true);
    expect(body.decision_trace[0].step).toBe(1);
    expect(body.decision_trace[0].status).toBe('selected');
  });

  it('from >= to returns 400', async () => {
    const now = Date.now();
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/stats/summary?accountId=acc1&from=${now}&to=${now - 1000}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error?.code).toBe('VALIDATION_ERROR');
  });

  it('400-day window is clamped to 366 days', async () => {
    const now = Date.now();
    const fourHundredDaysAgo = now - 400 * 24 * 60 * 60 * 1000;
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/stats/summary?accountId=acc1&from=${fourHundredDaysAgo}&to=${now}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error?.code).toBe('VALIDATION_ERROR');
    expect(body.error?.message).toContain('366');
  });

  it('all routes return 401 without admin token', async () => {
    const routes = [
      ['GET', '/api/v1/stats/summary'],
      ['GET', '/api/v1/stats/timeseries'],
      ['GET', '/api/v1/stats/breakdown?dimension=provider'],
      ['GET', '/api/v1/stats/accounts/acc1/overview'],
      ['GET', '/api/v1/request-logs'],
      ['GET', '/api/v1/request-logs/some-id'],
    ];
    for (const [method, url] of routes) {
      const res = await app.inject({ method, url });
      expect(res.statusCode).toBe(401);
    }
  });
});
