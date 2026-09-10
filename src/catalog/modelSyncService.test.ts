import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { getDatabase, closeDatabase } from '../infra/db/client.js';
import { runMigrations } from '../infra/db/migrationRunner.js';
import { ProviderRepository } from '../infra/db/repositories/providerRepo.js';
import { ModelRepository } from '../infra/db/repositories/modelRepo.js';
import { ConnectionRepository } from '../infra/db/repositories/connectionRepo.js';
import { encryptCredential } from '../infra/security/vault.js';
import { ModelSyncService } from './modelSyncService.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('ModelSyncService', () => {
  let db: Database.Database;
  let providerRepo: ProviderRepository;
  let modelRepo: ModelRepository;
  let connectionRepo: ConnectionRepository;
  let service: ModelSyncService;

  beforeEach(() => {
    process.env.ENCRYPTION_MASTER_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    db = getDatabase(':memory:');
    runMigrations(db);

    providerRepo = new ProviderRepository(db);
    modelRepo = new ModelRepository(db);
    connectionRepo = new ConnectionRepository(db);
    service = new ModelSyncService(providerRepo, connectionRepo, modelRepo);
  });

  afterEach(() => {
    closeDatabase();
    vi.restoreAllMocks();
  });

  function seedProvider(slug: string, protocol: 'openai' | 'anthropic' | 'gemini' = 'openai', baseUrl?: string) {
    const prov = providerRepo.upsert({
      slug,
      display_name: slug,
      base_url: baseUrl || `https://api.${slug}.com/v1`,
      auth_type: 'api_key',
      protocol,
      docs_url: null,
      capabilities: '{}',
      is_active: 1,
    });
    const enc = encryptCredential('test-key-123');
    connectionRepo.create({
      provider_id: prov.id,
      label: `${slug} key`,
      credential_enc: enc.ciphertext,
      credential_iv: enc.iv,
      credential_tag: enc.tag,
      tier: 'free',
      status: 'healthy',
      last_tested_at: null,
      last_error: null,
    });
    return prov;
  }

  function seedExistingModel(providerId: string) {
    modelRepo.upsert({
      provider_id: providerId,
      model_name: 'seeded-model',
      display_name: 'Seeded Model',
      context_window: 99000,
      supports_tools: 1,
      supports_vision: 0,
      cost_input_per_1k: 0,
      cost_output_per_1k: 0,
      bench_tps: null,
      bench_ttft_ms: null,
      bench_p95_latency_ms: null,
      task_fitness: '{}',
      is_active: 1,
    });
  }

  it('discovers and upserts OpenAI-compatible models with filtering and normalization', async () => {
    const prov = seedProvider('openai');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, {
      data: [
        { id: 'gpt-5', display_name: 'GPT-5', context_length: 1050000, input_modalities: ['text', 'image'] },
        { id: 'dall-e-3' },
        { id: 'tts-1' },
        { id: 'text-embedding-3-small' },
        { id: 'whisper-1' },
        { id: 'mystery-vision-model' },
        { id: 'plain-model' },
      ],
    })));

    const result = await service.syncAllConfiguredProviders();

    expect(result.syncedProviders).toEqual(['openai']);
    expect(result.totalModels).toBe(3);

    const models = modelRepo.listByProviderId(prov.id);
    const names = models.map((m) => m.model_name);
    expect(names).toContain('gpt-5');
    expect(names).toContain('mystery-vision-model');
    expect(names).not.toContain('dall-e-3');

    const gpt5 = models.find((m) => m.model_name === 'gpt-5')!;
    expect(gpt5.context_window).toBe(1050000);
    expect(gpt5.supports_vision).toBe(1);
    expect(gpt5.supports_tools).toBe(1);
    expect(gpt5.cost_input_per_1k).toBe(0);

    const plain = models.find((m) => m.model_name === 'plain-model')!;
    expect(plain.context_window).toBe(128000);
    expect(plain.supports_vision).toBe(0);
  });

  it('falls back Anthropic context window to 200,000', async () => {
    const prov = seedProvider('anthropic', 'anthropic');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, {
      data: [{ id: 'claude-sonnet-4-6', display_name: 'Claude Sonnet 4.6' }],
    })));

    const result = await service.syncAllConfiguredProviders();
    expect(result.syncedProviders).toEqual(['anthropic']);
    expect(result.totalModels).toBe(1);

    const models = modelRepo.listByProviderId(prov.id);
    expect(models[0].context_window).toBe(200000);
    expect(models[0].model_name).toBe('claude-sonnet-4-6');
  });

  it('filters Gemini models to generateContent and strips models/ prefix', async () => {
    const prov = seedProvider('gemini', 'gemini', 'https://generativelanguage.googleapis.com/v1beta');
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => {
      expect(url).toContain('pageSize=1000');
      expect(url).toContain('key=test-key-123');
      return jsonResponse(200, {
        models: [
          { name: 'models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', supportedGenerationMethods: ['generateContent'], inputTokenLimit: 1000000 },
          { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
          { name: 'models/imagen-4', supportedGenerationMethods: ['predict'] },
        ],
      });
    }));

    const result = await service.syncAllConfiguredProviders();
    expect(result.syncedProviders).toEqual(['gemini']);
    expect(result.totalModels).toBe(1);

    const models = modelRepo.listByProviderId(prov.id);
    expect(models[0].model_name).toBe('gemini-2.5-flash');
    expect(models[0].context_window).toBe(1000000);
  });

  it('retains existing seeded models on 401 and skips the provider', async () => {
    const prov = seedProvider('groq');
    seedExistingModel(prov.id);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(401, { error: 'invalid api key' })));

    const result = await service.syncAllConfiguredProviders();
    expect(result.syncedProviders).toEqual([]);
    expect(result.totalModels).toBe(0);

    const models = modelRepo.listByProviderId(prov.id);
    expect(models.map((m) => m.model_name)).toEqual(['seeded-model']);
    expect(models[0].context_window).toBe(99000);
  });

  it('retains existing seeded models on network errors', async () => {
    const prov = seedProvider('deepseek');
    seedExistingModel(prov.id);

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed: ECONNREFUSED')));

    const result = await service.syncAllConfiguredProviders();
    expect(result.syncedProviders).toEqual([]);

    const models = modelRepo.listByProviderId(prov.id);
    expect(models.map((m) => m.model_name)).toEqual(['seeded-model']);
  });

  it('skips providers without an active key', async () => {
    providerRepo.upsert({
      slug: 'mistral',
      display_name: 'mistral',
      base_url: 'https://api.mistral.ai/v1',
      auth_type: 'api_key',
      protocol: 'openai',
      docs_url: null,
      capabilities: '{}',
      is_active: 1,
    });
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const result = await service.syncAllConfiguredProviders();
    expect(result.syncedProviders).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
