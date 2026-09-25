import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { getDatabase, closeDatabase } from '../infra/db/client.js';
import { runMigrations } from '../infra/db/migrationRunner.js';
import { ProviderRepository } from '../infra/db/repositories/providerRepo.js';
import { ConnectionRepository } from '../infra/db/repositories/connectionRepo.js';
import { ModelRepository } from '../infra/db/repositories/modelRepo.js';
import { GoalRepository } from '../infra/db/repositories/goalRepo.js';
import { PoolRepository } from '../infra/db/repositories/poolRepo.js';
import { HealthRepository } from '../infra/db/repositories/healthRepo.js';
import { QuotaRepository } from '../infra/db/repositories/quotaRepo.js';
import { GoalService } from './goalService.js';
import { PoolService } from './poolService.js';

describe('PoolService', () => {
  let db: Database.Database;
  let poolRepo: PoolRepository;
  let goalRepo: GoalRepository;
  let connectionRepo: ConnectionRepository;
  let providerRepo: ProviderRepository;
  let modelRepo: ModelRepository;
  let healthRepo: HealthRepository;
  let quotaRepo: QuotaRepository;
  let goalService: GoalService;
  let poolService: PoolService;

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

    goalService = new GoalService(goalRepo, connectionRepo, providerRepo, modelRepo, healthRepo, quotaRepo);
    poolService = new PoolService(poolRepo, goalService, modelRepo, providerRepo, connectionRepo);

    // Seed provider & model & connection
    const prov = providerRepo.upsert({
      slug: 'openai',
      display_name: 'OpenAI',
      base_url: 'https://api.openai.com/v1',
      auth_type: 'api_key',
      protocol: 'openai',
      capabilities: JSON.stringify({ vision: true }),
      is_active: 1,
    });

    const conn = connectionRepo.create({
      provider_id: prov.id,
      label: 'Main Key',
      credential_enc: Buffer.from('enc'),
      credential_iv: Buffer.from('123456789012'),
      credential_tag: Buffer.from('1234567890123456'),
      tier: 'free',
      status: 'active',
      last_tested_at: null,
      last_error: null,
    });

    modelRepo.upsert({
      provider_id: prov.id,
      model_name: 'gpt-4o',
      display_name: 'GPT-4o',
      context_window: 128000,
      cost_input_per_1k: 0.005,
      cost_output_per_1k: 0.015,
      is_active: 1,
      task_fitness: JSON.stringify({ coding_agent: 0.95 }),
    });
  });

  afterEach(() => {
    closeDatabase();
  });

  it('creates custom pool with steps', () => {
    const conn = connectionRepo.listAll()[0];
    const models = modelRepo.listAll();

    const pool = poolService.createCustomPool({
      name: 'Custom Test Pool',
      policy: 'fastest',
      steps: [
        {
          connectionId: conn.id,
          modelId: models[0].id,
          role: 'primary',
          weight: 2.0,
        },
      ],
    });

    expect(pool.name).toBe('Custom Test Pool');
    expect(pool.policy).toBe('fastest');
    expect(pool.steps).toHaveLength(1);
    expect(pool.steps[0].modelName).toBe('gpt-4o');
    expect(pool.steps[0].providerSlug).toBe('openai');
  });

  it('updates pool properties and steps', () => {
    const conn = connectionRepo.listAll()[0];
    const models = modelRepo.listAll();

    const created = poolService.createCustomPool({
      name: 'Initial Pool',
      policy: 'balanced',
      steps: [{ connectionId: conn.id, modelId: models[0].id }],
    });

    const updated = poolService.updatePool(created.id, {
      name: 'Updated Pool Name',
      policy: 'cheapest',
      isActive: false,
    });

    expect(updated.name).toBe('Updated Pool Name');
    expect(updated.policy).toBe('cheapest');
    expect(updated.isActive).toBe(false);
  });

  it('deletes pool', () => {
    const conn = connectionRepo.listAll()[0];
    const models = modelRepo.listAll();

    const created = poolService.createCustomPool({
      name: 'To Delete',
      steps: [{ connectionId: conn.id, modelId: models[0].id }],
    });

    poolService.deletePool(created.id);
    expect(() => poolService.getPool(created.id)).toThrow();
  });
});
