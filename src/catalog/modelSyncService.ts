import { ProviderRepository, ProviderRecord } from '../infra/db/repositories/providerRepo.js';
import { ConnectionRepository, ProviderConnectionRecord } from '../infra/db/repositories/connectionRepo.js';
import { ModelRepository } from '../infra/db/repositories/modelRepo.js';
import { decryptCredential } from '../infra/security/vault.js';
import { logger } from '../infra/logger.js';
import { AppError } from '../shared/errors.js';

const SYNC_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 15 * 1024 * 1024;
const DEFAULT_CONTEXT_WINDOW = 128_000;
const ANTHROPIC_CONTEXT_WINDOW = 200_000;

/** Provider slugs using the standard OpenAI-compatible GET /models endpoint. */
export const OPENAI_COMPATIBLE_SLUGS = new Set([
  'openai', 'groq', 'openrouter', 'together', 'cerebras',
  'sambanova', 'deepseek', 'mistral', 'fireworks', 'deepinfra',
]);

/** Non-chat model ID prefixes to drop during discovery. */
const FILTERED_MODEL_PREFIXES = [
  'dall-e', 'gpt-image', 'tts', 'whisper', 'text-embedding', 'bdr', 'rerank',
];

export interface DiscoveredModel {
  modelName: string;
  displayName: string;
  contextWindow: number;
  supportsVision: boolean;
  supportsTools: boolean;
}

export interface SyncResult {
  syncedProviders: string[];
  failedProviders: string[];
  totalModels: number;
}

export class ModelSyncService {
  constructor(
    private providerRepo: ProviderRepository,
    private connectionRepo: ConnectionRepository,
    private modelRepo: ModelRepository
  ) {}

  public async syncAllConfiguredProviders(): Promise<SyncResult> {
    const providers = this.providerRepo.listAll(true);
    const connections = this.connectionRepo.listAll();

    const activeConnByProviderId = new Map<string, ProviderConnectionRecord>();
    for (const c of connections) {
      // Revoked/deleted credentials must never be used for discovery.
      if (c.status === 'revoked' || c.status === 'deleted') continue;
      if (!activeConnByProviderId.has(c.provider_id)) {
        activeConnByProviderId.set(c.provider_id, c);
      }
    }

    const syncedProviders: string[] = [];
    const failedProviders: string[] = [];
    let totalModels = 0;

    for (const provider of providers) {
      const conn = activeConnByProviderId.get(provider.id);
      if (!conn) continue; // No active key in the vault — keep seeded models only.

      let apiKey: string;
      try {
        apiKey = decryptCredential({
          ciphertext: conn.credential_enc,
          iv: conn.credential_iv,
          tag: conn.credential_tag,
        });
      } catch {
        logger.warn({ providerSlug: provider.slug }, 'Could not decrypt credential for model sync, skipping provider');
        continue;
      }

      let discovered: DiscoveredModel[];
      try {
        if (provider.slug === 'anthropic') {
          discovered = await this.fetchAnthropicModels(provider, apiKey);
        } else if (provider.slug === 'gemini') {
          discovered = await this.fetchGeminiModels(provider, apiKey);
        } else if (OPENAI_COMPATIBLE_SLUGS.has(provider.slug)) {
          discovered = await this.fetchOpenAiCompatibleModels(provider, apiKey);
        } else {
          logger.debug({ providerSlug: provider.slug }, 'No live model-sync config for provider, skipping');
          continue;
        }
      } catch (err: any) {
        failedProviders.push(provider.display_name || provider.slug);
        const status = err instanceof AppError ? err.statusCode : err?.statusCode;
        if (status === 401 || status === 403) {
          logger.warn({ providerSlug: provider.slug, status }, 'Model sync rejected credentials; retaining existing seeded models');
        } else {
          logger.warn({ providerSlug: provider.slug, error: err?.message }, 'Model sync failed; retaining existing seeded models');
        }
        continue;
      }

      for (const model of discovered) {
        this.modelRepo.upsert({
          provider_id: provider.id,
          model_name: model.modelName,
          display_name: model.displayName,
          context_window: model.contextWindow,
          supports_tools: model.supportsTools ? 1 : 0,
          supports_vision: model.supportsVision ? 1 : 0,
          cost_input_per_1k: 0,
          cost_output_per_1k: 0,
          bench_tps: null,
          bench_ttft_ms: null,
          bench_p95_latency_ms: null,
          task_fitness: '{}',
          is_active: 1,
        });
      }

      totalModels += discovered.length;
      syncedProviders.push(provider.slug);
      logger.info({ providerSlug: provider.slug, modelCount: discovered.length }, 'Provider model catalog synced');
    }

    return { syncedProviders, failedProviders, totalModels };
  }

  /** GET ${baseUrl}/models with Bearer auth; parses `response.data[]`. */
  public async fetchOpenAiCompatibleModels(provider: ProviderRecord, apiKey: string): Promise<DiscoveredModel[]> {
    const body = await this.fetchJson<{ data?: unknown[] }>(
      `${provider.base_url.replace(/\/+$/, '')}/models`,
      {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': 'GoalRoute-Gateway/1.0',
      }
    );

    const rawModels = Array.isArray(body?.data) ? body.data : [];
    const discovered: DiscoveredModel[] = [];

    for (const raw of rawModels) {
      const id = this.extractModelId(raw);
      if (!id) continue;
      if (this.isFilteredModel(id)) continue;

      const obj = raw as Record<string, unknown>;
      discovered.push({
        modelName: id,
        displayName: this.pickDisplayName(obj) || id,
        contextWindow: this.pickNumber(obj, ['context_length', 'inputTokenLimit', 'context_window']) ?? DEFAULT_CONTEXT_WINDOW,
        supportsVision: this.detectVision(obj, id),
        supportsTools: true,
      });
    }

    return discovered;
  }

  /** GET https://api.anthropic.com/v1/models with x-api-key auth; parses `response.data[]`. */
  public async fetchAnthropicModels(provider: ProviderRecord, apiKey: string): Promise<DiscoveredModel[]> {
    const body = await this.fetchJson<{ data?: unknown[] }>(
      `${provider.base_url.replace(/\/+$/, '')}/models`,
      {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
        'User-Agent': 'GoalRoute-Gateway/1.0',
      }
    );

    const rawModels = Array.isArray(body?.data) ? body.data : [];
    const discovered: DiscoveredModel[] = [];

    for (const raw of rawModels) {
      const id = this.extractModelId(raw);
      if (!id) continue;
      if (this.isFilteredModel(id)) continue;

      const obj = raw as Record<string, unknown>;
      discovered.push({
        modelName: id,
        displayName: this.pickDisplayName(obj) || id,
        contextWindow: this.pickNumber(obj, ['inputTokenLimit', 'context_length', 'context_window']) ?? ANTHROPIC_CONTEXT_WINDOW,
        supportsVision: this.detectVision(obj, id),
        supportsTools: true,
      });
    }

    return discovered;
  }

  /** GET v1beta/models?pageSize=1000&key=... ; parses `response.models[]`, strips `models/` prefix,
   *  keeps only entries whose supportedGenerationMethods includes "generateContent". */
  public async fetchGeminiModels(provider: ProviderRecord, apiKey: string): Promise<DiscoveredModel[]> {
    const url = `${provider.base_url.replace(/\/+$/, '')}/models?pageSize=1000&key=${encodeURIComponent(apiKey)}`;
    const body = await this.fetchJson<{ models?: unknown[] }>(url, {
      'Content-Type': 'application/json',
      'User-Agent': 'GoalRoute-Gateway/1.0',
    });

    const rawModels = Array.isArray(body?.models) ? body.models : [];
    const discovered: DiscoveredModel[] = [];

    for (const raw of rawModels) {
      const obj = raw as Record<string, unknown>;

      const methods = Array.isArray(obj.supportedGenerationMethods)
        ? (obj.supportedGenerationMethods as unknown[]).filter((m): m is string => typeof m === 'string')
        : [];
      if (!methods.includes('generateContent')) continue;

      let id = typeof obj.name === 'string' ? obj.name : '';
      if (id.startsWith('models/')) id = id.slice('models/'.length);
      if (!id) continue;
      if (this.isFilteredModel(id)) continue;

      discovered.push({
        modelName: id,
        displayName: (typeof obj.displayName === 'string' && obj.displayName) || id,
        contextWindow: this.pickNumber(obj, ['inputTokenLimit', 'context_length', 'context_window']) ?? DEFAULT_CONTEXT_WINDOW,
        supportsVision: this.detectVision(obj, id),
        supportsTools: true,
      });
    }

    return discovered;
  }

  // ---------- shared helpers ----------

  /** Minimal bounded GET-with-JSON fetch. Throws AppError carrying the HTTP status. */
  private async fetchJson<T>(url: string, headers: Record<string, string>, timeoutMs: number = SYNC_TIMEOUT_MS): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, { method: 'GET', headers, signal: controller.signal });

      if (!response.ok) {
        let snippet = '';
        try {
          const text = await response.text();
          snippet = text.length > 300 ? `${text.slice(0, 300)}…` : text;
        } catch {}
        throw new AppError(
          `Model catalog request failed: HTTP ${response.status}${snippet ? ` — ${snippet}` : ''}`,
          'PROVIDER_HTTP_ERROR',
          response.status
        );
      }

      const text = await response.text();
      if (Buffer.byteLength(text, 'utf-8') > MAX_RESPONSE_BYTES) {
        throw new AppError('Model catalog response exceeds maximum safety limit (15MB)', 'PAYLOAD_TOO_LARGE', 502);
      }
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new AppError('Model catalog response is not valid JSON', 'PROVIDER_FETCH_FAILED', 502);
      }
    } catch (err: any) {
      if (err instanceof AppError) throw err;
      if (err?.name === 'AbortError') {
        throw new AppError(`Model catalog request timed out after ${timeoutMs}ms`, 'PROVIDER_TIMEOUT', 408);
      }
      // Network-level failure (DNS, refused, reset, ...). Status 0 signals non-HTTP failure.
      throw new AppError(`Model catalog network error: ${err?.message || String(err)}`, 'PROVIDER_FETCH_FAILED', 0);
    } finally {
      clearTimeout(timer);
    }
  }

  private extractModelId(raw: unknown): string | null {
    if (typeof raw !== 'object' || raw === null) return null;
    const obj = raw as Record<string, unknown>;
    const id = obj.id ?? obj.name;
    return typeof id === 'string' && id.trim() ? id.trim() : null;
  }

  private pickDisplayName(obj: Record<string, unknown>): string {
    for (const key of ['display_name', 'displayName', 'name']) {
      const val = obj[key];
      if (typeof val === 'string' && val.trim()) return val.trim();
    }
    return '';
  }

  private pickNumber(obj: Record<string, unknown>, keys: string[]): number | null {
    for (const key of keys) {
      const val = obj[key];
      if (typeof val === 'number' && Number.isFinite(val) && val > 0) return Math.round(val);
    }
    return null;
  }

  private isFilteredModel(id: string): boolean {
    const lower = id.toLowerCase();
    return FILTERED_MODEL_PREFIXES.some((prefix) => lower.startsWith(prefix));
  }

  private detectVision(obj: Record<string, unknown>, modelId: string): boolean {
    const modalities = obj.input_modalities ?? obj.inputModalities;
    if (Array.isArray(modalities) && modalities.some((m) => typeof m === 'string' && m.toLowerCase().includes('image'))) {
      return true;
    }
    return modelId.toLowerCase().includes('vision');
  }
}
