import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { getDatabase, closeDatabase } from '../infra/db/client.js';
import { runMigrations } from '../infra/db/migrationRunner.js';
import { ProviderRepository } from '../infra/db/repositories/providerRepo.js';
import { ModelRepository } from '../infra/db/repositories/modelRepo.js';
import { CatalogService } from './catalogService.js';

describe('CatalogService', () => {
  let db: Database.Database;
  let providerRepo: ProviderRepository;
  let modelRepo: ModelRepository;
  let service: CatalogService;

  beforeEach(() => {
    process.env.ENCRYPTION_MASTER_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    db = getDatabase(':memory:');
    runMigrations(db);

    providerRepo = new ProviderRepository(db);
    modelRepo = new ModelRepository(db);
    service = new CatalogService(providerRepo, modelRepo);
  });

  afterEach(() => {
    closeDatabase();
  });

  it('syncs catalog seed files idempotently', () => {
    const res1 = service.syncCatalog();
    expect(res1.providersCount).toBeGreaterThan(0);
    expect(res1.modelsCount).toBeGreaterThan(0);

    const providers = service.getProviders();
    expect(providers.some((p) => p.slug === 'groq')).toBe(true);

    const groqModels = service.getModelsForProvider('groq');
    expect(groqModels.length).toBeGreaterThan(0);

    // Second run must produce same count without duplicates
    const res2 = service.syncCatalog();
    expect(res2.providersCount).toBe(res1.providersCount);
    expect(service.getProviders().length).toBe(providers.length);
  });
});
