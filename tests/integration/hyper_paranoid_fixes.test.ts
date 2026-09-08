import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { buildApp } from '../../src/api/server.js';
import { getConfig } from '../../src/infra/config.js';
import { getDatabase, closeDatabase } from '../../src/infra/db/client.js';
import { runMigrations } from '../../src/infra/db/migrationRunner.js';
import { ProviderRepository } from '../../src/infra/db/repositories/providerRepo.js';
import { ConnectionRepository } from '../../src/infra/db/repositories/connectionRepo.js';
import { ModelRepository } from '../../src/infra/db/repositories/modelRepo.js';
import { PoolRepository } from '../../src/infra/db/repositories/poolRepo.js';
import { HealthRepository } from '../../src/infra/db/repositories/healthRepo.js';
import { QuotaRepository } from '../../src/infra/db/repositories/quotaRepo.js';
import { RequestLogRepository } from '../../src/infra/db/repositories/requestLogRepo.js';
import { GatewayService, breakerRegistry, locallyExpiredConnectionIds } from '../../src/services/gatewayService.js';
import { encryptCredential } from '../../src/infra/security/vault.js';
import { callProviderEndpoint, readBoundedBody } from '../../src/infra/http/providerClient.js';
import { AllTargetsExhaustedError, AppError } from '../../src/shared/errors.js';
import { CircuitBreaker } from '../../src/domain/resilience/circuitBreaker.js';

describe('OPERATION HYPER-PARANOID REMEDIATION REGRESSION SUITE', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_MASTER_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    breakerRegistry.clear();
    locallyExpiredConnectionIds.clear();
  });

  afterEach(() => {
    closeDatabase();
    vi.restoreAllMocks();
    breakerRegistry.clear();
    locallyExpiredConnectionIds.clear();
  });

  // 1. Auth Gate Test
  describe('1. Auth Gate Test', () => {
    it('rejects /api/v1/providers and /api/v1/request-logs without Bearer token with 401 Unauthorized', async () => {
      const app = await buildApp();
      const adminToken = getConfig().ADMIN_API_TOKEN;

      // Without token -> 401
      const resProvidersNoAuth = await app.inject({
        method: 'GET',
        url: '/api/v1/providers',
      });
      expect(resProvidersNoAuth.statusCode).toBe(401);
      const bodyNoAuth = JSON.parse(resProvidersNoAuth.body);
      expect(bodyNoAuth.error.message).toBe('Unauthorized');
      expect(bodyNoAuth.error.type).toBe('authentication_error');

      const resLogsNoAuth = await app.inject({
        method: 'GET',
        url: '/api/v1/request-logs',
      });
      expect(resLogsNoAuth.statusCode).toBe(401);

      // With valid Admin Bearer token -> 200
      const resProvidersAuth = await app.inject({
        method: 'GET',
        url: '/api/v1/providers',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
      });
      expect(resProvidersAuth.statusCode).toBe(200);

      const resLogsAuth = await app.inject({
        method: 'GET',
        url: '/api/v1/request-logs',
        headers: {
          authorization: `Bearer ${adminToken}`,
        },
      });
      expect(resLogsAuth.statusCode).toBe(200);

      await app.close();
    });
  });

  // 2. Concurrency Quota Overcommit Test
  describe('2. Concurrency Quota Overcommit Test', () => {
    it('prevents TOCTOU overcommit by pre-reserving quota and rejecting excess concurrent requests', async () => {
      const db = getDatabase(':memory:');
      runMigrations(db);

      const providerRepo = new ProviderRepository(db);
      const connectionRepo = new ConnectionRepository(db);
      const modelRepo = new ModelRepository(db);
      const poolRepo = new PoolRepository(db);
      const healthRepo = new HealthRepository(db);
      const quotaRepo = new QuotaRepository(db);
      const logRepo = new RequestLogRepository(db);

      const prov = providerRepo.upsert({ slug: 'mock_quota_prov', display_name: 'Mock Quota', base_url: 'https://mock.api', protocol: 'openai', auth_type: 'api_key', is_active: 1 });
      const enc = encryptCredential('test_key');
      const conn = connectionRepo.create({ provider_id: prov.id, label: 'Quota Conn', credential_enc: enc.ciphertext, credential_iv: enc.iv, credential_tag: enc.tag, tier: 'free', status: 'healthy', last_tested_at: Date.now(), last_error: null });
      const mdl = modelRepo.upsert({ provider_id: prov.id, model_name: 'm_quota', display_name: 'MQ', context_window: 4096, supports_tools: 1, supports_vision: 0, cost_input_per_1k: 0, cost_output_per_1k: 0, task_fitness: '{}' });

      const { pool } = poolRepo.createPool(
        { goal_id: null, name: 'Quota Pool', policy: 'fill_first', is_active: 1 },
        [{ order_index: 0, connection_id: conn.id, model_id: mdl.id, role: 'primary', weight: 1.0 }]
      );

      // Set quota limit to exactly 2,000 tokens daily
      quotaRepo.setPolicy({
        connection_id: conn.id,
        dimension: 'daily_tokens',
        window_seconds: 86400,
        limit_value: 2000,
        reset_anchor: 'rolling',
      });

      // Mock fetch with artificial delay to ensure concurrency overlap
      vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            id: 'chatcmpl-quota-test',
            object: 'chat.completion',
            choices: [{ index: 0, message: { role: 'assistant', content: 'hello' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 500, completion_tokens: 500, total_tokens: 1000 },
          }),
          text: async () => JSON.stringify({
            id: 'chatcmpl-quota-test',
            object: 'chat.completion',
            choices: [{ index: 0, message: { role: 'assistant', content: 'hello' }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 500, completion_tokens: 500, total_tokens: 1000 },
          }),
        } as Response;
      });

      const gateway = new GatewayService(poolRepo, connectionRepo, modelRepo, providerRepo, healthRepo, quotaRepo, logRepo);

      // Dispatch 10 concurrent requests requesting 1,000 tokens each
      const reqPayload = { model: 'm_quota', messages: [{ role: 'user', content: 'hi' }], max_tokens: 1000 };
      const results = await Promise.allSettled(Array.from({ length: 10 }, () => gateway.dispatch(pool.id, reqPayload)));

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      // Maximum 2 requests should succeed (2 * 1,000 = 2,000 tokens), remaining 8 rejected
      expect(fulfilled.length).toBeLessThanOrEqual(2);
      expect(rejected.length).toBeGreaterThanOrEqual(8);
    });
  });

  // 3. Half-Open Concurrency Test
  describe('3. Half-Open Concurrency Test', () => {
    it('dispatches exactly 1 probe request in half_open state while gating concurrent requests', async () => {
      const db = getDatabase(':memory:');
      runMigrations(db);

      const providerRepo = new ProviderRepository(db);
      const connectionRepo = new ConnectionRepository(db);
      const modelRepo = new ModelRepository(db);
      const poolRepo = new PoolRepository(db);
      const healthRepo = new HealthRepository(db);
      const quotaRepo = new QuotaRepository(db);
      const logRepo = new RequestLogRepository(db);

      const prov = providerRepo.upsert({ slug: 'mock_ho_prov', display_name: 'Mock HO', base_url: 'https://mock.api', protocol: 'openai', auth_type: 'api_key', is_active: 1 });
      const enc = encryptCredential('test_key');
      const conn = connectionRepo.create({ provider_id: prov.id, label: 'HO Conn', credential_enc: enc.ciphertext, credential_iv: enc.iv, credential_tag: enc.tag, tier: 'free', status: 'healthy', last_tested_at: Date.now(), last_error: null });
      const mdl = modelRepo.upsert({ provider_id: prov.id, model_name: 'm_ho', display_name: 'MHO', context_window: 4096, supports_tools: 1, supports_vision: 0, cost_input_per_1k: 0, cost_output_per_1k: 0, task_fitness: '{}' });

      const { pool } = poolRepo.createPool(
        { goal_id: null, name: 'HO Pool', policy: 'fill_first', is_active: 1 },
        [{ order_index: 0, connection_id: conn.id, model_id: mdl.id, role: 'primary', weight: 1.0 }]
      );

      // Seed healthRepo in half_open state
      healthRepo.upsert({
        connection_id: conn.id,
        state: 'half_open',
        consecutive_failures: 5,
        opened_at: Date.now() - 60000,
        cooldown_until: null,
      });

      let outboundCalls = 0;
      vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        outboundCalls++;
        await new Promise((resolve) => setTimeout(resolve, 50));
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({ id: 'chatcmpl-ho-probe', choices: [{ message: { content: 'ok' } }] }),
          text: async () => JSON.stringify({ id: 'chatcmpl-ho-probe', choices: [{ message: { content: 'ok' } }] }),
        } as Response;
      });

      const gateway = new GatewayService(poolRepo, connectionRepo, modelRepo, providerRepo, healthRepo, quotaRepo, logRepo);

      // Fire 20 concurrent requests simultaneously
      const results = await Promise.allSettled(
        Array.from({ length: 20 }, () => gateway.dispatch(pool.id, { model: 'm_ho', messages: [{ role: 'user', content: 'hi' }] }))
      );

      // Exactly 1 probe outbound HTTP call should be issued
      expect(outboundCalls).toBe(1);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(19);
    });
  });

  // 4. Chunked Body Memory Cap Test
  describe('4. Chunked Body Memory Cap Test', () => {
    it('aborts payload reading and throws PAYLOAD_TOO_LARGE when chunked response exceeds 15MB limit', async () => {
      // Create a readable stream generating > 15MB chunks
      const chunk5MB = new Uint8Array(5 * 1024 * 1024);
      let chunksCount = 0;

      const mockBodyStream = new ReadableStream({
        async pull(controller) {
          if (chunksCount < 4) {
            controller.enqueue(chunk5MB);
            chunksCount++;
          } else {
            controller.close();
          }
        },
      });

      const mockResponse = new Response(mockBodyStream, {
        status: 200,
        headers: { 'content-type': 'application/json' }, // No content-length header
      });

      await expect(readBoundedBody(mockResponse, 15 * 1024 * 1024)).rejects.toThrow(
        'Upstream payload exceeds maximum safety limit (15MB)'
      );
    });
  });

  // 5. Malformed Model Metadata Test
  describe('5. Malformed Model Metadata Test', () => {
    it('handles corrupted JSON in models.task_fitness gracefully defaulting to empty object without 500 error', async () => {
      const db = getDatabase(':memory:');
      runMigrations(db);

      const providerRepo = new ProviderRepository(db);
      const connectionRepo = new ConnectionRepository(db);
      const modelRepo = new ModelRepository(db);
      const poolRepo = new PoolRepository(db);
      const healthRepo = new HealthRepository(db);
      const quotaRepo = new QuotaRepository(db);
      const logRepo = new RequestLogRepository(db);

      const prov = providerRepo.upsert({ slug: 'corrupt_prov', display_name: 'Corrupt Prov', base_url: 'https://corrupt.api', protocol: 'openai', auth_type: 'api_key', is_active: 1 });
      const enc = encryptCredential('test_key');
      const conn = connectionRepo.create({ provider_id: prov.id, label: 'Corrupt Conn', credential_enc: enc.ciphertext, credential_iv: enc.iv, credential_tag: enc.tag, tier: 'free', status: 'healthy', last_tested_at: Date.now(), last_error: null });
      
      // Inject corrupted JSON into task_fitness
      const mdl = modelRepo.upsert({
        provider_id: prov.id,
        model_name: 'm_corrupt',
        display_name: 'MC',
        context_window: 4096,
        supports_tools: 1,
        supports_vision: 0,
        cost_input_per_1k: 0,
        cost_output_per_1k: 0,
        task_fitness: '{{INVALID_JSON_CORRUPTED}}',
      });

      const { pool } = poolRepo.createPool(
        { goal_id: null, name: 'Corrupt Pool', policy: 'fill_first', is_active: 1 },
        [{ order_index: 0, connection_id: conn.id, model_id: mdl.id, role: 'primary', weight: 1.0 }]
      );

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ id: 'chatcmpl-corrupt-test', choices: [{ message: { content: 'hello' } }] }),
        text: async () => JSON.stringify({ id: 'chatcmpl-corrupt-test', choices: [{ message: { content: 'hello' } }] }),
      } as Response);

      const gateway = new GatewayService(poolRepo, connectionRepo, modelRepo, providerRepo, healthRepo, quotaRepo, logRepo);

      const res = await gateway.dispatch(pool.id, { model: 'm_corrupt', messages: [{ role: 'user', content: 'hi' }] });
      expect(res.response.id).toBe('chatcmpl-corrupt-test');
      expect(res.decisionTrace[0].status).toBe('selected');
    });
  });
});
