/**
 * Drizzle SQLite schema — the single source of truth for the data layer (§4).
 *
 * Naming note: the routing-pool table is `routing_pools` to avoid any SQL
 * keyword collision and to read clearly in queries.
 *
 * Every mutation in the new backend happens through these typed tables via
 * transactions, eliminating the v1 whole-file read-modify-write clobbers
 * (weaknesses W-1..W-5).
 */
import { integer, primaryKey, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core';

/* ── helpers ──────────────────────────────────────────────────────── */
const json = (name: string) => text(name); // JSON stored as TEXT; parsed at the repo boundary

/* ── providers & keys ─────────────────────────────────────────────── */
export const providers = sqliteTable('providers', {
  id: text().primaryKey(),
  name: text().notNull(),
  baseUrl: text().notNull(),
  protocol: text('protocol').default('openai-compatible').notNull(),
  category: text(), // "Permanent Free" | "Trial Credits" | "Paid Providers"
  enabled: integer('enabled', { mode: 'boolean' }).default(true).notNull(),
  proxyEnabled: integer('proxy_enabled', { mode: 'boolean' }).default(false).notNull(),
  proxyUrl: text('proxy_url').default('').notNull(),
  /** AES-256-GCM encrypted at rest; NULL when empty (never plaintext). */
  encryptedApiKey: text('encrypted_api_key'),
  website: text(),
  signupUrl: text('signup_url'),
  creditsDescription: text('credits_description'),
  limitsDescription: text('limits_description'),
  limitsJson: json('limits_json'), // {rpm,rpd,tpm,tpd,concurrent}
  /** Raw original provider object (apiKeys/apiKey stripped) for full fidelity. */
  legacyJson: json('legacy_json'),
  createdAt: text('created_at').default('1970-01-01T00:00:00.000Z').notNull(),
  updatedAt: text('updated_at').default('1970-01-01T00:00:00.000Z').notNull(),
});

export const providerKeys = sqliteTable('provider_keys', {
  id: text().primaryKey(), // "key-<ts>-<rand>" like v1
  providerId: text('provider_id')
    .references(() => providers.id, { onDelete: 'cascade' })
    .notNull(),
  encryptedKey: text('encrypted_key').notNull(),
  weight: integer().default(1).notNull(),
  enabled: integer({ mode: 'boolean' }).default(true).notNull(),
});

export const capabilityProfiles = sqliteTable('capability_profiles', {
  id: text().primaryKey(), // provider id (one profile per provider in practice)
  protocol: text().notNull().default('openai-compatible'),
  paramMapJson: json('param_map_json').default('{}').notNull(),
  unsupportedParamsJson: json('unsupported_params_json').default('[]').notNull(),
  rateLimitHeaderFormat: text('rate_limit_header_format')
    .default('openai-standard')
    .notNull(),
});

export const models = sqliteTable('models', {
  id: text().primaryKey(), // "<providerId>:<modelId>" — globally unique
  providerId: text('provider_id')
    .references(() => providers.id, { onDelete: 'cascade' })
    .notNull(),
  modelId: text('model_id').notNull(),
  name: text(),
  contextWindow: integer('context_window'), // null = unknown (seeded in phase 2)
  supportsTools: integer('supports_tools', { mode: 'boolean' }).default(false),
  supportsVision: integer('supports_vision', { mode: 'boolean' }).default(false),
  supportsJsonMode: integer('supports_json_mode', { mode: 'boolean' }).default(false),
  limitsJson: json('limits_json'),
  capabilityProfileId: text('capability_profile_id').references(() => capabilityProfiles.id),
});

export const routingPools = sqliteTable('routing_pools', {
  id: text().primaryKey(), // v1 uses the pool `id` (e.g. "strong-reasoning")
  name: text().notNull(),
  strategy: text().default('priority').notNull(),
  configJson: json('config_json').default('{}').notNull(), // maxRetries/timeoutMs/cooldownMs/fallback*
  limitsJson: json('limits_json'), // optional pool-level TPM/concurrency limits
});
export const poolTargets = sqliteTable(
  'pool_targets',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    poolId: text('pool_id').references(() => routingPools.id, { onDelete: 'cascade' }).notNull(),
    providerId: text('provider_id').references(() => providers.id, { onDelete: 'set null' }),
    modelId: text('model_id'),
    priority: integer().default(0).notNull(),
  },
  (t) => [unique().on(t.poolId, t.providerId, t.modelId)],
);

export const modelAliases = sqliteTable('model_aliases', {
  sourceModel: text('source_model').primaryKey(),
  targetId: text().notNull(),
});

/* ── virtual keys (gateway-scoped) ────────────────────────────────── */
export const virtualKeys = sqliteTable('virtual_keys', {
  id: text().primaryKey(),
  enabled: integer({ mode: 'boolean' }).default(true).notNull(),
  rpmLimit: integer('rpm_limit').default(0),
  rpdLimit: integer('rpd_limit').default(0),
});

/**
 * Per-minute / per-day usage buckets for a virtual key. Persisted so a restart
 * does not reset a key's RPD counter (fixes the v1 "forgotten" bug).
 */
export const virtualKeyUsage = sqliteTable(
  'virtual_key_usage',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    virtualKeyId: text('virtual_key_id')
      .references(() => virtualKeys.id, { onDelete: 'cascade' })
      .notNull(),
    bucketType: text('bucket_type').notNull(), // 'minute' | 'day'
    windowStart: integer('window_start').notNull(), // unix-ms of the minute/day bucket start
    requests: integer().default(0).notNull(),
    tokens: integer().default(0).notNull(),
  },
  (t) => [unique().on(t.virtualKeyId, t.bucketType, t.windowStart)],
);

/* ── rate-limit / circuit-breaker state (persisted runtime state) ─── */
export const rateLimitState = sqliteTable(
  'rate_limit_state',
  {
    scopeKey: text('scope_key').notNull(), // "<providerId>" or "<providerId>:<modelId>"
    windowType: text('window_type').notNull(), // 'rpm' | 'rpd' | 'tpm' | 'tpd' | 'concurrent'
    count: integer().default(0).notNull(),
    tokens: integer().default(0).notNull(),
    nextResetAt: integer('next_reset_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.scopeKey, t.windowType] })],
);

export const circuitBreakerState = sqliteTable('circuit_breaker_state', {
  targetKey: text('target_key').primaryKey(), // "<providerId>:<modelId>"
  state: text().default('CLOSED').notNull(), // CLOSED | OPEN | HALF_OPEN
  consecutiveFailures: integer('consecutive_failures').default(0).notNull(),
  openedAt: integer('opened_at'),
  halfOpenAt: integer('half_open_at'),
  nextProbeAt: integer('next_probe_at'),
});

/* ── stats & history ──────────────────────────────────────────────── */
export const requestsHistory = sqliteTable('requests_history', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  timestamp: text().notNull(),
  success: integer('success', { mode: 'boolean' }).default(true).notNull(),
  requestedModel: text('requested_model'),
  providerId: text('provider_id'),
  modelId: text('model_id'),
  promptTokens: integer('prompt_tokens').default(0).notNull(),
  completionTokens: integer('completion_tokens').default(0).notNull(),
  latencyMs: integer('latency_ms').default(0).notNull(),
  cacheHit: integer('cache_hit', { mode: 'boolean' }).default(false).notNull(),
  errorCode: text('error_code'),
});

/* ── semantic cache ──────────────────────────────────────────────── */
export const cacheEntries = sqliteTable(
  'cache_entries',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    promptHash: text('prompt_hash').notNull(),
    modelScope: text('model_scope').notNull(),
    promptText: text('prompt_text'),
    completionJson: text('completion_json').notNull(),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at'),
  },
  (t) => [unique().on(t.promptHash, t.modelScope)],
);

/* ── chat sessions (agentic chat assistant) ───────────────────────── */
export const chatSessions = sqliteTable('chat_sessions', {
  id: text().primaryKey(),
  title: text().notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at'),
});

export const chatMessages = sqliteTable('chat_messages', {
  id: text().primaryKey(),
  sessionId: text('session_id')
    .references(() => chatSessions.id, { onDelete: 'cascade' })
    .notNull(),
  role: text().notNull(), // 'user' | 'assistant' | 'tool'
  content: text(),
  stepsJson: json('steps_json').default('[]').notNull(),
  createdAt: text('created_at').notNull(),
});

/* ── stats snapshots (preserves v1 stats-history.json verbatim) ───── */
export const statsHistory = sqliteTable(
  'stats_history',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    timestamp: text().notNull(),
    snapshotHash: text('snapshot_hash').notNull(),
    snapshotJson: json('snapshot_json').notNull(),
  },
  (t) => [unique().on(t.snapshotHash)],
);

/* ── logs (replaces the 500-ring + gateway_errors.log) ───────────── */
export const logs = sqliteTable('logs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  timestamp: text().notNull(),
  level: text().notNull(), // INFO | WARN | ERROR
  message: text().notNull(),
  detailsJson: json('details_json'),
});

/* ── settings (key/value, includes the migration marker) ─────────── */
export const settings = sqliteTable('settings', {
  key: text().primaryKey(),
  valueJson: text('value_json').notNull(),
});

export const schema = {
  providers,
  providerKeys,
  models,
  capabilityProfiles,
  routingPools,
  poolTargets,
  modelAliases,
  virtualKeys,
  virtualKeyUsage,
  rateLimitState,
  circuitBreakerState,
    requestsHistory,
  cacheEntries,
  chatSessions,
  chatMessages,
  statsHistory,
  logs,
  settings,
};

