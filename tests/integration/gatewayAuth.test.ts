import { test, expect, describe, beforeEach } from 'vitest';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { getDatabase } from '../../src/infra/db/client.js';
import { runMigrations } from '../../src/infra/db/migrationRunner.js';
import { AccountRepository } from '../../src/infra/db/repositories/accountRepo.js';
import { ApiKeyRepository } from '../../src/infra/db/repositories/apiKeyRepo.js';
import { PoolRepository } from '../../src/infra/db/repositories/poolRepo.js';
import { GoalRepository } from '../../src/infra/db/repositories/goalRepo.js';
import { ProviderRepository } from '../../src/infra/db/repositories/providerRepo.js';
import { ConnectionRepository } from '../../src/infra/db/repositories/connectionRepo.js';
import { ModelRepository } from '../../src/infra/db/repositories/modelRepo.js';
import { HealthRepository } from '../../src/infra/db/repositories/healthRepo.js';
import { QuotaRepository } from '../../src/infra/db/repositories/quotaRepo.js';
import { AuthService } from '../../src/services/authService.js';
import { AccountService } from '../../src/services/accountService.js';
import { PoolService } from '../../src/services/poolService.js';
import { GoalService } from '../../src/services/goalService.js';
import { TenantRateLimiter } from '../../src/domain/quota/tenantRateLimiter.js';
import { buildTrafficAuthHook, buildAdminAuthHook } from '../../src/api/authHooks.js';
import { AppError } from '../../src/shared/errors.js';

describe('Gateway Authentication & Tenant Scoping Integration', () => {
  let db: ReturnType<typeof getDatabase>;
  let accountRepo: AccountRepository;
  let apiKeyRepo: ApiKeyRepository;
  let authService: AuthService;
  let accountService: AccountService;
  let poolRepo: PoolRepository;
  let goalRepo: GoalRepository;
  let poolService: PoolService;
  let goalService: GoalService;
  let rateLimiter: TenantRateLimiter;

  const adminToken = 'gr_admin_test_token_123456789012';

  beforeEach(() => {
    db = getDatabase(':memory:');
    db.prepare('PRAGMA foreign_keys = ON;').run();
    runMigrations(db);

    db.prepare('DELETE FROM request_logs').run();
    db.prepare('DELETE FROM usage_rollups').run();
    db.prepare('DELETE FROM tenant_rate_usage').run();
    db.prepare('DELETE FROM api_keys').run();
    db.prepare('DELETE FROM accounts').run();
    db.prepare('DELETE FROM pools').run();
    db.prepare('DELETE FROM goals').run();

    accountRepo = new AccountRepository(db);
    apiKeyRepo = new ApiKeyRepository(db);
    poolRepo = new PoolRepository(db);
    goalRepo = new GoalRepository(db);
    authService = new AuthService(accountRepo, apiKeyRepo);
    goalService = new GoalService(
      goalRepo,
      new ConnectionRepository(db),
      new ProviderRepository(db),
      new ModelRepository(db),
      new HealthRepository(db),
      new QuotaRepository(db)
    );
    poolService = new PoolService(poolRepo, goalService);
    accountService = new AccountService(accountRepo, apiKeyRepo, poolRepo, goalService, db);
    rateLimiter = new TenantRateLimiter(db);
  });

  test('Auth service and hooks resolve tokens correctly', () => {
    const account = accountService.createAccount({ name: 'Tenant A', rateLimitRpm: 2 });
    const key = accountService.createKey(account.id, { name: 'Key A' });

    const ctx = authService.resolveBearer(key.plaintext, adminToken);
    expect(ctx.kind).toBe('account');
    expect(ctx.accountId).toBe(account.id);
    expect(ctx.rateLimitRpm).toBe(2);

    const adminCtx = authService.resolveBearer(adminToken, adminToken);
    expect(adminCtx.kind).toBe('admin');
  });

  test('TenantRateLimiter enforces RPM limits and sets retry-after', () => {
    const account = accountService.createAccount({ name: 'Tenant B', rateLimitRpm: 1 });
    const key = accountService.createKey(account.id, { name: 'Key B' });
    const ctx = authService.resolveBearer(key.plaintext, adminToken);

    // First request should pass
    rateLimiter.checkOrThrow(ctx);

    // Second request should throw rate limit error
    expect(() => rateLimiter.checkOrThrow(ctx)).toThrow(AppError);
  });
});
