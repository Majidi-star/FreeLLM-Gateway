import { callProviderEndpoint } from '../infra/http/providerClient.js';
import { translateRequestToProvider } from '../domain/translation/openaiToProvider.js';
import { translateResponseToOpenAI } from '../domain/translation/providerToOpenai.js';
import { OpenAIChatRequest, OpenAIChatResponse } from '../domain/translation/types.js';
import { AppError } from '../shared/errors.js';
import { logger } from '../infra/logger.js';

export type ExternalProtocol = 'auto' | 'openai' | 'anthropic' | 'gemini' | 'custom';

export interface ExternalEngineConfig {
  externalBaseUrl: string;
  externalApiKey?: string;
  externalModelName?: string;
  externalProtocol?: ExternalProtocol;
}

export interface TestExternalResult {
  ok: boolean;
  latencyMs: number;
  resolvedProtocol: 'openai' | 'anthropic' | 'gemini' | 'custom';
  modelName: string;
  message: string;
  details?: unknown;
}

export function resolveExternalProtocol(
  baseUrl: string,
  modelName?: string,
  requestedProtocol?: ExternalProtocol
): 'openai' | 'anthropic' | 'gemini' | 'custom' {
  if (requestedProtocol && requestedProtocol !== 'auto') {
    return requestedProtocol;
  }
  const lowerUrl = (baseUrl || '').toLowerCase();
  const lowerModel = (modelName || '').toLowerCase();

  if (lowerUrl.includes('anthropic') || lowerModel.startsWith('claude')) {
    return 'anthropic';
  }
  if (
    lowerUrl.includes('generativelanguage.googleapis') ||
    lowerUrl.includes('gemini') ||
    lowerModel.startsWith('gemini')
  ) {
    return 'gemini';
  }
  return 'openai';
}

export function normalizeExternalBaseUrl(rawUrl: string, resolvedProtocol: string): string {
  let clean = (rawUrl || '').trim();
  if (!clean) {
    if (resolvedProtocol === 'anthropic') return 'https://api.anthropic.com';
    if (resolvedProtocol === 'gemini') return 'https://generativelanguage.googleapis.com';
    return 'http://localhost:11434/v1';
  }

  if (!/^https?:\/\//i.test(clean)) {
    clean = `http://${clean}`;
  }

  clean = clean.replace(/\/+$/, '');

  // Strip standard endpoints from base URL if user included full endpoint path
  if (clean.endsWith('/chat/completions')) {
    clean = clean.slice(0, -'/chat/completions'.length);
  } else if (clean.endsWith('/v1/messages')) {
    clean = clean.slice(0, -'/v1/messages'.length);
  } else if (clean.endsWith('/messages')) {
    clean = clean.slice(0, -'/messages'.length);
  }

  return clean || 'http://localhost:11434/v1';
}

export class ExternalAgentService {
  public static async testConnection(config: ExternalEngineConfig): Promise<TestExternalResult> {
    const startTime = Date.now();
    const modelName = (config.externalModelName || '').trim() || 'default';
    const protocol = resolveExternalProtocol(config.externalBaseUrl, modelName, config.externalProtocol);
    const baseUrl = normalizeExternalBaseUrl(config.externalBaseUrl, protocol);

    const testRequest: OpenAIChatRequest = {
      model: modelName,
      messages: [{ role: 'user', content: 'Ping' }],
      max_tokens: 5,
    };

    try {
      const translated = translateRequestToProvider(testRequest, protocol, modelName);
      const res = await callProviderEndpoint({
        baseUrl,
        endpoint: translated.endpoint,
        apiKey: config.externalApiKey || '',
        protocol,
        method: 'POST',
        headers: translated.headers,
        body: translated.body,
        timeoutMs: 8000,
      });

      const latencyMs = Date.now() - startTime;

      if (res.statusCode >= 200 && res.statusCode < 300) {
        return {
          ok: true,
          latencyMs,
          resolvedProtocol: protocol,
          modelName,
          message: `Connection successful (${latencyMs}ms, ${protocol.toUpperCase()})`,
        };
      }

      return {
        ok: false,
        latencyMs,
        resolvedProtocol: protocol,
        modelName,
        message: `Upstream HTTP ${res.statusCode}: ${JSON.stringify(res.data).slice(0, 150)}`,
      };
    } catch (err: any) {
      const latencyMs = Date.now() - startTime;
      logger.warn({ err: err?.message, baseUrl, protocol }, 'External engine connection test failed');
      return {
        ok: false,
        latencyMs,
        resolvedProtocol: protocol,
        modelName,
        message: err?.message || 'Failed to connect to external endpoint',
      };
    }
  }

  public static async executeChat(
    chatRequest: OpenAIChatRequest,
    config: ExternalEngineConfig
  ): Promise<OpenAIChatResponse> {
    const targetModelName = (config.externalModelName || chatRequest.model || 'default').trim();
    const protocol = resolveExternalProtocol(config.externalBaseUrl, targetModelName, config.externalProtocol);
    const baseUrl = normalizeExternalBaseUrl(config.externalBaseUrl, protocol);

    const translated = translateRequestToProvider(chatRequest, protocol, targetModelName);

    const res = await callProviderEndpoint({
      baseUrl,
      endpoint: translated.endpoint,
      apiKey: config.externalApiKey || '',
      protocol,
      method: 'POST',
      headers: translated.headers,
      body: translated.body,
      timeoutMs: 60000,
    });

    if (res.statusCode < 200 || res.statusCode >= 300) {
      const errorMsg = typeof res.data === 'object' ? JSON.stringify(res.data) : String(res.data || '');
      throw new AppError(
        `External provider (${protocol.toUpperCase()}) error HTTP ${res.statusCode}: ${errorMsg.slice(0, 200)}`,
        'EXTERNAL_PROVIDER_ERROR',
        res.statusCode >= 400 && res.statusCode < 500 ? res.statusCode : 502
      );
    }

    const openAIResponse = translateResponseToOpenAI(res.data, protocol, targetModelName);
    return openAIResponse;
  }
}
