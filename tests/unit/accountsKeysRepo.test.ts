import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AccountRepository } from '../../../src/infra/db/repositories/accountRepo.js';
import { ApiKeyRepository } from '../../../src/infra/db/repositories/apiKeyRepo.js';
import { UsageRepository } from '../../../src/infra/db/repositories/usageRepo.js';
import { RequestLogRepository } from '../../../src/infra/db/repositories/requestLogRepo.js';
import { getDatabase } from '../../../src/infra/db/client.js';
import { generateId } from '../../../src/shared/ids.js';

const db = getDatabase();

function truncateTables() {
  db.transaction(() => {
    db.prepare('DELETE FROM request_logs').run();
    db.prepare('DELETE FROM usage_rollups').run();
    db.prepare('DELETE FROM tenant_rate_usage').run();
    db.prepare('DELETE FROM api_keys').run();
    db.prepare('DELETE FROM accounts').run();
  })();
}
describe('AccountRepository', () => {
  beforeEach(() => {
    truncateTables();
  });

  afterEach(() => {
    truncateTables();
  });

  it('create account → findByName returns it; duplicate name throws', () => {
    const repo = new AccountRepository(db);
    const acc = repo.create({
      name: 'Test Acc',
      description: null,
      status: 'active',
      default_pool_id: null,
      default_goal_id: null,
      monthly_budget_usd: null,
      rate_limit_rpm: null,
      rate_limit_tpm: null,
      max_keys: 5,
      metadata: '{}'
    });
    expect(acc.id).toBeTypeOf('string');
    const found = repo.findByName('Test Acc');
    expect(found).not.toBeNull();
    expect(found?.id).toBe(acc.id);
    // duplicate name
    expect(() => {
      repo.create({
        name: 'Test Acc',
        description: null,
        status: 'active',
        default_pool_id: null,
        default_goal_id: null,
        monthly_budget_usd: null,
        rate_limit_rpm: null,
        rate_limit_tpm: null,
        max_keys: 5,
        metadata: '{}'
      });
    }).toThrowError(/SQLITE_CONSTRAINT_UNIQUE/);
  });
});
describe('ApiKeyRepository', () => {
  beforeEach(() => {
    truncateTables();
    // create an account for keys
    const accRepo = new AccountRepository(db);
    const account = accRepo.create({
      name: 'Acc for Key',
      description: null,
      status: 'active',
      default_pool_id: null,
      default_goal_id: null,
      monthly_budget_usd: null,
      rate_limit_rpm: null,
      rate_limit_tpm: null,
      max_keys: 20,
      metadata: '{}'
    });
    // store for tests
    (this as any).testAccountId = account.id;
  });

  afterEach(() => {
    truncateTables();
  });

  it('insert key → findByLookup hits; markRevoked flips status; markRotated links both directions', () => {
    const accRepo = new AccountRepository(db);
    const account = accRepo.create({
      name: 'Acc for Key',
      description: null,
      status: 'active',
      default_pool_id: null,
      default_goal_id: null,
      monthly_budget_usd: null,
      rate_limit_rpm: null,
      rate_limit_tpm: null,
      max_keys: 20,
      metadata: '{}'
    });
    const keyRepo = new ApiKeyRepository(db);
    const key = keyRepo.insert({
      account_id: account.id,
      name: 'Test Key',
      key_lookup: 'gr_live_abcd1234', // 16 chars incl prefix? we'll just use a fake
      key_hash: 'hashed',
      key_hint: 'gr_live_ab…',
      scopes: '[\\"chat\\"]',
      pool_id: null,
      status: 'active',
      rotated_from_id: null,
      rotated_to_id: null,
      last_used_at: null,
      request_count: 0,
      expires_at: null,
      created_at: Date.now()
    });
    expect(key.id).toBeTypeOf('string');
    const found = keyRepo.findByLookup('gr_live_abcd1234');
    expect(found).not.toBeNull();
    expect(found?.id).toBe(key.id);
    // markRevoked
    keyRepo.markRevoked(key.id);
    const revoked = keyRepo.findById(key.id);
    expect(revoked?.status).toBe('revoked');
    expect(revoked?.revoked_at).not.toBeNull();
    // markRotated
    const newKey = keyRepo.insert({
      account_id: account.id,
      name: 'Test Key New',
      key_lookup: 'gr_live_abcd5678',
      key_hash: 'hashed2',
      key_hint: 'gr_live_ab…',
      scopes: '[\\"chat\\"]',
      pool_id: null,
      status: 'active',
      rotated_from_id: null,
      rotated_to_id: null,
      last_used_at: null,
      request_count: 0,
      expires_at: null,
      created_at: Date.now()
    });
    keyRepo.markRotated(key.id, newKey.id);
    const old = keyRepo.findById(key.id);
    const nue = keyRepo.findById(newKey.id);
    expect(old?.status).toBe('rotated');
    expect(old?.rotated_to_id).toBe(newKey.id);
    expect(old?.revoked_at).not.toBeNull();
    expect(nue?.rotated_from_id).toBe(key.id);
  });
});
describe('UsageRepository', () => {
  beforeEach(() => {
    truncateTables();
  });

  afterEach(() => {
    truncateTables();
  });

  it('record twice with same identity+hour => one row, requests = 2, sums added, latency_max_ms is max', () => {
    const repo = new UsageRepository(db);
    const now = Date.now();
    const fact1 = {
      at: now,
      accountId: 'acc1',
      apiKeyId: 'key1',
      poolId: 'pool1',
      providerSlug: 'openai',
      modelName: 'gpt-4',
      status: 'success',
      tokensIn: 10,
      tokensOut: 20,
      tokensCached: 0,
      tokensReasoning: 0,
      costUsd: 0.005,
      latencyMs: 100,
      ttftMs: 10,
      fallbackUsed: false
    };
    const fact2 = {
      ...fact1,
      at: now + 1000, // same hour
      latencyMs: 200,
      tokensOut: 30,
      costUsd: 0.008
    };
    repo.record(fact1);
    repo.record(fact2);
    const rows = repo.query({
      accountId: 'acc1',
      apiKeyId: 'key1',
      poolId: 'pool1',
      providerSlug: 'openai',
      modelName: 'gpt-4',
      from: now - 3600_000,
      to: now + 3600_000,
      granularity: 'hour',
      groupBy: ['bucket_start'] // group by bucket to get per hour bucket
    });
    expect(rows.length).toBe(1);
    const row = rows[0];
    expect(row.requests).toBe(2);
    expect(row.requests_success).toBe(2);
    expect(row.requests_failed).toBe(0);
    expect(row.requests_timeout).toBe(0);
    expect(row.tokens_in).toBe(10 + 10);
    expect(row.tokens_out).toBe(20 + 30);
    expect(row.tokens_cached).toBe(0);
    expect(row.tokens_reasoning).toBe(0);
    expect(row.cost_usd).toBeCloseTo(0.005 + 0.008);
    expect(row.latency_max_ms).toBe(200); // max of 100 and 200
    expect(row.ttft_sum_ms).toBe(10 + 10); // both have ttftMs 10
    expect(row.ttft_count).toBe(2);
    expect(row.fallback_count).toBe(0);
  });

  it('record with null accountId => row stored with account_id = \'\' and is retrievable', () => {
    const repo = new UsageRepository(db);
    const now = Date.now();
    const fact = {
      at: now,
      accountId: null,
      apiKeyId: null,
      poolId: null,
      providerSlug: null,
      modelName: null,
      status: 'success',
      tokensIn: 5,
      tokensOut: 5,
      tokensCached: 0,
      tokensReasoning: 0,
      costUsd: 0.001,
      latencyMs: 50,
      ttftMs: 5,
      fallbackUsed: true
    };
    repo.record(fact);
    const rows = repo.query({
      accountId: null,
      apiKeyId: null,
      poolId: null,
      providerSlug: null,
      modelName: null,
      from: now - 3600_000,
      to: now + 3600_000,
      granularity: 'hour',
      groupBy: ['bucket_start']
    });
    expect(rows.length).toBe(1);
    const row = rows[0];
    // account_id stored as empty string for null
    expect(row.account_id).toBe('');
    expect(row.requests).toBe(1);
    expect(row.tokens_in).toBe(5);
    expect(row.fallback_count).toBe(1);
  });

  it('requestLogRepo.query with 5 rows and limit: 2 walks the full set in 3 pages with no duplicates and no gaps', () => {
    const logRepo = new RequestLogRepository(db);
    const baseTime = Date.now() - 10000;
    // insert 5 logs with increasing created_at
    for (let i = 0; i < 5; i++) {
      logRepo.log({
        pool_id: null,
        connection_id: null,
        model_id: null,
        status: 'success',
        latency_ms: 10 + i,
        tokens_in: 1,
        tokens_out: 1,
        cost_usd: 0.001,
        error_code: null,
        decision_trace: null,
        account_id: null,
        api_key_id: null,
        provider_slug: null,
        model_name: null,
        route_protocol: null,
        is_stream: null,
        client_name: null,
        trace_id: null,
        id: undefined // let repo generate
      });
    }
    let cursor = null;
    const pages: any[] = [];
    let totalRows = 0;
    do {
      const result = logRepo.query({
        limit: 2,
        cursor: cursor
      });
      pages.push(result.rows);
      totalRows += result.rows.length;
      cursor = result.nextCursor;
    } while (cursor !== null);
    // flatten pages
    const flat = pages.flat();
    expect(flat.length).toBe(5);
    // ensure created_at descending order
    for (let i = 0; i < flat.length - 1; i++) {
      if (flat[i].created_at !== flat[i + 1].created_at) {
        expect(flat[i].created_at).toBeGreaterThan(flat[i + 1].created_at);
      } else {
        // tie break by id descending
        expect(flat[i].id).toBeGreaterThan(flat[i + 1].id);
      }
    }
    // ensure no duplicates: IDs unique
    const ids = flat.map(r => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
});