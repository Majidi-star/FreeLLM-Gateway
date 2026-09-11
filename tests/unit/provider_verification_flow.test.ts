import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProviderService } from '../../src/services/providerService.js';
import { encryptCredential } from '../../src/infra/security/vault.js';
import { ProviderConnectionRecord } from '../../src/infra/db/repositories/connectionRepo.js';
import * as providerClient from '../../src/infra/http/providerClient.js';

import { decryptCredential } from '../../src/infra/security/vault.js';
import * as vaultModule from '../../src/infra/security/vault.js';
function makeConnectionRecord(overrides: Partial<ProviderConnectionRecord> = {}): ProviderConnectionRecord {
  return {
    id: 'conn-test',
    provider_id: 'prov-test',
    label: 'Test Key',
    credential_enc: Buffer.from('deadbeef', 'hex'),
    credential_iv: Buffer.from('0102030405060708090a0b0c', 'hex'),
    credential_tag: Buffer.from('101112131415161718191a1b1c1d1e1f', 'hex'),
    tier: 'free',
    status: 'active',
    last_tested_at: Date.now(),
    last_error: null,
    created_at: Date.now() - 60000,
    updated_at: Date.now(),
    ...overrides,
  };
}

describe('Provider Verification Flow & Error Propagation', () => {
  describe('getProvidersWithConnections() lastError DTO propagation', () => {
    it('propagates conn.last_error into lastError for configured degraded connections', () => {
      const errorMsg = 'HTTP 401: Invalid API key';
      const conn = makeConnectionRecord({
        status: 'unavailable',
        last_error: errorMsg,
        credential_enc: encryptCredential('sekret').ciphertext,
      });

      const mockProviderRepo = {
        listAll: vi.fn().mockReturnValue([
          { id: 'prov-test', slug: 'openai', display_name: 'OpenAI', base_url: 'https://api.openai.com/v1', protocol: 'openai' as const, docs_url: null, capabilities: '{}', is_active: 1, created_at: 0, updated_at: 0 },
        ]),
      };
      const mockConnRepo = {
        listAll: vi.fn().mockReturnValue([conn]),
      };

      const svc = new ProviderService(mockProviderRepo as any, mockConnRepo as any);
      const providers = svc.getProvidersWithConnections();
      const provider = providers.find((p) => p.slug === 'openai');

      expect(provider).toBeDefined();
      expect(provider?.lastError).toBe(errorMsg);
      expect(provider?.status).toBe('degraded');
      expect(provider?.hasKey).toBe(true);
    });

    it('returns null for lastError on configured healthy connections', () => {
      const conn = makeConnectionRecord({
        status: 'healthy',
        last_error: null,
        credential_enc: encryptCredential('sekret').ciphertext,
      });

      const mockProviderRepo = {
        listAll: vi.fn().mockReturnValue([
          { id: 'prov-test', slug: 'openai', display_name: 'OpenAI', base_url: 'https://api.openai.com/v1', protocol: 'openai' as const, docs_url: null, capabilities: '{}', is_active: 1, created_at: 0, updated_at: 0 },
        ]),
      };
      const mockConnRepo = {
        listAll: vi.fn().mockReturnValue([conn]),
      };

      const svc = new ProviderService(mockProviderRepo as any, mockConnRepo as any);
      const providers = svc.getProvidersWithConnections();
      const provider = providers.find((p) => p.slug === 'openai');

      expect(provider?.lastError).toBeNull();
      expect(provider?.status).toBe('active');
    });

    it('returns null for lastError on unconfigured providers (empty credential)', () => {
      const connWithEmptyCred = makeConnectionRecord({
        id: 'conn-empty',
        provider_id: 'prov-anthropic',
        credential_enc: Buffer.alloc(0),
        last_error: 'Stale error should not leak to frontend',
      });

      const mockProviderRepo = {
        listAll: vi.fn().mockReturnValue([
          { id: 'prov-anthropic', slug: 'anthropic', display_name: 'Anthropic', base_url: 'https://api.anthropic.com', protocol: 'anthropic' as const, docs_url: null, capabilities: '{}', is_active: 1, created_at: 0, updated_at: 0 },
        ]),
      };

      const mockConnRepo = {
        listAll: vi.fn().mockReturnValue([connWithEmptyCred]),
      };

      const svc = new ProviderService(mockProviderRepo as any, mockConnRepo as any);
      const providers = svc.getProvidersWithConnections();
      const provider = providers.find((p) => p.slug === 'anthropic');

      expect(provider).toBeDefined();
      expect(provider?.lastError).toBeNull();
      expect(provider?.status).toBe('unconfigured');
      expect(provider?.hasKey).toBe(false);
    });

    it('does not duplicate lastError when multiple connections exist per provider (newest wins)', () => {
      const oldConn = makeConnectionRecord({
        id: 'conn-old',
        provider_id: 'prov-test',
        last_error: 'Old stale error',
        created_at: Date.now() - 120000,
      });
      const newConn = makeConnectionRecord({
        id: 'conn-new',
        provider_id: 'prov-test',
        last_error: 'Fresh error from latest probe',
        created_at: Date.now() - 60000,
        credential_enc: encryptCredential('sekret').ciphertext,
      });

      const mockProviderRepo = {
        listAll: vi.fn().mockReturnValue([
          { id: 'prov-test', slug: 'openai', display_name: 'OpenAI', base_url: 'https://api.openai.com/v1', protocol: 'openai' as const, docs_url: null, capabilities: '{}', is_active: 1, created_at: 0, updated_at: 0 },
        ]),
      };
      const mockConnRepo = {
        listAll: vi.fn().mockReturnValue([newConn, oldConn]),
      };

      const svc = new ProviderService(mockProviderRepo as any, mockConnRepo as any);
      const providers = svc.getProvidersWithConnections();
      const provider = providers.find((p) => p.slug === 'openai');

      expect(provider?.lastError).toBe('Fresh error from latest probe');
      expect(provider?.hasKey).toBe(true);
    });
  });

  describe('testConnection() handshake failure error string surfacing', () => {
    it('captures error message from failed probe into connection last_error and returns it', async () => {
      const conn = makeConnectionRecord({
        id: 'conn-fail',
        provider_id: 'prov-test',
        credential_enc: encryptCredential('probe-test-key-1234567890').ciphertext,
        status: 'active',
        last_error: null,
      });

      const mockProviderRepo = {
        findById: vi.fn().mockReturnValue({ id: 'prov-test', slug: 'openai', display_name: 'OpenAI', base_url: 'https://api.openai.com/v1', protocol: 'openai' as const, docs_url: null, capabilities: '{}', is_active: 1, created_at: 0, updated_at: 0 }),
        listAll: vi.fn(),
      };
      const mockConnRepo = {
        findById: vi.fn().mockReturnValue(conn),
        updateStatus: vi.fn(),
      };

      const providerService = new ProviderService(mockProviderRepo as any, mockConnRepo as any);
      const decryptSpy = vi.spyOn(vaultModule, 'decryptCredential').mockReturnValue('probe-test-key-1234567890');
      const spy = vi.spyOn(providerClient, 'callProviderEndpoint').mockRejectedValue(
        new Error('HTTP 401: Invalid API key (snippet={\"error\":{\"message\":\"Incorrect API key\",\"type\":\"invalid_request_error\"}})')
      );

      const result = await providerService.testConnection('conn-fail');

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('Invalid API key');
      expect(mockConnRepo.updateStatus).toHaveBeenCalledWith('conn-fail', 'unavailable', expect.any(String));
      const lastErrorArg = (mockConnRepo.updateStatus as any).mock.calls.find((c: any) => c[0] === 'conn-fail')?.[2];
      expect(lastErrorArg).toContain('Invalid API key');

      decryptSpy.mockRestore();
      spy.mockRestore();
    });

    it('returns unconfigured error when credential is missing', async () => {
      const conn = makeConnectionRecord({
        id: 'conn-no-cred',
        provider_id: 'prov-test',
        credential_enc: Buffer.alloc(0),
        status: 'active',
        last_error: 'Stale error should stay stale',
      });

      const mockProviderRepo = {
        findById: vi.fn().mockReturnValue({ id: 'prov-test', slug: 'openai', display_name: 'OpenAI', base_url: 'https://api.openai.com/v1', protocol: 'openai' as const, docs_url: null, capabilities: '{}', is_active: 1, created_at: 0, updated_at: 0 }),
        listAll: vi.fn(),
      };
      const mockConnRepo = {
        findById: vi.fn().mockReturnValue(conn),
        updateStatus: vi.fn(),
      };

      const providerService = new ProviderService(mockProviderRepo as any, mockConnRepo as any);
      const result = await providerService.testConnection('conn-no-cred');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Connection is unconfigured — no credential present');
      expect(mockConnRepo.updateStatus).not.toHaveBeenCalled();
    });

    it('throws NotFoundError when connection id does not exist', async () => {
      const mockProviderRepo = {
        findById: vi.fn(),
        listAll: vi.fn(),
      };
      const mockConnRepo = {
        findById: vi.fn().mockReturnValue(null),
        updateStatus: vi.fn(),
      };

      const providerService = new ProviderService(mockProviderRepo as any, mockConnRepo as any);

      await expect(providerService.testConnection('conn-missing')).rejects.toThrow('Connection \'conn-missing\' not found');
      expect(mockConnRepo.updateStatus).not.toHaveBeenCalled();
    });
  });
});
