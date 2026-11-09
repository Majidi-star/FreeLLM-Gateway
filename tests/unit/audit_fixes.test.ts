import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { getDatabase, closeDatabase } from '../../src/infra/db/client.js';
import { runMigrations } from '../../src/infra/db/migrationRunner.js';
import { SystemSettingsRepository } from '../../src/infra/db/repositories/systemSettingsRepo.js';
import { PoolRepository } from '../../src/infra/db/repositories/poolRepo.js';
import { ConnectionRepository } from '../../src/infra/db/repositories/connectionRepo.js';
import { ModelRepository } from '../../src/infra/db/repositories/modelRepo.js';
import { ProviderRepository } from '../../src/infra/db/repositories/providerRepo.js';
import { GoalRepository } from '../../src/infra/db/repositories/goalRepo.js';
import { HealthRepository } from '../../src/infra/db/repositories/healthRepo.js';
import { QuotaRepository } from '../../src/infra/db/repositories/quotaRepo.js';
import { GoalService } from '../../src/services/goalService.js';
import { PoolService } from '../../src/services/poolService.js';
import { buildApp } from '../../src/api/server.js';
import { getConfig, resetConfigForTest } from '../../src/infra/config.js';
import { encryptCredential } from '../../src/infra/security/vault.js';
import { ValidationError } from '../../src/shared/errors.js';

describe('Audit Fixes Verification (A1-A6, D1-D7, P1-P6)', () => {
  let db: Database.Database;
  let systemSettingsRepo: SystemSettingsRepository;
  let poolRepo: PoolRepository;
  let connRepo: ConnectionRepository;
  let modelRepo: ModelRepository;
  let provRepo: ProviderRepository;
  let goalRepo: GoalRepository;
  let healthRepo: HealthRepository;
  let quotaRepo: QuotaRepository;
  let goalService: GoalService;
  let poolService: PoolService;

  beforeEach(() => {
    process.env.ENCRYPTION_MASTER_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    process.env.DATABASE_PATH = ':memory:';
    closeDatabase();
    db = getDatabase();
    runMigrations(db);

    systemSettingsRepo = new SystemSettingsRepository(db);
    poolRepo = new PoolRepository(db);
    connRepo = new ConnectionRepository(db);
    modelRepo = new ModelRepository(db);
    provRepo = new ProviderRepository(db);
    goalRepo = new GoalRepository(db);
    healthRepo = new HealthRepository(db);
    quotaRepo = new QuotaRepository(db);
    goalService = new GoalService(goalRepo, connRepo, provRepo, modelRepo, healthRepo, quotaRepo);
    poolService = new PoolService(poolRepo, goalService, modelRepo, provRepo, connRepo);
  });

  afterEach(() => {
    closeDatabase();
  });

  describe('Auth client and token persistence (A1, A3, A5)', () => {
    it('persists token changes to system_settings across server reboots', async () => {
      systemSettingsRepo.set('admin_api_token', 'sk-admin-new-secure-token-1234');
      expect(systemSettingsRepo.get('admin_api_token')).toBe('sk-admin-new-secure-token-1234');

      // Simulate server reboot by running buildApp
      const app = await buildApp();
      const config = getConfig();
      expect(config.ADMIN_API_TOKEN).toBe('sk-admin-new-secure-token-1234');
      await app.close();
    });

    it('rejects POST /api/v1/system/token without current admin authorization header', async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/system/token',
        payload: { token: 'sk-admin-unauthorized-attempt' },
      });

      expect(res.statusCode).toBe(401);
      const json = JSON.parse(res.payload);
      expect(json.error.code).toBe('AUTHENTICATION_ERROR');
      await app.close();
    });

    it('successfully changes admin token when authorized, and verifies it persists', async () => {
      const app = await buildApp();
      const config = getConfig();
      const currentToken = config.ADMIN_API_TOKEN;

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/system/token',
        headers: {
          authorization: `Bearer ${currentToken}`,
        },
        payload: { token: 'sk-admin-updated-successfully-8888' },
      });

      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.payload);
      expect(json.ok).toBe(true);
      expect(json.token).toBe('sk-admin-updated-successfully-8888');

      // Check DB persistence directly
      expect(systemSettingsRepo.get('admin_api_token')).toBe('sk-admin-updated-successfully-8888');
      await app.close();
    });
  });

  describe('Pool input validation & error formatting (P1, P3, P4)', () => {
    it('rejects pool creation with empty steps array (P4)', async () => {
      const app = await buildApp();
      const config = getConfig();

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/pools',
        headers: {
          authorization: `Bearer ${config.ADMIN_API_TOKEN}`,
        },
        payload: {
          name: 'Empty Pool',
          steps: [],
        },
      });

      expect(res.statusCode).toBe(400);
      const json = JSON.parse(res.payload);
      expect(json.error.message).toContain('at least one step');
      await app.close();
    });

    it('rejects pool creation when pool name is missing or empty (P1)', async () => {
      const app = await buildApp();
      const config = getConfig();

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/pools',
        headers: {
          authorization: `Bearer ${config.ADMIN_API_TOKEN}`,
        },
        payload: {
          name: '',
          steps: [{ connectionId: 'conn-1', modelId: 'model-1' }],
        },
      });

      expect(res.statusCode).toBe(400);
      const json = JSON.parse(res.payload);
      expect(json.error.message).toContain('name is required');
      await app.close();
    });

    it('rejects pool creation when connectionId does not exist (P1)', async () => {
      const app = await buildApp();
      const config = getConfig();

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/pools',
        headers: {
          authorization: `Bearer ${config.ADMIN_API_TOKEN}`,
        },
        payload: {
          name: 'Invalid Connection Pool',
          steps: [{ connectionId: 'non-existent-conn', modelId: 'non-existent-model' }],
        },
      });

      expect(res.statusCode).toBe(400);
      const json = JSON.parse(res.payload);
      expect(json.error.message).toContain('does not exist');
      await app.close();
    });

    it('rejects pool step when model provider does not match connection provider (P3)', async () => {
      // Create openai provider & connection
      const provOpenai = provRepo.upsert({
        slug: 'openai',
        display_name: 'OpenAI',
        base_url: 'https://api.openai.com',
        protocol: 'openai',
        auth_type: 'api_key',
        is_active: 1,
      });
      const encOpenai = encryptCredential('test-openai-key');
      const connOpenai = connRepo.create({
        provider_id: provOpenai.id,
        label: 'OpenAI Main',
        credential_enc: encOpenai.ciphertext,
        credential_iv: encOpenai.iv,
        credential_tag: encOpenai.tag,
        tier: 'free',
        status: 'healthy',
        last_tested_at: Date.now(),
        last_error: null,
      });

      // Create anthropic provider & model
      const provAnthropic = provRepo.upsert({
        slug: 'anthropic',
        display_name: 'Anthropic',
        base_url: 'https://api.anthropic.com',
        protocol: 'anthropic',
        auth_type: 'api_key',
        is_active: 1,
      });
      const modelClaude = modelRepo.upsert({
        provider_id: provAnthropic.id,
        model_name: 'claude-3-haiku',
        display_name: 'Claude 3 Haiku',
        context_window: 200000,
        supports_tools: 1,
        supports_vision: 1,
        cost_input_per_1k: 0.001,
        cost_output_per_1k: 0.002,
        task_fitness: '{}',
        is_active: 1,
      });

      const app = await buildApp();
      const config = getConfig();

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/pools',
        headers: {
          authorization: `Bearer ${config.ADMIN_API_TOKEN}`,
        },
        payload: {
          name: 'Cross Provider Mismatched Pool',
          steps: [
            {
              connectionId: connOpenai.id,
              modelId: modelClaude.id, // Claude model with OpenAI key
            },
          ],
        },
      });

      expect(res.statusCode).toBe(400);
      const json = JSON.parse(res.payload);
      expect(json.error.message).toContain('belongs to provider');
      await app.close();
    });
  });

  describe('Explicit Default Pool Routing (P5)', () => {
    it('sets and routes to explicit default pool even after new pools are added', async () => {
      const app = await buildApp();
      const config = getConfig();

      const provTest = provRepo.upsert({
        slug: 'groq',
        display_name: 'Groq',
        base_url: 'https://api.groq.com/openai/v1',
        protocol: 'openai',
        auth_type: 'api_key',
        is_active: 1,
      });
      const encTest = encryptCredential('test-key');
      const connTest = connRepo.create({
        provider_id: provTest.id,
        label: 'Test Connection',
        credential_enc: encTest.ciphertext,
        credential_iv: encTest.iv,
        credential_tag: encTest.tag,
        tier: 'free',
        status: 'healthy',
        last_tested_at: Date.now(),
        last_error: null,
      });
      const modelTest = modelRepo.upsert({
        provider_id: provTest.id,
        model_name: 'llama-3-8b-instant',
        display_name: 'Llama 3 8B Instant',
        context_window: 4096,
        supports_tools: 1,
        supports_vision: 0,
        cost_input_per_1k: 0,
        cost_output_per_1k: 0,
        task_fitness: '{}',
        is_active: 1,
      });

      // 1. Create first pool
      const poolA = poolService.createCustomPool({
        name: 'Pool A (Explicit Default)',
        steps: [{ connectionId: connTest.id, modelId: modelTest.id }],
      });

      // 2. Set Pool A as default
      poolRepo.setDefaultPool(poolA.id);
      expect(poolRepo.findPoolById(poolA.id)?.is_default).toBe(1);

      // 3. Create second newer pool later
      const poolB = poolService.createCustomPool({
        name: 'Pool B (Newer Test Pool)',
        steps: [{ connectionId: connTest.id, modelId: modelTest.id }],
      });

      expect(poolRepo.findPoolById(poolB.id)?.is_default).toBe(0);

      // Test default endpoint setting via API
      const resDefault = await app.inject({
        method: 'POST',
        url: `/api/v1/pools/${poolA.id}/default`,
        headers: { authorization: `Bearer ${config.ADMIN_API_TOKEN}` },
      });
      expect(resDefault.statusCode).toBe(200);
      const defaultDTO = JSON.parse(resDefault.payload);
      expect(defaultDTO.isDefault).toBe(true);

      // Verify routing resolution respects explicit default
      const pools = poolRepo.listPools();
      const explicitDefault = pools.find((p) => (p as any).is_default === 1);
      expect(explicitDefault?.id).toBe(poolA.id);

      await app.close();
    });
  });
});
