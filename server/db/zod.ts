/**
 * Zod schemas describing the REAL v1 structures (from config.json,
 * chat-sessions.json, cache.json, stats-history.json) as loaded for the
 * migration, plus the normalized v2 configuration objects.
 *
 * Everything is `.passthrough()` — v1 appends legacy fields we do not
 * enumerate; we must never drop them blindly. Unknown fields that have no v2
 * column are preserved (providers → legacy_json, others → settings JSON).
 */
import { z } from 'zod';

/* ── v1 source shapes (loose, pass-through) ────────────────────────── */
export const ProviderLimitsV1 = z
  .object({
    rpm: z.number().nullable().optional(),
    rpd: z.number().nullable().optional(),
    tpm: z.number().nullable().optional(),
    tpd: z.number().nullable().optional(),
    concurrent: z.number().nullable().optional(),
  })
  .passthrough();

export const ProviderModelV1 = z
  .object({ id: z.string(), name: z.string().optional() })
  .passthrough();

export const ProviderKeyV1 = z
  .object({
    id: z.string().optional(),
    key: z.string().optional(),
    weight: z.number().optional(),
    enabled: z.boolean().optional(),
  })
  .passthrough();

export const ProviderV1 = z
  .object({
    id: z.string(),
    name: z.string().optional(),
    baseUrl: z.string().optional(),
    apiKey: z.string().optional(), // legacy single-key (may be "")
    apiKeys: z.array(ProviderKeyV1).optional(), // multi-key pool
    enabled: z.boolean().optional(),
    proxyEnabled: z.boolean().optional(),
    proxyUrl: z.string().optional(),
    category: z.string().optional(),
    website: z.string().optional(),
    signupUrl: z.string().optional(),
    creditsDescription: z.string().optional(),
    limitsDescription: z.string().optional(),
    models: z.array(ProviderModelV1).optional(),
    limits: ProviderLimitsV1.optional(),
  })
  .passthrough();

export const PoolTargetV1 = z
  .object({ providerId: z.string(), modelId: z.string().nullable().optional() })
  .passthrough();

export const PoolConfigV1 = z
  .object({
    maxRetries: z.number().optional(),
    timeoutMs: z.number().optional(),
    cooldownMs: z.number().optional(),
    fallbackOn5xx: z.boolean().optional(),
    fallbackOn429: z.boolean().optional(),
    fallbackOn403: z.boolean().optional(),
  })
  .passthrough();

export const VirtualModelV1 = z
  .object({
    id: z.string(),
    name: z.string().optional(),
    strategy: z.string().optional(),
    // live config.json wraps retry/cooldown/fallback flags in `config`
    config: PoolConfigV1.optional(),
    targets: z.array(PoolTargetV1).optional(),
    limits: ProviderLimitsV1.optional(),
  })
  .passthrough();

const KeyLimitsV1 = z
  .object({ rpm: z.number().optional(), rpd: z.number().optional() })
  .passthrough();
const KeyUsageV1 = z
  .object({ requests: z.array(z.number()).optional(), tokens: z.number().optional() })
  .passthrough();

export const VirtualKeyV1 = z
  .object({
    id: z.string(),
    enabled: z.boolean().optional(),
    limits: KeyLimitsV1.optional(),
    rpmLimit: z.number().optional(),
    rpdLimit: z.number().optional(),
    usage: KeyUsageV1.optional(),
  })
  .passthrough();

export const CacheEntryV1 = z
  .object({ id: z.string().optional(), prompt: z.string(), completion: z.string(), created_at: z.number().optional() })
  .passthrough();

export const ChatSessionV1 = z
  .object({ id: z.string(), title: z.string().optional(), createdAt: z.string().optional() })
  .passthrough();

export const ChatMessageV1 = z
  .object({
    id: z.string(),
    sessionId: z.string(),
    role: z.string().optional(),
    content: z.unknown().optional(),
    steps: z.unknown().optional(),
    createdAt: z.string().optional(),
  })
  .passthrough();

export const ConfigV1 = z
  .object({
    globalProxy: z.string().optional(),
    globalProxyEnabled: z.boolean().optional(),
    rateLimitQueueEnabled: z.boolean().optional(),
    rateLimitQueueTimeoutMs: z.number().optional(),
    providers: z.array(ProviderV1).default([]),
    virtualModels: z.array(VirtualModelV1).default([]),
    aliases: z.record(z.string()).optional().default({}),
    semanticCacheEnabled: z.boolean().optional(),
    semanticCacheThreshold: z.number().optional(),
    virtualKeys: z.array(VirtualKeyV1).default([]),
    stats: z.record(z.unknown()).optional(),
  })
  .passthrough();

/* ── normalized v2 config object (produced by the migration) ───────── */
export const v2GlobalSettings = z.object({
  globalProxy: z.string().optional(),
  globalProxyEnabled: z.boolean().optional(),
  rateLimitQueueEnabled: z.boolean().optional(),
  rateLimitQueueTimeoutMs: z.number().optional(),
  semanticCacheEnabled: z.boolean().optional(),
  semanticCacheThreshold: z.number().optional(),
  stats: z.record(z.unknown()).optional(),
  /** All v1 top-level fields that had no dedicated column. */
  extra: z.record(z.unknown()).optional(),
});