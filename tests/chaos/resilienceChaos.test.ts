import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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
import { GatewayService } from '../../src/services/gatewayService.js';
import { AllTargetsExhaustedError } from '../../src/shared/errors.js';

describe('Chaos & Resilience Test Suite', () => {
  let db: Database.Database;
  let providerRepo: ProviderRepository;
  let connectionRepo: ConnectionRepository;
  let modelRepo: ModelRepository;
  let goalRepo: GoalRepository;
  let poolRepo: PoolRepository;
  let healthRepo: HealthRepository;
  let quotaRepo: QuotaRepository;
  let logRepo: RequestLogRepository;
  let gatewayService: GatewayService;

  beforeEach(() => {
    process.env.ENCRYPTION_MASTER_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    db = getDatabase(':memory:');
    runMigrations(db);

    providerRepo = new ProviderRepository(db);
    connectionRepo = new ConnectionRepository(db);
    modelRepo = new ModelRepository(db);
    goalRepo = new GoalRepository(db);
    poolRepo = new PoolRepository(db);
    healthRepo = new HealthRepository(db);
    quotaRepo = new QuotaRepository(db);
    logRepo = new RequestLogRepository(db);

    gatewayService = new GatewayService(
      poolRepo,
      connectionRepo,
      modelRepo,
      providerRepo,
      healthRepo,
      quotaRepo,
      logRepo
    );
  });

  afterEach(() => {
    closeDatabase();
  });

  it('handles all providers unreachable by throwing AllTargetsExhaustedError with trace', async () => {
    const prov = providerRepo.upsert({
      slug: 'unreachable',
      display_name: 'Unreachable Provider',
      base_url: 'http://127.0.0.1:99999',
      auth_type: 'api_key',
      protocol: 'openai',
      capabilities: '{}',
    });

    const conn = connectionRepo.create({
      provider_id: prov.id,
      label: 'Bad Conn',
      credential_enc: Buffer.from('enc'),
      credential_iv: Buffer.from('iv'),
      credential_tag: Buffer.from('tag'),
      tier: 'free',
      status: 'untested',
      last_tested_at: null,
      last_error: null,
    });

    const mdl = modelRepo.upsert({
      provider_id: prov.id,
      model_name: 'bad-model',
      display_name: 'Bad Model',
      context_window: 4096,
      supports_tools: 0,
      supports_vision: 0,
      cost_input_per_1k: 0,
      cost_output_per_1k: 0,
      bench_tps: 10,
      bench_ttft_ms: 100,
      bench_p95_latency_ms: 500,
      task_fitness: '{}',
    });

    const { pool } = poolRepo.createPool(
      { goal_id: null, name: 'Chaos Pool', policy: 'fill_first', is_active: 1 },
      [{ order_index: 0, connection_id: conn.id, model_id: mdl.id, role: 'primary', weight: 1.0 }]
    );

    await expect(
      gatewayService.dispatch(pool.id, {
        model: 'bad-model',
        messages: [{ role: 'user', content: 'hello' }],
      })
    ).rejects.toThrow(AllTargetsExhaustedError);
  });

  it('skips open circuit breaker target step in pool dispatch', async () => {
    const prov = providerRepo.upsert({
      slug: 'groq',
      display_name: 'Groq',
      base_url: 'https://api.groq.com/openai/v1',
      auth_type: 'api_key',
      protocol: 'openai',
    });

    const conn = connectionRepo.create({
      provider_id: prov.id,
      label: 'Open Breaker Conn',
      credential_enc: Buffer.from('enc'),
      credential_iv: Buffer.from('iv'),
      credential_tag: Buffer.from('tag'),
      tier: 'free',
      status: 'healthy',
      last_tested_at: null,
      last_error: '500 Server Error',
    });

    const mdl = modelRepo.upsert({
      provider_id: prov.id,
      model_name: 'llama3',
      display_name: 'Llama 3',
      context_window: 8192,
      supports_tools: 1,
      supports_vision: 0,
      cost_input_per_1k: 0,
      cost_output_per_1k: 0,
      task_fitness: '{}',
    });

    healthRepo.upsert({
      connection_id: conn.id,
      state: 'open',
      consecutive_failures: 5,
      opened_at: Date.now(),
      cooldown_until: Date.now() + 60000,
    });

    const { pool } = poolRepo.createPool(
      { goal_id: null, name: 'Open Breaker Pool', policy: 'fill_first', is_active: 1 },
      [{ order_index: 0, connection_id: conn.id, model_id: mdl.id, role: 'primary', weight: 1.0 }]
    );

    try {
      await gatewayService.dispatch(pool.id, { model: 'llama3', messages: [{ role: 'user', content: 'test' }] });
    } catch (err: any) {
      expect(err).toBeInstanceOf(AllTargetsExhaustedError);
      expect(err.decisionTrace[0].status).toBe('skipped');
      expect(err.decisionTrace[0].reason).toContain('Circuit breaker is open');
    }
  });
});
