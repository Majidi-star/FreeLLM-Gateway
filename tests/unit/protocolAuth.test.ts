import { describe, it, expect, vi, beforeEach } from 'vitest';
import { translateRequestToProvider } from '../../src/domain/translation/openaiToProvider.js';
import { callProviderEndpoint } from '../../src/infra/http/providerClient.js';
import { ProviderService } from '../../src/services/providerService.js';
import { encryptCredential } from '../../src/infra/security/vault.js';

describe('Protocol Auth & Role Merging', () => {
  describe('OpenAI to Provider Translation', () => {
    it('merges consecutive user turns into a single turn in Gemini output', () => {
      const translated = translateRequestToProvider(
        {
          model: 'gemini-1.5-pro',
          messages: [
            { role: 'system', content: 'You are helpful.' },
            { role: 'user', content: 'First message' },
            { role: 'user', content: 'Second message' },
            { role: 'assistant', content: 'First response' },
            { role: 'assistant', content: 'Second response' },
            { role: 'user', content: 'Third message' },
          ],
        },
        'gemini',
        'gemini-1.5-pro'
      );

      expect(translated.endpoint).toBe('/v1beta/models/gemini-1.5-pro:generateContent');
      expect(translated.body.system_instruction).toEqual({
        parts: [{ text: 'You are helpful.' }],
      });

      const contents = translated.body.contents as Array<{ role: string; parts: Array<{ text: string }> }>;
      expect(contents).toHaveLength(3);
      expect(contents[0]).toEqual({
        role: 'user',
        parts: [{ text: 'First message' }, { text: 'Second message' }],
      });
      expect(contents[1]).toEqual({
        role: 'model',
        parts: [{ text: 'First response' }, { text: 'Second response' }],
      });
      expect(contents[2]).toEqual({
        role: 'user',
        parts: [{ text: 'Third message' }],
      });
    });

    it('concatenates multiple system messages in Anthropic translation and handles empty message array with fallback turn', () => {
      const translatedWithSystems = translateRequestToProvider(
        {
          model: 'claude-3-opus',
          messages: [
            { role: 'system', content: 'System prompt 1' },
            { role: 'system', content: 'System prompt 2' },
          ],
        },
        'anthropic',
        'claude-3-opus'
      );

      expect(translatedWithSystems.body.system).toBe('System prompt 1\n\nSystem prompt 2');
      expect(translatedWithSystems.body.messages).toEqual([
        { role: 'user', content: 'Proceed.' },
      ]);
    });
  });

  describe('Protocol-Aware Headers in callProviderEndpoint', () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it('sets x-api-key and anthropic-version for Anthropic', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ id: 'msg_1' }),
      } as Response);

      await callProviderEndpoint({
        baseUrl: 'https://api.anthropic.com',
        endpoint: '/v1/messages',
        apiKey: 'sk-ant-testkey123456',
        protocol: 'anthropic',
        method: 'POST',
        body: {},
      });

      expect(fetchSpy).toHaveBeenCalled();
      const headers = fetchSpy.mock.calls[0][1]?.headers as Record<string, string>;
      expect(headers['x-api-key']).toBe('sk-ant-testkey123456');
      expect(headers['anthropic-version']).toBe('2023-06-01');
      expect(headers['Authorization']).toBeUndefined();
    });

    it('sets x-goog-api-key for Gemini', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ candidates: [] }),
      } as Response);

      await callProviderEndpoint({
        baseUrl: 'https://generativelanguage.googleapis.com',
        endpoint: '/v1beta/models/gemini-1.5-flash:generateContent',
        apiKey: 'AIzaSyTestKey12345678901234567890',
        protocol: 'gemini',
        method: 'POST',
        body: {},
      });

      expect(fetchSpy).toHaveBeenCalled();
      const headers = fetchSpy.mock.calls[0][1]?.headers as Record<string, string>;
      expect(headers['x-goog-api-key']).toBe('AIzaSyTestKey12345678901234567890');
      expect(headers['Authorization']).toBeUndefined();
    });

    it('sets Authorization: Bearer for OpenAI', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ id: 'chatcmpl-1' }),
      } as Response);

      await callProviderEndpoint({
        baseUrl: 'https://api.openai.com',
        endpoint: '/v1/chat/completions',
        apiKey: 'sk-proj-testkey123456',
        protocol: 'openai',
        method: 'POST',
        body: {},
      });

      expect(fetchSpy).toHaveBeenCalled();
      const headers = fetchSpy.mock.calls[0][1]?.headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Bearer sk-proj-testkey123456');
    });
  });

  describe('Provider Health Probe Endpoints', () => {
    it('queries /v1beta/models for Gemini and /v1/models for Anthropic / OpenAI', async () => {
      const enc = encryptCredential('test-api-key');

      const mockProviderRepo = {
        findById: vi.fn().mockImplementation((id: string) => {
          if (id === 'p_gemini') return { id: 'p_gemini', slug: 'gemini', base_url: 'https://gemini.api', protocol: 'gemini' };
          if (id === 'p_anthropic') return { id: 'p_anthropic', slug: 'anthropic', base_url: 'https://anthropic.api', protocol: 'anthropic' };
          return { id: 'p_openai', slug: 'openai', base_url: 'https://openai.api', protocol: 'openai' };
        }),
      };

      const mockConnRepo = {
        findById: vi.fn().mockImplementation((id: string) => ({
          id,
          provider_id: `p_${id}`,
          credential_enc: enc.ciphertext,
          credential_iv: enc.iv,
          credential_tag: enc.tag,
        })),
        updateStatus: vi.fn(),
      };

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ models: [] }),
      } as Response);

      const providerService = new ProviderService(mockProviderRepo as any, mockConnRepo as any);

      await providerService.testConnection('gemini');
      expect(fetchSpy).toHaveBeenLastCalledWith('https://gemini.api/models', expect.anything());

      await providerService.testConnection('anthropic');
      expect(fetchSpy).toHaveBeenLastCalledWith('https://anthropic.api/models', expect.anything());

      await providerService.testConnection('openai');
      expect(fetchSpy).toHaveBeenLastCalledWith('https://openai.api/models', expect.anything());
    });
  });
});
