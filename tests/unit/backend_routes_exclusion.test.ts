import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { getDatabase, closeDatabase } from '../../src/infra/db/client.js';
import { runMigrations } from '../../src/infra/db/migrationRunner.js';
import { ProviderRepository } from '../../src/infra/db/repositories/providerRepo.js';
import { ConnectionRepository } from '../../src/infra/db/repositories/connectionRepo.js';
import { ModelRepository } from '../../src/infra/db/repositories/modelRepo.js';
import { GoalRepository } from '../../src/infra/db/repositories/goalRepo.js';
import { PoolRepository } from '../../src/infra/db/repositories/poolRepo.js';
import { HealthRepository } from '../../src/infra/db/repositories/healthRepo.js';
import { QuotaRepository } from '../../src/infra/db/repositories/quotaRepo.js';
import { RequestLogRepository } from '../../src/infra/db/repositories/requestLogRepo.js';
import { GatewayService, locallyExpiredConnectionIds, isConnectionActive, breakerRegistry } from '../../src/services/gatewayService.js';
import { ProviderService } from '../../src/services/providerService.js';
import { GoalService } from '../../src/services/goalService.js';
import { encryptCredential } from '../../src/infra/security/vault.js';
import { AllTargetsExhaustedError } from '../../src/shared/errors.js';
import { buildApp } from '../../src/api/server.js';
import { getConfig } from '../../src/infra/config.js';

describe('Backend Routes & Candidate Exclusion (REVOCATION, SSE, EXCLUSION)', () => {
  let db: Database.Database;
  let poolRepo: PoolRepository;
  let connRepo: ConnectionRepository;
  let modelRepo: ModelRepository;
  let provRepo: ProviderRepository;
  let healthRepo: HealthRepository;
  let quotaRepo: QuotaRepository;
  let logRepo: RequestLogRepository;
  let goalRepo: GoalRepository;
  let gateway: GatewayService;
  let providerService: ProviderService;
  let goalService: GoalService;

  beforeEach(() => {
    process.env.ENCRYPTION_MASTER_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    process.env.DATABASE_PATH = ':memory:';
    closeDatabase();
    db = getDatabase();
    runMigrations(db);

    poolRepo = new PoolRepository(db);
    connRepo = new ConnectionRepository(db);
    modelRepo = new ModelRepository(db);
    provRepo = new ProviderRepository(db);
    healthRepo = new HealthRepository(db);
    quotaRepo = new QuotaRepository(db);
    logRepo = new RequestLogRepository(db);
    goalRepo = new GoalRepository(db);

    providerService = new ProviderService(provRepo, connRepo);
    goalService = new GoalService(goalRepo, connRepo, provRepo, modelRepo, healthRepo, quotaRepo);
    gateway = new GatewayService(poolRepo, connRepo, modelRepo, provRepo, healthRepo, quotaRepo, logRepo);
    locallyExpiredConnectionIds.clear();
    breakerRegistry.clear();
  });

  afterEach(() => {
    closeDatabase();
    vi.restoreAllMocks();
  });

  describe('1. Candidate Routing Exclusion (Revoked/Expired/Non-Active)', () => {
    it('isConnectionActive helper returns false for revoked, expired, banned, unavailable, and unknown non-active statuses', () => {
      expect(isConnectionActive({ id: 'c1', status: 'healthy' })).toBe(true);
      expect(isConnectionActive({ id: 'c2', status: 'untested' })).toBe(true);
      expect(isConnectionActive({ id: 'c3', status: 'active' })).toBe(true);

      expect(isConnectionActive({ id: 'c4', status: 'revoked' })).toBe(false);
      expect(isConnectionActive({ id: 'c5', status: 'expired' })).toBe(false);
      expect(isConnectionActive({ id: 'c6', status: 'banned' })).toBe(false);
      expect(isConnectionActive({ id: 'c7', status: 'unavailable' })).toBe(false);
      expect(isConnectionActive({ id: 'c8', status: 'deleted' })).toBe(false);
      expect(isConnectionActive({ id: 'c9', status: 'unknown' })).toBe(false);
    });

    it('GatewayService excludes revoked and expired connections during candidate snapshot evaluation', async () => {
      const now = Date.now();
      const prov = provRepo.upsert({ slug: 'ex_prov', display_name: 'Ex Prov', base_url: 'https://ex.api', protocol: 'openai', auth_type: 'api_key', is_active: 1 });
      const enc = encryptCredential('secret');
      
      const connRevoked = connRepo.create({ provider_id: prov.id, label: 'Revoked Conn', credential_enc: enc.ciphertext, credential_iv: enc.iv, credential_tag: enc.tag, tier: 'free', status: 'revoked', last_tested_at: now, last_error: null });
      const connExpired = connRepo.create({ provider_id: prov.id, label: 'Expired Conn', credential_enc: enc.ciphertext, credential_iv: enc.iv, credential_tag: enc.tag, tier: 'free', status: 'expired', last_tested_at: now, last_error: null });
      const mdl = modelRepo.upsert({ provider_id: prov.id, model_name: 'm1', display_name: 'M1', context_window: 4096, supports_tools: 1, supports_vision: 0, cost_input_per_1k: 0, cost_output_per_1k: 0, task_fitness: '{}' });

      const { pool } = poolRepo.createPool({ goal_id: null, name: 'Ex Pool', policy: 'fill_first', is_active: 1 }, [
        { order_index: 0, connection_id: connRevoked.id, model_id: mdl.id, role: 'primary', weight: 1.0 },
        { order_index: 1, connection_id: connExpired.id, model_id: mdl.id, role: 'backup', weight: 1.0 },
      ]);

      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      await expect(gateway.dispatch(pool.id, { model: 'm1', messages: [{ role: 'user', content: 'hi' }] })).rejects.toThrow(AllTargetsExhaustedError);

      expect(fetchSpy).toHaveBeenCalledTimes(0);
    });

    it('GoalService solver candidate generation excludes connections marked as revoked or non-active', () => {
      const prov = provRepo.upsert({ slug: 'g_prov', display_name: 'G Prov', base_url: 'https://g.api', protocol: 'openai', auth_type: 'api_key', is_active: 1 });
      const enc = encryptCredential('secret');
      connRepo.create({ provider_id: prov.id, label: 'Revoked Conn', credential_enc: enc.ciphertext, credential_iv: enc.iv, credential_tag: enc.tag, tier: 'free', status: 'revoked', last_tested_at: Date.now(), last_error: null });
      modelRepo.upsert({ provider_id: prov.id, model_name: 'm1', display_name: 'M1', context_window: 4096, supports_tools: 1, supports_vision: 0, cost_input_per_1k: 0, cost_output_per_1k: 0, task_fitness: '{}' });

      const goal = goalRepo.create({ name: 'Test Goal', task_type: 'coding_agent', target_requests_per_day: 100, target_tokens_per_day: 10000, latency_pref: 'instant', budget_pref: 'free', budget_cap_usd_monthly: 0, exhaustion_pref: 'fill_first', reliability_pref: 'standard', safety_margin_pct: 10 });

      const plan = goalService.solveGoalById(goal.id);
      expect(plan.steps.length).toBe(0);
    });
  });

  describe('2. Credential Revocation Endpoint (DELETE /api/v1/providers/:id)', () => {
    it('revokes connection by ID, updates status in SQLite DB to revoked, and transitions circuit breaker state to OPEN', () => {
      const now = Date.now();
      const prov = provRepo.upsert({ slug: 'rev_prov', display_name: 'Rev Prov', base_url: 'https://rev.api', protocol: 'openai', auth_type: 'api_key', is_active: 1 });
      const enc = encryptCredential('secret');
      const conn = connRepo.create({ provider_id: prov.id, label: 'Conn to Revoke', credential_enc: enc.ciphertext, credential_iv: enc.iv, credential_tag: enc.tag, tier: 'free', status: 'healthy', last_tested_at: now, last_error: null });

      const res = providerService.revokeConnection(conn.id, healthRepo);
      expect(res.success).toBe(true);
      expect(res.status).toBe('revoked');

      const updatedConn = connRepo.findById(conn.id);
      expect(updatedConn?.status).toBe('revoked');
      expect(updatedConn?.last_error).toBe('Credential revoked by admin');

      const health = healthRepo.get(conn.id);
      expect(health?.state).toBe('open');

      const cb = breakerRegistry.get(conn.id);
      expect(cb?.getState()).toBe('open');
    });

    it('returns HTTP 200 with revoked status via DELETE /api/v1/providers/:id', async () => {
      const app = await buildApp();
      const config = getConfig();
      const prov = provRepo.upsert({ slug: 'api_rev_prov', display_name: 'API Rev Prov', base_url: 'https://rev.api', protocol: 'openai', auth_type: 'api_key', is_active: 1 });
      const enc = encryptCredential('secret');
      const conn = connRepo.create({ provider_id: prov.id, label: 'Conn API', credential_enc: enc.ciphertext, credential_iv: enc.iv, credential_tag: enc.tag, tier: 'free', status: 'healthy', last_tested_at: Date.now(), last_error: null });

      const response = await app.inject({
        method: 'DELETE',
        url: `/api/v1/providers/${conn.id}`,
        headers: {
          authorization: `Bearer ${config.ADMIN_API_TOKEN}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.status).toBe('revoked');

      const updated = connRepo.findById(conn.id);
      expect(updated?.status).toBe('revoked');
      await app.close();
    });

    it('revokes connection and verifies getProvidersWithConnections returns unconfigured state', () => {
      const prov = provRepo.upsert({ slug: 'rev_sync_prov', display_name: 'Rev Sync Prov', base_url: 'https://revsync.api', protocol: 'openai', auth_type: 'api_key', is_active: 1 });
      const enc = encryptCredential('secret');
      const conn = connRepo.create({ provider_id: prov.id, label: 'Conn Sync Rev', credential_enc: enc.ciphertext, credential_iv: enc.iv, credential_tag: enc.tag, tier: 'free', status: 'healthy', last_tested_at: Date.now(), last_error: null });

      expect(providerService.getProvidersWithConnections().find((p) => p.slug === 'rev_sync_prov')?.hasKey).toBe(true);

      const revRes = providerService.revokeConnection(conn.id, healthRepo);
      expect(revRes.success).toBe(true);

      const providers = providerService.getProvidersWithConnections();
      const target = providers.find((p) => p.slug === 'rev_sync_prov');
      expect(target).toBeDefined();
      expect(target?.hasKey).toBe(false);
      expect(target?.status).toBe('unconfigured');
      expect(target?.maskedKey).toBe('Not Configured');
    });
  });

  describe('3. Real-Time Log Stream (SSE GET /api/v1/request-logs/stream)', () => {
    it('pushes JSON event payload on gateway request completion and failover', async () => {
      const eventsEmitted: any[] = [];
      gateway.on('log', (evt) => eventsEmitted.push(evt));

      const now = Date.now();
      const prov = provRepo.upsert({ slug: 'sse_prov', display_name: 'SSE Prov', base_url: 'https://sse.api', protocol: 'openai', auth_type: 'api_key', is_active: 1 });
      const enc = encryptCredential('secret');
      const conn = connRepo.create({ provider_id: prov.id, label: 'SSE Conn', credential_enc: enc.ciphertext, credential_iv: enc.iv, credential_tag: enc.tag, tier: 'free', status: 'healthy', last_tested_at: now, last_error: null });
      const mdl = modelRepo.upsert({ provider_id: prov.id, model_name: 'm1', display_name: 'M1', context_window: 4096, supports_tools: 1, supports_vision: 0, cost_input_per_1k: 0, cost_output_per_1k: 0, task_fitness: '{}' });
      const { pool } = poolRepo.createPool({ goal_id: null, name: 'SSE Pool', policy: 'fill_first', is_active: 1 }, [{ order_index: 0, connection_id: conn.id, model_id: mdl.id, role: 'primary', weight: 1.0 }]);

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          id: 'chatcmpl-123',
          object: 'chat.completion',
          created: 123456,
          model: 'm1',
          choices: [{ index: 0, message: { role: 'assistant', content: 'hello sse' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }),
      } as Response);

      await gateway.dispatch(pool.id, { model: 'm1', messages: [{ role: 'user', content: 'hi' }] });

      expect(eventsEmitted.length).toBeGreaterThan(0);
      const lastEvent = eventsEmitted[eventsEmitted.length - 1];
      expect(lastEvent).toHaveProperty('traceId');
      expect(lastEvent).toHaveProperty('timestamp');
      expect(lastEvent.provider).toBe('sse_prov');
      expect(lastEvent.model).toBe('m1');
      expect(lastEvent.tokens).toEqual({ prompt: 10, completion: 5, total: 15 });
      expect(lastEvent).toHaveProperty('candidateTrace');
    });

    it('returns text/event-stream headers and connects stream via Fastify endpoint', async () => {
      const app = await buildApp();
      const config = getConfig();

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/request-logs/stream?once=true',
        headers: {
          authorization: `Bearer ${config.ADMIN_API_TOKEN}`,
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/event-stream');
      expect(response.headers['cache-control']).toBe('no-cache');
      expect(response.headers['connection']).toBe('keep-alive');
      await app.close();
    });
  });
});
