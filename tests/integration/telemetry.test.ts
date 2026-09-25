import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { getDatabase, closeDatabase } from '../../src/infra/db/client.js';
import { runMigrations } from '../../src/infra/db/migrationRunner.js';
import { ProviderRepository } from '../../src/infra/db/repositories/providerRepo.js';
import { ConnectionRepository } from '../../src/infra/db/repositories/connectionRepo.js';
import { ModelRepository } from '../../src/infra/db/repositories/modelRepo.js';
import { PoolRepository } from '../../src/infra/db/repositories/poolRepo.js';
import { HealthRepository } from '../../src/infra/db/repositories/healthRepo.js';
import { QuotaRepository } from '../../src/infra/db/repositories/quotaRepo.js';
import { RequestLogRepository } from '../../src/infra/db/repositories/requestLogRepo.js';
import { UsageRepository } from '../../src/infra/db/repositories/usageRepo.js';
import { GatewayService } from '../../src/services/gatewayService.js';
import { encryptCredential } from '../../src/infra/security/vault.js';
import { AllTargetsExhaustedError } from '../../src/shared/errors.js';

describe('Telemetry Capture, Cost Accounting & Rollups', () => {
  let db: Database.Database;
  let providerRepo: ProviderRepository;
  let connectionRepo: ConnectionRepository;
  let modelRepo: ModelRepository;
  let poolRepo: PoolRepository;
  let healthRepo: HealthRepository;
  let quotaRepo: QuotaRepository;
  let logRepo: RequestLogRepository;
  let usageRepo: UsageRepository;
  let gateway: GatewayService;

  beforeEach(() => {
    process.env.ENCRYPTION_MASTER_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    db = getDatabase(':memory:');
    runMigrations(db);

    providerRepo = new ProviderRepository(db);
    connectionRepo = new ConnectionRepository(db);
    modelRepo = new ModelRepository(db);
    poolRepo = new PoolRepository(db);
    healthRepo = new HealthRepository(db);
    quotaRepo = new QuotaRepository(db);
    logRepo = new RequestLogRepository(db);
    usageRepo = new UsageRepository(db);

    gateway = new GatewayService(poolRepo, connectionRepo, modelRepo, providerRepo, healthRepo, quotaRepo, logRepo, usageRepo);
  });

  afterEach(() => {
    closeDatabase();
  });

  const setupPoolWithPricedModel = async (costInput: number, costOutput: number) => {
    const now = Date.now();
    const prov = providerRepo.upsert({ slug: 'test_prov', display_name: 'Test Provider', base_url: 'https://test.api', protocol: 'openai', auth_type: 'api_key', is_active: 1 });
    const enc = encryptCredential('test_key');
    const conn = connectionRepo.create({ provider_id: prov.id, label: 'Test Conn', credential_enc: enc.ciphertext, credential_iv: enc.iv, credential_tag: enc.tag, tier: 'free', status: 'healthy', last_tested_at: now, last_error: null });
    const mdl = modelRepo.upsert({ provider_id: prov.id, model_name: 'test-model', display_name: 'Test Model', context_window: 4096, supports_tools: 1, supports_vision: 0, cost_input_per_1k: costInput, cost_output_per_1k: costOutput, task_fitness: '{}' });
    const { pool } = poolRepo.createPool({ goal_id: null, name: 'Test Pool', policy: 'fill_first', is_active: 1 }, [{ order_index: 0, connection_id: conn.id, model_id: mdl.id, role: 'primary', weight: 1.0 }]);
    return { pool, conn, mdl, prov };
  };

  it('Non-stream success → request_logs row has account_id, api_key_id, provider_slug, model_name, route_protocol, non-zero cost_usd for a priced model, attempt_count: 1, fallback_used: 0', async () => {
    const { pool, conn, mdl } = await setupPoolWithPricedModel(0.001, 0.002);

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        id: 'chatcmpl-123',
        choices: [{ index: 0, message: { role: 'assistant', content: 'Hello!' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 }
      }),
    } as Response);

    const ctx = { accountId: 'acc_test', apiKeyId: 'key_test', protocol: 'openai' as const, clientName: 'Test Client' };
    const result = await gateway.dispatch(pool.id, { model: 'test-model', messages: [{ role: 'user', content: 'Hi' }] }, undefined, ctx);

    expect(result.response.usage?.prompt_tokens).toBe(100);
    expect(result.response.usage?.completion_tokens).toBe(50);

    const logs = logRepo.query({ limit: 10 });
    expect(logs.rows.length).toBe(1);
    const log = logs.rows[0];
    expect(log.account_id).toBe('acc_test');
    expect(log.api_key_id).toBe('key_test');
    expect(log.provider_slug).toBe('test_prov');
    expect(log.model_name).toBe('test-model');
    expect(log.route_protocol).toBe('openai');
    expect(log.cost_usd).toBeGreaterThan(0);
    expect(log.cost_usd).toBeCloseTo(0.0002, 5);
    expect(log.attempt_count).toBe(1);
    expect(log.fallback_used).toBe(0);

    const rollups = usageRepo.query({
      granularity: 'hour',
      from: Date.now() - 3600000,
      to: Date.now() + 3600000,
      groupBy: ['bucket_start']
    });
    expect(rollups.length).toBe(1);
    expect(rollups[0].requests).toBe(1);
    expect(rollups[0].requests_success).toBe(1);
  });

  it('A usage_rollups row exists for both hour and day with requests: 1', async () => {
    const { pool } = await setupPoolWithPricedModel(0.001, 0.002);

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        id: 'chatcmpl-123',
        choices: [{ index: 0, message: { role: 'assistant', content: 'Hello!' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 }
      }),
    } as Response);

    await gateway.dispatch(pool.id, { model: 'test-model', messages: [{ role: 'user', content: 'Hi' }] });

    const hourRollups = usageRepo.query({
      granularity: 'hour',
      from: Date.now() - 3600000,
      to: Date.now() + 3600000,
      groupBy: ['bucket_start']
    });
    const dayRollups = usageRepo.query({
      granularity: 'day',
      from: Date.now() - 86400000,
      to: Date.now() + 86400000,
      groupBy: ['bucket_start']
    });
    expect(hourRollups.length).toBe(1);
    expect(hourRollups[0].requests).toBe(1);
    expect(dayRollups.length).toBe(1);
    expect(dayRollups[0].requests).toBe(1);
  });

  it('Two requests in the same hour → one hour-rollup row with requests: 2', async () => {
    const { pool } = await setupPoolWithPricedModel(0.001, 0.002);

    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        id: 'chatcmpl-123',
        choices: [{ index: 0, message: { role: 'assistant', content: 'Hello!' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 }
      }),
    } as Response);

    await gateway.dispatch(pool.id, { model: 'test-model', messages: [{ role: 'user', content: 'Hi 1' }] });
    await gateway.dispatch(pool.id, { model: 'test-model', messages: [{ role: 'user', content: 'Hi 2' }] });

    const hourRollups = usageRepo.query({
      granularity: 'hour',
      from: Date.now() - 3600000,
      to: Date.now() + 3600000,
      groupBy: ['bucket_start']
    });
    expect(hourRollups.length).toBe(1);
    expect(hourRollups[0].requests).toBe(2);
    expect(hourRollups[0].requests_success).toBe(2);
  });

  it('Streaming request → tokens_out > 0 and ttft_ms non-null', async () => {
    const { pool, conn } = await setupPoolWithPricedModel(0.001, 0.002);

    const sseChunks = [
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" world"}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":20,"total_tokens":30}}\n\n',
      'data: [DONE]\n\n'
    ];

    let chunkIndex = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      const stream = new ReadableStream({
        async pull(controller) {
          if (chunkIndex < sseChunks.length) {
            controller.enqueue(new TextEncoder().encode(sseChunks[chunkIndex++]));
          } else {
            controller.close();
          }
        }
      });
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'text/event-stream' }),
        body: stream
      } as Response;
    });

    const result = await gateway.dispatchStream(pool.id, { model: 'test-model', messages: [{ role: 'user', content: 'Hi' }], stream: true });

    for await (const _chunk of result.stream) {
      // Just consume
    }

    const logs = logRepo.query({ limit: 10 });
    expect(logs.rows.length).toBe(1);
    const log = logs.rows[0];
    expect(log.tokens_out).toBeGreaterThan(0);
    expect(log.ttft_ms).not.toBeNull();
    expect(log.ttft_ms).toBeGreaterThanOrEqual(0);
    expect(log.is_stream).toBe('true');
  });

  it('First provider 500s, second succeeds → fallback_used: 1, attempt_count: 2, decision_trace contains attempted_failed plus selected', async () => {
    const now = Date.now();
    const prov1 = providerRepo.upsert({ slug: 'prov1', display_name: 'Provider 1', base_url: 'https://prov1.api', protocol: 'openai', auth_type: 'api_key', is_active: 1 });
    const prov2 = providerRepo.upsert({ slug: 'prov2', display_name: 'Provider 2', base_url: 'https://prov2.api', protocol: 'openai', auth_type: 'api_key', is_active: 1 });
    const enc = encryptCredential('test_key');
    const conn1 = connectionRepo.create({ provider_id: prov1.id, label: 'Conn 1', credential_enc: enc.ciphertext, credential_iv: enc.iv, credential_tag: enc.tag, tier: 'free', status: 'healthy', last_tested_at: now, last_error: null });
    const conn2 = connectionRepo.create({ provider_id: prov2.id, label: 'Conn 2', credential_enc: enc.ciphertext, credential_iv: enc.iv, credential_tag: enc.tag, tier: 'free', status: 'healthy', last_tested_at: now, last_error: null });
    const mdl1 = modelRepo.upsert({ provider_id: prov1.id, model_name: 'model1', display_name: 'Model 1', context_window: 4096, supports_tools: 1, supports_vision: 0, cost_input_per_1k: 0.001, cost_output_per_1k: 0.002, task_fitness: '{}' });
    const mdl2 = modelRepo.upsert({ provider_id: prov2.id, model_name: 'model2', display_name: 'Model 2', context_window: 4096, supports_tools: 1, supports_vision: 0, cost_input_per_1k: 0.001, cost_output_per_1k: 0.002, task_fitness: '{}' });
    const { pool } = poolRepo.createPool({ goal_id: null, name: 'Fallback Pool', policy: 'fill_first', is_active: 1 }, [
      { order_index: 0, connection_id: conn1.id, model_id: mdl1.id, role: 'primary', weight: 1.0 },
      { order_index: 1, connection_id: conn2.id, model_id: mdl2.id, role: 'primary', weight: 1.0 }
    ]);

    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ error: { message: 'Internal Server Error' } }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          id: 'chatcmpl-123',
          choices: [{ index: 0, message: { role: 'assistant', content: 'Hello!' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 }
        }),
      } as Response);

    const result = await gateway.dispatch(pool.id, { model: 'auto', messages: [{ role: 'user', content: 'Hi' }] });

    expect(result.response.choices[0].message.content).toBe('Hello!');

    const logs = logRepo.query({ limit: 10 });
    expect(logs.rows.length).toBe(1);
    const log = logs.rows[0];
    expect(log.fallback_used).toBe(1);
    expect(log.attempt_count).toBe(2);

    const trace = JSON.parse(log.decision_trace);
    const statuses = trace.map((t: any) => t.status);
    expect(statuses).toContain('attempted_failed');
    expect(statuses).toContain('selected');
  });

  it('A recordOutcome that throws internally (stub usageRepo) still returns 200 to the client', async () => {
    const { pool } = await setupPoolWithPricedModel(0.001, 0.002);

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        id: 'chatcmpl-123',
        choices: [{ index: 0, message: { role: 'assistant', content: 'Hello!' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 }
      }),
    } as Response);

    const originalRecord = usageRepo.record;
    usageRepo.record = vi.fn(() => { throw new Error('DB write failed'); });

    try {
      const result = await gateway.dispatch(pool.id, { model: 'test-model', messages: [{ role: 'user', content: 'Hi' }] });
      expect(result.response.choices[0].message.content).toBe('Hello!');
    } finally {
      usageRepo.record = originalRecord;
    }
  });
});