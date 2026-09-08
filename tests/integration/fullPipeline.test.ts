import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildApp } from '../../src/api/server.js';
import { closeDatabase, getDatabase } from '../../src/infra/db/client.js';
import { runMigrations } from '../../src/infra/db/migrationRunner.js';
import { ProviderService } from '../../src/services/providerService.js';
import { CatalogService } from '../../src/catalog/catalogService.js';
import { GoalService } from '../../src/services/goalService.js';
import { PoolService } from '../../src/services/poolService.js';
import { ProviderRepository } from '../../src/infra/db/repositories/providerRepo.js';
import { ConnectionRepository } from '../../src/infra/db/repositories/connectionRepo.js';
import { ModelRepository } from '../../src/infra/db/repositories/modelRepo.js';
import { GoalRepository } from '../../src/infra/db/repositories/goalRepo.js';
import { PoolRepository } from '../../src/infra/db/repositories/poolRepo.js';
import { HealthRepository } from '../../src/infra/db/repositories/healthRepo.js';
import { QuotaRepository } from '../../src/infra/db/repositories/quotaRepo.js';

describe('GoalRoute End-to-End Integration Flow', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_MASTER_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  });

  afterEach(() => {
    closeDatabase();
  });

  it('runs complete lifecycle: catalog sync -> add connection -> create goal -> solve -> create pool -> fastify API health', async () => {
    const db = getDatabase(':memory:');
    runMigrations(db);

    const providerRepo = new ProviderRepository(db);
    const connectionRepo = new ConnectionRepository(db);
    const modelRepo = new ModelRepository(db);
    const goalRepo = new GoalRepository(db);
    const poolRepo = new PoolRepository(db);
    const healthRepo = new HealthRepository(db);
    const quotaRepo = new QuotaRepository(db);

    const catalogService = new CatalogService(providerRepo, modelRepo);
    const providerService = new ProviderService(providerRepo, connectionRepo);
    const goalService = new GoalService(goalRepo, connectionRepo, providerRepo, modelRepo, healthRepo, quotaRepo);
    const poolService = new PoolService(poolRepo, goalService);

    // 1. Catalog Sync
    const syncRes = catalogService.syncCatalog();
    expect(syncRes.providersCount).toBeGreaterThan(0);

    // 2. Add Connections
    const conn1 = providerService.addConnection({
      providerSlug: 'groq',
      label: 'Groq Primary Free',
      apiKey: 'gsk_test_key_groq_123',
      tier: 'free',
    });

    const conn2 = providerService.addConnection({
      providerSlug: 'cerebras',
      label: 'Cerebras Backup Free',
      apiKey: 'csk_test_key_cerebras_456',
      tier: 'free',
    });

    expect(conn1.id).toBeDefined();
    expect(conn2.id).toBeDefined();

    // 3. Create Goal
    const goal = goalService.createGoal({
      name: '4k req/day Coding Agent Goal',
      task_type: 'coding_agent',
      target_requests_per_day: 4000,
      target_tokens_per_day: 10000000,
      latency_pref: 'relaxed',
      budget_pref: 'free',
      budget_cap_usd_monthly: null,
      exhaustion_pref: 'preserve_backup',
      reliability_pref: 'standard',
      safety_margin_pct: 20.0,
    });

    expect(goal.id).toBeDefined();

    // 4. Solve Goal into PoolPlan
    const plan = goalService.solveGoalById(goal.id);
    expect(plan.feasible).toBe(true);
    expect(plan.steps.length).toBeGreaterThanOrEqual(2);

    // 5. Create Pool from Solved Goal Plan
    const pool = poolService.createPoolFromGoal(goal.id);
    expect(pool.id).toBeDefined();
    expect(pool.steps.length).toBe(plan.steps.length);
    expect(pool.policy).toBe('balanced');

    // 6. Verify Fastify HTTP app endpoints
    const app = await buildApp();
    const healthRes = await app.inject({
      method: 'GET',
      url: '/api/v1/health',
    });

    expect(healthRes.statusCode).toBe(200);
    const healthBody = JSON.parse(healthRes.body);
    expect(healthBody.status).toBe('healthy');

    await app.close();
  });
});
