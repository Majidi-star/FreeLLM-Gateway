import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { buildApp } from '../../src/api/server.js';
import { getConfig } from '../../src/infra/config.js';
import { getDatabase, closeDatabase } from '../../src/infra/db/client.js';
import { runMigrations } from '../../src/infra/db/migrationRunner.js';
import { redactSensitiveData } from '../../src/infra/logger.js';
import { callProviderEndpoint, assertSafeProviderUrl } from '../../src/infra/http/providerClient.js';
import { AccountRepository } from '../../src/infra/db/repositories/accountRepo.js';
import { ApiKeyRepository } from '../../src/infra/db/repositories/apiKeyRepo.js';
import { PoolRepository } from '../../src/infra/db/repositories/poolRepo.js';
import { GoalRepository } from '../../src/infra/db/repositories/goalRepo.js';
import { AccountService } from '../../src/services/accountService.js';
import { GoalService } from '../../src/services/goalService.js';
import { AppError } from '../../src/shared/errors.js';

describe('Security Audit Remediation Tests', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_MASTER_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    process.env.DATABASE_PATH = ':memory:';
    closeDatabase();
  });

  afterEach(() => {
    closeDatabase();
    vi.restoreAllMocks();
  });

  describe('1. Admin Auth Bypass Prevention', () => {
    it('rejects /api/v1/providers with ?bypass=/system/endpoints query param with 401', async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/providers?bypass=/system/endpoints',
      });
      expect(res.statusCode).toBe(401);
      const json = JSON.parse(res.body);
      expect(json.error.code).toBe('AUTHENTICATION_ERROR');
      await app.close();
    });

    it('rejects /api/v1/accounts with ?bypass=/system/endpoints with 401', async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/accounts?test=/system/endpoints',
      });
      expect(res.statusCode).toBe(401);
      await app.close();
    });

    it('allows GET /api/v1/system/endpoints unauthenticated only from localhost when remote access is disabled', async () => {
      const app = await buildApp();
      // From localhost (127.0.0.1) -> 200
      const resLocal = await app.inject({
        method: 'GET',
        url: '/api/v1/system/endpoints',
      });
      expect(resLocal.statusCode).toBe(200);

      // From external IP -> 401
      const resRemote = await app.inject({
        method: 'GET',
        url: '/api/v1/system/endpoints',
        remoteAddress: '192.168.1.100',
      });
      expect(resRemote.statusCode).toBe(401);
      await app.close();
    });
  });

  describe('2. Sensitive Token Redaction in Logs', () => {
    it('redacts standalone gr_live_ API keys without requiring hf_ prefix', () => {
      const text = 'API key is gr_live_abcdef12345678901234567890 in gateway headers';
      const redacted = redactSensitiveData(text) as string;
      expect(redacted).not.toContain('gr_live_abcdef12345678901234567890');
      expect(redacted).toContain('gr_live_[REDACTED]');
    });

    it('redacts both hf_ and gr_live_ tokens properly', () => {
      const text = 'HuggingFace hf_12345678901234567890 and gateway gr_live_abcdef12345678901234567890';
      const redacted = redactSensitiveData(text) as string;
      expect(redacted).toContain('hf_[REDACTED]');
      expect(redacted).toContain('gr_live_[REDACTED]');
    });
  });

  describe('3. Main Port /v1/ Traffic Auth & Tenant Isolation', () => {
    it('rejects unauthenticated GET /v1/models with 401', async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: 'GET',
        url: '/v1/models',
      });
      expect(res.statusCode).toBe(401);
      await app.close();
    });

    it('allows GET /v1/models with admin token and returns active models', async () => {
      const app = await buildApp();
      const config = getConfig();
      const res = await app.inject({
        method: 'GET',
        url: '/v1/models',
        headers: {
          authorization: `Bearer ${config.ADMIN_API_TOKEN}`,
        },
      });
      expect(res.statusCode).toBe(200);
      const json = JSON.parse(res.body);
      expect(json.object).toBe('list');
      await app.close();
    });

    it('filters tenant-specific pools so account A cannot see account B pools in /v1/models', async () => {
      const db = getDatabase();
      runMigrations(db);

      const accountRepo = new AccountRepository(db);
      const apiKeyRepo = new ApiKeyRepository(db);
      const poolRepo = new PoolRepository(db);
      const goalRepo = new GoalRepository(db);
      const goalService = new GoalService(goalRepo, {} as any, {} as any, {} as any, {} as any, {} as any);
      const accountService = new AccountService(accountRepo, apiKeyRepo, poolRepo, goalService, db);

      const accA = accountService.createAccount({ name: 'Tenant A' });
      const keyA = accountService.createKey(accA.id, { name: 'Key A' });

      const accB = accountService.createAccount({ name: 'Tenant B' });

      // Create pool for Tenant B
      poolRepo.createPool({
        name: 'Private Pool B',
        account_id: accB.id,
        policy: 'fill_first',
        is_active: 1,
        goal_id: null,
      }, []);

      // Create global pool
      poolRepo.createPool({
        name: 'Global Shared Pool',
        account_id: null,
        policy: 'fill_first',
        is_active: 1,
        goal_id: null,
      }, []);

      const app = await buildApp();
      const resA = await app.inject({
        method: 'GET',
        url: '/v1/models',
        headers: {
          authorization: `Bearer ${keyA.plaintext}`,
        },
      });
      expect(resA.statusCode).toBe(200);
      const jsonA = JSON.parse(resA.body);
      const modelIds = jsonA.data.map((m: any) => m.id);
      expect(modelIds).toContain('Global Shared Pool');
      expect(modelIds).not.toContain('Private Pool B');
      await app.close();
    });
  });

  describe('4. SSRF & Protocol Safety in Provider Client', () => {
    it('blocks access to cloud instance metadata 169.254.169.254', async () => {
      expect(() => {
        assertSafeProviderUrl('http://169.254.169.254/latest/meta-data/');
      }).toThrowError(/cloud instance metadata service is blocked/i);

      expect(() => {
        assertSafeProviderUrl('http://metadata.google.internal/computeMetadata/v1/');
      }).toThrowError(/cloud instance metadata service is blocked/i);
    });

    it('rejects unsupported protocols like ftp or file', async () => {
      expect(() => {
        assertSafeProviderUrl('ftp://api.example.com/v1/chat');
      }).toThrowError(/Only HTTP and HTTPS are allowed/i);
    });

    it('allows valid http and https URLs', () => {
      expect(() => {
        assertSafeProviderUrl('https://api.openai.com/v1/chat/completions');
        assertSafeProviderUrl('http://localhost:11434/v1/chat/completions');
      }).not.toThrow();
    });
  });
});
