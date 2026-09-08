import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getWindowStart } from '../../src/domain/quota/slidingWindow.js';
import { redactSensitiveData, SENSITIVE_KEYS } from '../../src/infra/logger.js';
import { GatewayService } from '../../src/services/gatewayService.js';
import { encryptCredential } from '../../src/infra/security/vault.js';

describe('Quota Engine & Logging Security', () => {
  describe('Sliding-Window Bucket Calculation', () => {
    it('uses window_seconds to compute deterministic windowStart', () => {
      const nowMs = 1700000050000;
      const windowSeconds = 3600;

      const start = getWindowStart(nowMs, windowSeconds);
      expect(start).toBe(1699999200000);
      expect(start % (windowSeconds * 1000)).toBe(0);
    });
  });

  describe('Secret Redaction Hardening', () => {
    it('includes required sensitive key variants', () => {
      expect(SENSITIVE_KEYS).toContain('api-key');
      expect(SENSITIVE_KEYS).toContain('x-api-key');
      expect(SENSITIVE_KEYS).toContain('x-goog-api-key');
    });

    it('redacts sk- API keys, AIza Gemini keys, and query param token leaks in raw text', () => {
      const logText = 'Error connecting to https://api.openai.com/v1?api_key=sk-12345678901234567890 with key sk-proj-12345678901234567890 and Gemini AIzaSyABC12345678901234567890123456';
      const redacted = redactSensitiveData(logText) as string;

      expect(redacted).not.toContain('sk-12345678901234567890');
      expect(redacted).not.toContain('sk-proj-12345678901234567890');
      expect(redacted).not.toContain('AIzaSyABC12345678901234567890123456');
      expect(redacted).toContain('api_key=[REDACTED]');
      expect(redacted).toContain('sk-[REDACTED]');
      expect(redacted).toContain('AIza[REDACTED]');
    });

    it('redacts sensitive key fields in nested objects', () => {
      const payload = {
        headers: {
          'x-api-key': 'secret-anthropic-key',
          'x-goog-api-key': 'secret-gemini-key',
        },
        data: {
          'api-key': 'secret-key',
        },
      };

      const redacted = redactSensitiveData(payload) as any;
      expect(redacted.headers['x-api-key']).toBe('[REDACTED]');
      expect(redacted.headers['x-goog-api-key']).toBe('[REDACTED]');
      expect(redacted.data['api-key']).toBe('[REDACTED]');
    });
  });

  describe('Quota Engine Fail-Open & Missing Usage', () => {
    it('fails open when quota repo DB call throws an error', async () => {
      const connId = 'conn_quota_failopen';
      const enc = encryptCredential('test-api-key');

      const mockConnRepo = {
        findById: vi.fn().mockReturnValue({
          id: connId,
          provider_id: 'p_openai',
          credential_enc: enc.ciphertext,
          credential_iv: enc.iv,
          credential_tag: enc.tag,
          status: 'healthy',
        }),
      };

      const mockPoolRepo = {
        findPoolById: vi.fn().mockReturnValue({ id: 'pool_quota', is_active: 1, policy: 'fill_first' }),
        getPoolSteps: vi.fn().mockReturnValue([
          { id: 'step_1', pool_id: 'pool_quota', order_index: 0, connection_id: connId, model_id: 'm_1', role: 'primary', weight: 1 },
        ]),
      };

      const mockModelRepo = {
        findById: vi.fn().mockReturnValue({ id: 'm_1', model_name: 'gpt-4o', task_fitness: '{}', cost_input_per_1k: 0, cost_output_per_1k: 0 }),
      };

      const mockProviderRepo = {
        findById: vi.fn().mockReturnValue({ id: 'p_openai', slug: 'openai', base_url: 'https://api.openai.com', protocol: 'openai', auth_type: 'api_key' }),
      };

      const mockHealthRepo = {
        get: vi.fn().mockReturnValue(null),
        upsert: vi.fn(),
      };

      const mockQuotaRepo = {
        getPolicy: vi.fn().mockImplementation(() => {
          throw new Error('SQLite DB is locked (SQLITE_BUSY)');
        }),
        getUsage: vi.fn(),
        recordUsage: vi.fn(),
      };

      const mockLogRepo = { log: vi.fn() };

      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ id: 'chatcmpl-123', choices: [{ message: { content: 'hello' } }] }),
      } as Response);

      const gatewayService = new GatewayService(
        mockPoolRepo as any,
        mockConnRepo as any,
        mockModelRepo as any,
        mockProviderRepo as any,
        mockHealthRepo as any,
        mockQuotaRepo as any,
        mockLogRepo as any
      );

      const res = await gatewayService.dispatch('pool_quota', { model: 'gpt-4o', messages: [{ role: 'user', content: 'hello' }] });
      expect(res.response.id).toBe('chatcmpl-123');
      expect(res.decisionTrace[0].status).toBe('selected');
    });
  });
});
