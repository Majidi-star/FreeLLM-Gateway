import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseRetryAfter, sanitizeErrorMessage } from '../../src/infra/http/providerClient.js';
import { GatewayService } from '../../src/services/gatewayService.js';
import { AllTargetsExhaustedError } from '../../src/shared/errors.js';
import { encryptCredential } from '../../src/infra/security/vault.js';

describe('Resilience & Error Hygiene', () => {
  describe('Retry-After Header Parsing', () => {
    it('parses integer seconds correctly', () => {
      expect(parseRetryAfter('120')).toBe(120);
      expect(parseRetryAfter('0')).toBe(0);
    });

    it('parses HTTP-date strings correctly', () => {
      const futureDate = new Date(Date.now() + 45000).toUTCString();
      const seconds = parseRetryAfter(futureDate);
      expect(seconds).toBeGreaterThanOrEqual(44);
      expect(seconds).toBeLessThanOrEqual(46);
    });

    it('returns undefined for invalid or null inputs', () => {
      expect(parseRetryAfter(null)).toBeUndefined();
      expect(parseRetryAfter('')).toBeUndefined();
      expect(parseRetryAfter('invalid')).toBeUndefined();
    });
  });

  describe('Upstream Error Sanitization', () => {
    it('sanitizes raw HTML responses into a truncated summary without HTML tags', () => {
      const rawHtml = `<!DOCTYPE html><html><head><title>502 Bad Gateway</title></head><body><h1>502 Bad Gateway</h1><p>nginx/1.18.0</p></body></html>`;
      const sanitized = sanitizeErrorMessage(502, rawHtml, 'text/html');

      expect(sanitized).toContain('[PROVIDER_ERROR] status=502 type=HTML snippet=');
      expect(sanitized).not.toContain('<h1>');
      expect(sanitized).not.toContain('</body>');
      expect(sanitized.length).toBeLessThanOrEqual(120);
    });

    it('handles JSON error responses gracefully', () => {
      const jsonErr = { error: { message: 'Rate limit exceeded' } };
      const sanitized = sanitizeErrorMessage(429, jsonErr, 'application/json');

      expect(sanitized).toBe('[PROVIDER_ERROR] status=429 type=JSON snippet={"message":"Rate limit exceeded"}');
    });
  });

  describe('Terminal Credential Errors (401/403)', () => {
    it('marks connection status as expired without tripping circuit breaker on 401', async () => {
      const connId = 'conn_auth_test';
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
        updateStatus: vi.fn(),
      };

      const mockPoolRepo = {
        findPoolById: vi.fn().mockReturnValue({ id: 'pool_1', is_active: 1, policy: 'fill_first' }),
        getPoolSteps: vi.fn().mockReturnValue([
          { id: 'step_1', pool_id: 'pool_1', order_index: 0, connection_id: connId, model_id: 'm_1', role: 'primary', weight: 1 },
        ]),
      };

      const mockModelRepo = {
        findById: vi.fn().mockReturnValue({ id: 'm_1', model_name: 'gpt-4o', task_fitness: '{}', cost_input_per_1k: 0, cost_output_per_1k: 0 }),
      };

      const mockProviderRepo = {
        findById: vi.fn().mockReturnValue({ id: 'p_openai', slug: 'openai', base_url: 'https://api.openai.com', protocol: 'openai', auth_type: 'api_key' }),
      };

      const healthStateStore: Record<string, any> = {};
      const mockHealthRepo = {
        get: vi.fn().mockImplementation((id: string) => healthStateStore[id] || null),
        upsert: vi.fn().mockImplementation((rec: any) => {
          healthStateStore[rec.connection_id] = rec;
          return rec;
        }),
      };

      const mockQuotaRepo = {
        getPolicy: vi.fn().mockReturnValue(null),
        getUsage: vi.fn().mockReturnValue(0),
        recordUsage: vi.fn(),
      };

      const mockLogRepo = {
        log: vi.fn(),
      };

      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: false,
        status: 401,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ error: { message: 'Invalid API key' } }),
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

      try {
        await gatewayService.dispatch('pool_1', { model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] });
        expect.fail('Should have thrown AllTargetsExhaustedError');
      } catch (err: any) {
        expect(err).toBeInstanceOf(AllTargetsExhaustedError);
        expect(mockConnRepo.updateStatus).toHaveBeenCalledWith(connId, 'expired', expect.stringContaining('Invalid API key'));
        expect(mockHealthRepo.upsert).not.toHaveBeenCalled();
        expect(err.decisionTrace[0].reason).toBe('CREDENTIAL_EXPIRED');
      }
    });
  });
});
