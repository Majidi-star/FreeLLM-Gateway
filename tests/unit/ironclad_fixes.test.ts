import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { calculateCooldownMs } from '../../src/domain/resilience/cooldown.js';
import { redactSensitiveData } from '../../src/infra/logger.js';
import { translateRequestToProvider } from '../../src/domain/translation/openaiToProvider.js';
import { callProviderEndpoint } from '../../src/infra/http/providerClient.js';
import { GatewayService, locallyExpiredConnectionIds } from '../../src/services/gatewayService.js';
import { ConnectionRepository } from '../../src/infra/db/repositories/connectionRepo.js';
import { ModelRepository } from '../../src/infra/db/repositories/modelRepo.js';
import { ProviderRepository } from '../../src/infra/db/repositories/providerRepo.js';
import { PoolRepository } from '../../src/infra/db/repositories/poolRepo.js';
import { HealthRepository } from '../../src/infra/db/repositories/healthRepo.js';
import { QuotaRepository } from '../../src/infra/db/repositories/quotaRepo.js';
import { RequestLogRepository } from '../../src/infra/db/repositories/requestLogRepo.js';
import { encryptCredential } from '../../src/infra/security/vault.js';
import { AppError, AllTargetsExhaustedError } from '../../src/shared/errors.js';

import { getDatabase } from '../../src/infra/db/client.js';
import { runMigrations } from '../../src/infra/db/migrationRunner.js';

describe('OPERATION IRONCLAD REMEDIATION (R1 - R8)', () => {
  describe('R1: Cloudflare WAF 403 vs Terminal Auth Triage', () => {
    let db: Database.Database;
    let poolRepo: PoolRepository;
    let connRepo: ConnectionRepository;
    let modelRepo: ModelRepository;
    let provRepo: ProviderRepository;
    let healthRepo: HealthRepository;
    let quotaRepo: QuotaRepository;
    let logRepo: RequestLogRepository;
    let gateway: GatewayService;

    beforeEach(() => {
      process.env.ENCRYPTION_MASTER_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
      db = getDatabase(':memory:');
      runMigrations(db);

      poolRepo = new PoolRepository(db);
      connRepo = new ConnectionRepository(db);
      modelRepo = new ModelRepository(db);
      provRepo = new ProviderRepository(db);
      healthRepo = new HealthRepository(db);
      quotaRepo = new QuotaRepository(db);
      logRepo = new RequestLogRepository(db);
      gateway = new GatewayService(poolRepo, connRepo, modelRepo, provRepo, healthRepo, quotaRepo, logRepo);
      locallyExpiredConnectionIds.clear();
    });

    afterEach(() => {
      db.close();
      vi.restoreAllMocks();
    });

    it('does NOT mark connection expired on Cloudflare WAF HTML 403, and records failure in circuit breaker', async () => {
      const now = Date.now();
      const prov = provRepo.upsert({ slug: 'cf_prov', display_name: 'CF Provider', base_url: 'https://cf.api', protocol: 'openai', auth_type: 'api_key', is_active: 1 });
      const enc = encryptCredential('secret_key');
      const conn = connRepo.create({ provider_id: prov.id, label: 'CF Conn', credential_enc: enc.ciphertext, credential_iv: enc.iv, credential_tag: enc.tag, tier: 'free', status: 'healthy', last_tested_at: now, last_error: null });
      const mdl = modelRepo.upsert({ provider_id: prov.id, model_name: 'm1', display_name: 'M1', context_window: 4096, supports_tools: 1, supports_vision: 0, cost_input_per_1k: 0, cost_output_per_1k: 0, task_fitness: '{}' });
      const { pool } = poolRepo.createPool({ goal_id: null, name: 'CF Pool', policy: 'fill_first', is_active: 1 }, [{ order_index: 0, connection_id: conn.id, model_id: mdl.id, role: 'primary', weight: 1.0 }]);

      // Mock fetch returning Cloudflare 403 HTML challenge page
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: false,
        status: 403,
        headers: new Headers({ 'content-type': 'text/html' }),
        text: async () => '<html><head><title>Just a moment...</title></head><body>Cloudflare WAF Challenge</body></html>',
        json: async () => ({}),
      } as Response);

      await expect(gateway.dispatch(pool.id, { model: 'm1', messages: [{ role: 'user', content: 'hello' }] })).rejects.toThrow(AllTargetsExhaustedError);

      const updatedConn = connRepo.findById(conn.id);
      expect(updatedConn?.status).toBe('healthy');
      expect(locallyExpiredConnectionIds.has(conn.id)).toBe(false);

      const health = healthRepo.get(conn.id);
      expect(health).toBeDefined();
      expect(health?.consecutive_failures).toBe(1);
    });
  });

  describe('R2 & R5: Expired/Banned Connection Pruning in Dispatch', () => {
    let db: Database.Database;
    let poolRepo: PoolRepository;
    let connRepo: ConnectionRepository;
    let modelRepo: ModelRepository;
    let provRepo: ProviderRepository;
    let healthRepo: HealthRepository;
    let quotaRepo: QuotaRepository;
    let logRepo: RequestLogRepository;
    let gateway: GatewayService;

    beforeEach(() => {
      process.env.ENCRYPTION_MASTER_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
      db = getDatabase(':memory:');
      runMigrations(db);

      poolRepo = new PoolRepository(db);
      connRepo = new ConnectionRepository(db);
      modelRepo = new ModelRepository(db);
      provRepo = new ProviderRepository(db);
      healthRepo = new HealthRepository(db);
      quotaRepo = new QuotaRepository(db);
      logRepo = new RequestLogRepository(db);
      gateway = new GatewayService(poolRepo, connRepo, modelRepo, provRepo, healthRepo, quotaRepo, logRepo);
      locallyExpiredConnectionIds.clear();
    });

    afterEach(() => {
      db.close();
      vi.restoreAllMocks();
    });

    it('skips expired/banned connections immediately with 0 outbound HTTP calls', async () => {
      const now = Date.now();
      const prov = provRepo.upsert({ slug: 'test_prov', display_name: 'Test Provider', base_url: 'https://test.api', protocol: 'openai', auth_type: 'api_key', is_active: 1 });
      const enc = encryptCredential('secret');
      const conn = connRepo.create({ provider_id: prov.id, label: 'Expired Conn', credential_enc: enc.ciphertext, credential_iv: enc.iv, credential_tag: enc.tag, tier: 'free', status: 'expired', last_tested_at: now, last_error: null });
      const mdl = modelRepo.upsert({ provider_id: prov.id, model_name: 'm1', display_name: 'M1', context_window: 4096, supports_tools: 1, supports_vision: 0, cost_input_per_1k: 0, cost_output_per_1k: 0, task_fitness: '{}' });
      const { pool } = poolRepo.createPool({ goal_id: null, name: 'Pool', policy: 'fill_first', is_active: 1 }, [{ order_index: 0, connection_id: conn.id, model_id: mdl.id, role: 'primary', weight: 1.0 }]);

      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      await expect(gateway.dispatch(pool.id, { model: 'm1', messages: [{ role: 'user', content: 'hi' }] })).rejects.toThrow(AllTargetsExhaustedError);

      expect(fetchSpy).toHaveBeenCalledTimes(0);
    });

    it('short-circuits concurrent in-flight requests targeting a connection marked locallyExpiredConnectionIds', async () => {
      const now = Date.now();
      const prov = provRepo.upsert({ slug: 'test_prov2', display_name: 'Test Provider 2', base_url: 'https://test.api', protocol: 'openai', auth_type: 'api_key', is_active: 1 });
      const enc = encryptCredential('secret');
      const conn = connRepo.create({ provider_id: prov.id, label: 'Conn 1', credential_enc: enc.ciphertext, credential_iv: enc.iv, credential_tag: enc.tag, tier: 'free', status: 'healthy', last_tested_at: now, last_error: null });
      const mdl = modelRepo.upsert({ provider_id: prov.id, model_name: 'm1', display_name: 'M1', context_window: 4096, supports_tools: 1, supports_vision: 0, cost_input_per_1k: 0, cost_output_per_1k: 0, task_fitness: '{}' });
      const { pool } = poolRepo.createPool({ goal_id: null, name: 'Pool', policy: 'fill_first', is_active: 1 }, [{ order_index: 0, connection_id: conn.id, model_id: mdl.id, role: 'primary', weight: 1.0 }]);

      locallyExpiredConnectionIds.add(conn.id);
      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      await expect(gateway.dispatch(pool.id, { model: 'm1', messages: [{ role: 'user', content: 'hi' }] })).rejects.toThrow(AllTargetsExhaustedError);

      expect(fetchSpy).toHaveBeenCalledTimes(0);
    });
  });

  describe('R3: Explicit Retry-After Overrides Local Cooldown Cap', () => {
    it('respects Retry-After: 120 and produces cooldown >= 120000ms', () => {
      const cooldownMs = calculateCooldownMs('api_key', 0, 120);
      expect(cooldownMs).toBe(120000);
      expect(cooldownMs).toBeGreaterThan(30000);
    });
  });

  describe('R4: Bulletproof Secret Redaction & Circular Protection', () => {
    it('redacts circular object without throwing RangeError', () => {
      const obj: any = { name: 'test' };
      obj.self = obj;

      expect(() => {
        const result = redactSensitiveData(obj);
        expect(result).toEqual({ name: 'test', self: '[CIRCULAR]' });
      }).not.toThrow();
    });

    it('redacts Groq gsk_, HuggingFace hf_, and URL-encoded query parameters api_key%3D...', () => {
      const text1 = 'Using Groq key gsk_12345678901234567890 in request';
      const text2 = 'Using HF key hf_12345678901234567890 in request';
      const text3 = 'URL param api_key%3Dgsk_secret123 in payload';

      expect(redactSensitiveData(text1)).toBe('Using Groq key gsk_[REDACTED] in request');
      expect(redactSensitiveData(text2)).toBe('Using HF key hf_[REDACTED] in request');
      expect(redactSensitiveData(text3)).toBe('URL param api_key%3D[REDACTED] in payload');
    });
  });

  describe('R6: Unbounded Response Body Memory Protection', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('aborts cleanly with 502 when Content-Length exceeds 15MB safety limit', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-length': '50000000', 'content-type': 'application/json' }),
        json: async () => ({}),
        text: async () => '',
      } as Response);

      await expect(callProviderEndpoint({
        baseUrl: 'https://api.test',
        endpoint: '/v1/chat',
        apiKey: 'key',
      })).rejects.toThrow('Upstream payload exceeds maximum safety limit (15MB)');
    });
  });

  describe('R7: Gemini Protocol Parity', () => {
    it('guarantees first turn role is user when starting with an assistant turn', () => {
      const translated = translateRequestToProvider(
        {
          model: 'gemini-1.5-pro',
          messages: [
            { role: 'assistant', content: 'Hi' },
            { role: 'user', content: 'Next' },
          ],
        },
        'gemini',
        'gemini-1.5-pro'
      );

      const contents = translated.body.contents as Array<{ role: string; parts: Array<{ text: string }> }>;
      expect(contents[0].role).toBe('user');
    });

    it('strips empty or whitespace-only user messages', () => {
      const translated = translateRequestToProvider(
        {
          model: 'gemini-1.5-pro',
          messages: [
            { role: 'user', content: '   ' },
          ],
        },
        'gemini',
        'gemini-1.5-pro'
      );

      const contents = translated.body.contents as Array<{ role: string; parts: Array<{ text: string }> }>;
      expect(contents).toHaveLength(0);
    });
  });

  describe('R8: Anthropic System Prompt Sanitization', () => {
    it('sanitizes empty system messages and formats valid system texts cleanly', () => {
      const translated = translateRequestToProvider(
        {
          model: 'claude-3-5-sonnet',
          messages: [
            { role: 'system', content: '' },
            { role: 'system', content: 'Instructions' },
            { role: 'user', content: 'Hello' },
          ],
        },
        'anthropic',
        'claude-3-5-sonnet'
      );

      expect(translated.body.system).toBe('Instructions');
    });
  });
});
