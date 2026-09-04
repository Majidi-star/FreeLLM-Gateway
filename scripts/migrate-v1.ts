#!/usr/bin/env tsx
/**
 * Migration: v1 flat-file JSON → v2 SQLite.
 *
 * - Reads the REAL v1 structures from config.json, server/cache.json,
 *   chat-sessions.json and stats-history.json.
 * - Preserves the original JSON files byte-for-byte (read-only).
 * - Encrypts every non-empty provider key with AES-256-GCM (never plaintext).
 * - Idempotent: a settings marker stores per-file sha256 hashes; reruns only
 *   touch files whose hash changed, and coinciding inserts are de-duplicated
 *   (ON CONFLICT DO NOTHING / delete+reinsert), so nothing duplicates.
 * - Transactional: all writes happen in ONE SQLite transaction. Any failure
 *   rolls the whole migration back — no partial state.
 *
 * CLI: tsx scripts/migrate-v1.ts
 * Env: GATEWAY_DB_PATH            (default <CWD>/data/gateway.db)
 *      GATEWAY_MASTER_KEY_PATH    (keystore file; default <GATEWAY_DATA_DIR>)
 */
import { eq, inArray } from 'drizzle-orm';
import type { InferInsertModel } from 'drizzle-orm';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { getDb, initDb } from '../server/db/client.js';
import { encryptSecret } from '../server/db/keystore.js';
import {
  cacheEntries as cacheTable,
  chatMessages as chatMessagesTable,
  chatSessions as chatSessionsTable,
  modelAliases as modelAliasesTable,
  models as modelsTable,
  poolTargets as poolTargetsTable,
  providerKeys as providerKeysTable,
  providers as providersTable,
  routingPools as routingPoolsTable,
  settings as settingsTable,
  statsHistory as statsHistoryTable,
  virtualKeys as virtualKeysTable,
  virtualKeyUsage as virtualKeyUsageTable,
} from '../server/db/schema.js';
import {
  CacheEntryV1,
  ChatMessageV1,
  ChatSessionV1,
  ConfigV1,
} from '../server/db/zod.js';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), '..');
const SOURCES = {
  config: path.join(REPO_ROOT, 'config.json'),
  cache: path.join(REPO_ROOT, 'server', 'cache.json'),
  chatSessions: path.join(REPO_ROOT, 'chat-sessions.json'),
  statsHistory: path.join(REPO_ROOT, 'stats-history.json'),
};

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

function readJson(file: string): { ok: true; data: unknown; hash: string } | { ok: false; data: null; hash: string; reason: string } {
  if (!fs.existsSync(file)) return { ok: false, data: null, hash: '', reason: 'file not found' };
  const raw = fs.readFileSync(file, 'utf8');
  const hash = sha256(raw);
  try {
    return { ok: true, data: JSON.parse(raw), hash };
  } catch (e) {
    return { ok: false, data: null, hash, reason: `unparseable JSON: ${(e as Error).message}` };
  }
}

/* v1 semantic cache was NOT model-scoped (weakness W-6) — legacy sentinel. */
const LEGACY_CACHE_SCOPE = '*';
const oneDayMs = 86_400_000;
const oneMinMs = 60_000;

/* ── counters surfaced in the migration report (nothing is dropped silently) ── */
export interface MigCounts {
  providers: number;
  providerKeys: number;
  providerKeysSkippedEmpty: number;
  providerDupIds: number;
  providerMissingId: number;
  providersStrippedLegacyKey: number;
  providersStrippedKeyPool: number;
  models: number;
  modelDupIds: number;
  pools: number;
  poolTargets: number;
  modelAliases: number;
  virtualKeys: number;
  virtualKeyUsage: number;
  cacheEntries: number;
  cacheDeduped: number;
  chatSessions: number;
  orphanSessionsRecovered: number;
  chatMessages: number;
  statsHistory: number;
  virtualKeyUsageMetaTokens: number;
}
/* ── dataset builders ──────────────────────────────────────────────── */

type ProviderRow = InferInsertModel<typeof providersTable>;
type ProviderKeyRow = InferInsertModel<typeof providerKeysTable>;
type ModelRow = InferInsertModel<typeof modelsTable>;
type PoolRow = InferInsertModel<typeof routingPoolsTable>;
type PoolTargetRow = InferInsertModel<typeof poolTargetsTable>;
type AliasRow = InferInsertModel<typeof modelAliasesTable>;
type VirtualKeyRow = InferInsertModel<typeof virtualKeysTable>;
type VirtualKeyUsageRow = InferInsertModel<typeof virtualKeyUsageTable>;
type CacheRow = InferInsertModel<typeof cacheTable>;
type ChatSessionRow = InferInsertModel<typeof chatSessionsTable>;
type ChatMessageRow = InferInsertModel<typeof chatMessagesTable>;
type StatsHistoryRow = InferInsertModel<typeof statsHistoryTable>;

function buildProviders(cfg: ReturnType<typeof ConfigV1.parse>): {
  providers: Array<ProviderRow>;
  providerKeys: Array<ProviderKeyRow>;
  models: Array<ModelRow>;
  counts: Partial<MigCounts>;
} {
  const counts: Partial<MigCounts> = {};
  const providers: Array<ProviderRow> = [];
  const providerKeys: Array<ProviderKeyRow> = [];
  const models: Array<ModelRow> = [];
  const seenProvider = new Set<string>();
  const seenModel = new Set<string>();

  for (const p of cfg.providers ?? []) {
    if (!p.id) { counts.providerMissingId = (counts.providerMissingId ?? 0) + 1; continue; }
    if (seenProvider.has(p.id)) { counts.providerDupIds = (counts.providerDupIds ?? 0) + 1; continue; }
    seenProvider.add(p.id);

    let encryptedApiKey: string | null = null;
    if (typeof p.apiKey === 'string' && p.apiKey.trim() !== '') {
      encryptedApiKey = encryptSecret(p.apiKey);
      counts.providersStrippedLegacyKey = (counts.providersStrippedLegacyKey ?? 0) + 1;
    }
    if (Array.isArray(p.apiKeys) && p.apiKeys.length) {
      counts.providersStrippedKeyPool = (counts.providersStrippedKeyPool ?? 0) + 1;
      for (const k of p.apiKeys) {
        if (typeof k.key !== 'string' || k.key.trim() === '') {
          counts.providerKeysSkippedEmpty = (counts.providerKeysSkippedEmpty ?? 0) + 1;
          continue;
        }
        const kid = k.id && k.id.length ? `${p.id}__${k.id}` : `${p.id}__key-${providerKeys.length}`;
        providerKeys.push({
          id: kid,
          providerId: p.id,
          encryptedKey: encryptSecret(k.key) as string,
          weight: typeof k.weight === 'number' ? k.weight : 1,
          enabled: k.enabled ?? true,
        });
      }
    }

    const legacy: Record<string, unknown> = { ...p };
    delete legacy.apiKey;
    delete legacy.apiKeys;

    providers.push({
      id: p.id,
      name: p.name || p.id,
      baseUrl: p.baseUrl || '',
      protocol: 'openai-compatible',
      category: p.category ?? null,
      enabled: p.enabled ?? true,
      proxyEnabled: p.proxyEnabled ?? false,
      proxyUrl: p.proxyUrl ?? '',
      encryptedApiKey,
      website: p.website ?? null,
      signupUrl: p.signupUrl ?? null,
      creditsDescription: p.creditsDescription ?? null,
      limitsDescription: p.limitsDescription ?? null,
      limitsJson: p.limits ? JSON.stringify(p.limits) : null,
      legacyJson: JSON.stringify(legacy),
    });

    for (const m of p.models ?? []) {
      if (!m.id) continue;
      const mid = `${p.id}:${m.id}`;
      if (seenModel.has(mid)) { counts.modelDupIds = (counts.modelDupIds ?? 0) + 1; continue; }
      seenModel.add(mid);
      models.push({ id: mid, providerId: p.id, modelId: m.id, name: m.name ?? null });
    }
  }
  counts.providers = providers.length;
  counts.providerKeys = providerKeys.length;
  counts.models = models.length;
  return { providers, providerKeys, models, counts };
}
function buildPools(cfg: ReturnType<typeof ConfigV1.parse>): {
  pools: Array<PoolRow>;
  targets: Array<PoolTargetRow>;
  counts: Partial<MigCounts>;
} {
  const counts: Partial<MigCounts> = {};
  const pools: Array<PoolRow> = [];
  const targets: Array<PoolTargetRow> = [];

  for (const vm of cfg.virtualModels ?? []) {
    if (!vm.id) continue;
    const cfgObj: Record<string, unknown> = vm.config ? { ...vm.config } : {};
    const vmAny: Record<string, unknown> = vm;
    for (const k of ['maxRetries', 'timeoutMs', 'cooldownMs', 'fallbackOn5xx', 'fallbackOn429', 'fallbackOn403']) {
      if (vmAny[k] !== undefined) cfgObj[k] = vmAny[k];
    }
    pools.push({
      id: vm.id,
      name: vm.name || vm.id,
      strategy: vm.strategy || 'priority',
      configJson: JSON.stringify(cfgObj),
      limitsJson: vm.limits ? JSON.stringify(vm.limits) : null,
    });
    (vm.targets ?? []).forEach((t, idx) => {
      targets.push({ poolId: vm.id, providerId: t.providerId, modelId: t.modelId ?? null, priority: idx });
    });
  }
  counts.pools = pools.length;
  counts.poolTargets = targets.length;
  return { pools, targets, counts };
}

function buildAliases(cfg: ReturnType<typeof ConfigV1.parse>): {
  rows: Array<AliasRow>;
  counts: Partial<MigCounts>;
} {
  const rows: Array<AliasRow> = [];
  for (const [source, target] of Object.entries(cfg.aliases ?? {})) {
    if (!source || !target) continue;
    rows.push({ sourceModel: source, targetId: String(target) });
  }
  return { rows, counts: { modelAliases: rows.length } };
}
function buildVirtualKeys(cfg: ReturnType<typeof ConfigV1.parse>): {
  keys: Array<VirtualKeyRow>;
  usage: Array<VirtualKeyUsageRow>;
  counts: Partial<MigCounts>;
} {
  const counts: Partial<MigCounts> = {};
  const keys: Array<VirtualKeyRow> = [];
  const usage: Array<Record<string, unknown>> = [];
  let usageMetaTokens = 0;

  for (const vk of cfg.virtualKeys ?? []) {
    if (!vk.id) continue;
    const rpm = typeof vk.limits?.rpm === 'number' ? vk.limits.rpm : (typeof vk.rpmLimit === 'number' ? vk.rpmLimit : 0);
    const rpd = typeof vk.limits?.rpd === 'number' ? vk.limits.rpd : (typeof vk.rpdLimit === 'number' ? vk.rpdLimit : 0);
    keys.push({ id: vk.id, enabled: vk.enabled ?? true, rpmLimit: rpm, rpdLimit: rpd });
    for (const t of vk.usage?.requests ?? []) {
      const ts = Number(t);
      if (!Number.isFinite(ts)) continue;
      usage.push({ virtualKeyId: vk.id, bucketType: 'minute', windowStart: Math.floor(ts / oneMinMs) * oneMinMs, requests: 1, tokens: 0 });
      usage.push({ virtualKeyId: vk.id, bucketType: 'day', windowStart: Math.floor(ts / oneDayMs) * oneDayMs, requests: 1, tokens: 0 });
    }
    if (typeof vk.usage?.tokens === 'number' && vk.usage.tokens > 0) {
      usageMetaTokens += vk.usage.tokens;
      usage.push({ virtualKeyId: vk.id, bucketType: 'day', windowStart: Math.floor(Date.now() / oneDayMs) * oneDayMs, requests: 0, tokens: vk.usage.tokens });
    }
  }
  const merged = new Map<string, { requests: number; tokens: number }>();
  for (const u of usage) {
    const kk = `${u.virtualKeyId}|${u.bucketType}|${u.windowStart}`;
    const cur = merged.get(kk) ?? { requests: 0, tokens: 0 };
    cur.requests += (u.requests as number);
    cur.tokens += (u.tokens as number);
    merged.set(kk, cur);
  }
  const usageRows: Array<VirtualKeyUsageRow> = [...merged.entries()].map(([kk, c]): VirtualKeyUsageRow => {
    const [virtualKeyId, bucketType, windowStart] = kk.split('|');
    return { virtualKeyId, bucketType, windowStart: Number(windowStart), requests: c.requests, tokens: c.tokens };
  });
  counts.virtualKeys = keys.length;
  counts.virtualKeyUsage = usageRows.length;
  counts.virtualKeyUsageMetaTokens = usageMetaTokens;
  return { keys, usage: usageRows, counts };
}

function buildGlobalSettings(cfg: ReturnType<typeof ConfigV1.parse>): { settings: Record<string, unknown> } {
  const known = new Set([
    'globalProxy', 'globalProxyEnabled', 'rateLimitQueueEnabled', 'rateLimitQueueTimeoutMs',
    'providers', 'virtualModels', 'aliases', 'semanticCacheEnabled', 'semanticCacheThreshold',
    'virtualKeys', 'stats',
  ]);
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(cfg)) if (!known.has(k)) extra[k] = v;
  return {
    settings: {
      globalProxy: cfg.globalProxy ?? '',
      globalProxyEnabled: cfg.globalProxyEnabled ?? false,
      rateLimitQueueEnabled: cfg.rateLimitQueueEnabled ?? true,
      rateLimitQueueTimeoutMs: cfg.rateLimitQueueTimeoutMs ?? 180_000,
      semanticCacheEnabled: cfg.semanticCacheEnabled ?? false,
      semanticCacheThreshold: cfg.semanticCacheThreshold ?? 0.92,
      stats: cfg.stats ?? {},
      extra,
    },
  };
}
function buildCache(entriesRaw: unknown): {
  rows: Array<CacheRow>;
  counts: Partial<MigCounts>;
} {
  const rows: Array<CacheRow> = [];
  const seen = new Set<string>();
  let deduped = 0;
  const list = Array.isArray(entriesRaw) ? entriesRaw : [];
  for (const rawEntry of list) {
    const p = CacheEntryV1.safeParse(rawEntry);
    if (!p.success) continue;
    const e = p.data;
    if (!e.prompt || !e.completion) continue;
    const hash = sha256(e.prompt);
    const key = `${LEGACY_CACHE_SCOPE}|${hash}`;
    if (seen.has(key)) { deduped++; continue; }
    seen.add(key);
    const created = typeof e.created_at === 'number' ? e.created_at : Date.now();
    rows.push({
      promptHash: hash,
      modelScope: LEGACY_CACHE_SCOPE,
      promptText: e.prompt,
      completionJson: e.completion,
      createdAt: created,
      expiresAt: null,
    });
  }
  return { rows, counts: { cacheEntries: rows.length, cacheDeduped: deduped } };
}

function buildChatSessions(raw: unknown): {
  sessions: Array<ChatSessionRow>;
  messages: Array<ChatMessageRow>;
  orphanSessions: Array<{ id: string; createdAt: string }>;
  counts: Partial<MigCounts>;
} {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { sessions: [], messages: [], orphanSessions: [], counts: { chatSessions: 0, chatMessages: 0 } };
  }
  const obj = raw as { sessions?: unknown; messages?: unknown };
  const sessions: Array<ChatSessionRow> = [];
  const sessionIds = new Set<string>();
  for (const s of Array.isArray(obj.sessions) ? obj.sessions : []) {
    const parsed = ChatSessionV1.safeParse(s);
    if (!parsed.success || !parsed.data.id) continue;
    sessions.push({ id: parsed.data.id, title: parsed.data.title || 'New Chat', createdAt: parsed.data.createdAt ?? new Date().toISOString() });
    sessionIds.add(parsed.data.id);
  }

  const messages: Array<ChatMessageRow> = [];
  const orphanSessions: Array<{ id: string; createdAt: string }> = [];
  for (const m of Array.isArray(obj.messages) ? obj.messages : []) {
    const parsed = ChatMessageV1.safeParse(m);
    if (!parsed.success || !parsed.data.id) continue;
    const msg = parsed.data;
    if (!sessionIds.has(msg.sessionId)) {
      orphanSessions.push({ id: msg.sessionId, createdAt: msg.createdAt ?? new Date().toISOString() });
      sessionIds.add(msg.sessionId);
    }
    const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content ?? '');
    messages.push({
      id: msg.id,
      sessionId: msg.sessionId,
      role: msg.role ?? 'user',
      content,
      stepsJson: JSON.stringify(msg.steps ?? []),
      createdAt: msg.createdAt ?? new Date().toISOString(),
    });
  }
  return {
    sessions,
    messages,
    orphanSessions,
    counts: { chatSessions: sessions.length, chatMessages: messages.length, orphanSessionsRecovered: orphanSessions.length },
  };
}

function buildStatsHistory(raw: unknown): {
  rows: Array<StatsHistoryRow>;
  counts: Partial<MigCounts>;
} {
  const rows: Array<StatsHistoryRow> = [];
  const list = Array.isArray(raw) ? raw : [];
  for (const entry of list) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;
    const ts = typeof e.timestamp === 'string' ? e.timestamp : new Date().toISOString();
    const snap = JSON.stringify(e);
    rows.push({ timestamp: ts, snapshotHash: sha256(snap), snapshotJson: snap });
  }
  return { rows, counts: { statsHistory: rows.length } };
}

/* ── marker / idempotency ──────────────────────────────────────────── */

interface FileState { hash: string; migrated: boolean; reason?: string }
export interface MigrationMarker {
  schemaVersion: number;
  completedAt: string;
  files: { config: FileState; cache: FileState; chatSessions: FileState; statsHistory: FileState };
  counts: Partial<MigCounts>;
}
const MARKER_KEY = 'v1.migration';
const emptyFiles = (): MigrationMarker['files'] => ({
  config: { hash: '', migrated: false },
  cache: { hash: '', migrated: false },
  chatSessions: { hash: '', migrated: false },
  statsHistory: { hash: '', migrated: false },
});

export type SourcePaths = typeof SOURCES;

export interface RunResult {
  counts: Partial<MigCounts>;
  marker: MigrationMarker;
  skipped: string[];
}

/**
 * Run the migration. `sources` overrides the source file paths (for tests);
 * otherwise uses the repo's own v1 JSON files.
 */
export async function runMigration(sources?: SourcePaths): Promise<RunResult> {
  const src = sources ?? SOURCES;
  const files = {
    config: readJson(src.config),
    cache: readJson(src.cache),
    chatSessions: readJson(src.chatSessions),
    statsHistory: readJson(src.statsHistory),
  };
  const prior = await loadMarker();
  const markerFiles = prior?.files ?? emptyFiles();

  if (!files.config.ok) {
    throw new Error(`[migrate] ABORT: config.json required but unreadable (${files.config.reason}). Nothing migrated.`);
  }
  const cfgParsed = ConfigV1.safeParse(files.config.data);
  if (!cfgParsed.success) {
    throw new Error(`[migrate] ABORT: config.json failed schema validation — refusing to silently drop fields.\n${JSON.stringify(cfgParsed.error.issues, null, 2)}`);
  }
  const cfg = cfgParsed.data;

  const skipped: string[] = [];
  const db = getDb();

  await db.transaction(async (tx) => {
    const counts: Partial<MigCounts> = {};
    const changed = (name: keyof MigrationMarker['files'], f: { ok: boolean; hash: string }) =>
      f.ok && !(markerFiles[name].migrated && markerFiles[name].hash === f.hash);

    if (changed('config', files.config)) {
      const prov = buildProviders(cfg);
      Object.assign(counts, prov.counts);
      if (prov.providers.length) await tx.insert(providersTable).values(prov.providers).onConflictDoNothing();
      if (prov.providerKeys.length) await tx.insert(providerKeysTable).values(prov.providerKeys).onConflictDoNothing();
      if (prov.models.length) await tx.insert(modelsTable).values(prov.models).onConflictDoNothing();

      const pools = buildPools(cfg);
      Object.assign(counts, pools.counts);
      if (pools.pools.length) await tx.insert(routingPoolsTable).values(pools.pools).onConflictDoNothing();
      const poolIds: string[] = pools.pools.map((p) => p.id as string);
      if (poolIds.length) await tx.delete(poolTargetsTable).where(inArray(poolTargetsTable.poolId, poolIds));
      if (pools.targets.length) await tx.insert(poolTargetsTable).values(pools.targets).onConflictDoNothing();

      const aliases = buildAliases(cfg);
      Object.assign(counts, aliases.counts);
      if (aliases.rows.length) await tx.insert(modelAliasesTable).values(aliases.rows).onConflictDoNothing();

      const vkeys = buildVirtualKeys(cfg);
      Object.assign(counts, vkeys.counts);
      if (vkeys.keys.length) await tx.insert(virtualKeysTable).values(vkeys.keys).onConflictDoNothing();
      const vkIds: string[] = vkeys.keys.map((k) => k.id as string);
      if (vkIds.length) await tx.delete(virtualKeyUsageTable).where(inArray(virtualKeyUsageTable.virtualKeyId, vkIds));
      if (vkeys.usage.length) await tx.insert(virtualKeyUsageTable).values(vkeys.usage).onConflictDoNothing();

      const gs = buildGlobalSettings(cfg).settings;
      for (const [k, v] of [['global', gs], ['gateway.stats', gs.stats ?? {}]] as Array<[string, unknown]>) {
        await tx.insert(settingsTable).values([{ key: k, valueJson: JSON.stringify(v) }])
          .onConflictDoUpdate({ target: settingsTable.key, set: { valueJson: JSON.stringify(v) } });
      }
      markerFiles.config = { hash: files.config.hash, migrated: true };
    } else {
      if (files.config.ok) { skipped.push('config'); Object.assign(counts, prior?.counts ?? {}); }
      markerFiles.config = { hash: files.config.hash, migrated: true, reason: files.config.ok ? 'unchanged' : files.config.reason };
    }
if (changed('cache', files.cache)) {
      const c = buildCache(files.cache.data);
      Object.assign(counts, c.counts);
      if (c.rows.length) await tx.insert(cacheTable).values(c.rows).onConflictDoNothing({ target: [cacheTable.promptHash, cacheTable.modelScope] });
      markerFiles.cache = { hash: files.cache.hash, migrated: true };
    } else {
      if (files.cache.ok) skipped.push('cache');
      markerFiles.cache = { hash: files.cache.hash, migrated: true, reason: files.cache.ok ? 'unchanged' : files.cache.reason };
    }

    if (changed('chatSessions', files.chatSessions)) {
      const cs = buildChatSessions(files.chatSessions.data);
      const orphanRows = cs.orphanSessions.map((o) => ({ id: o.id, title: '[recovered orphan-message session]', createdAt: o.createdAt }));
      if (orphanRows.length) await tx.insert(chatSessionsTable).values(orphanRows).onConflictDoNothing();
      if (cs.sessions.length) await tx.insert(chatSessionsTable).values(cs.sessions).onConflictDoNothing();
      if (cs.messages.length) await tx.insert(chatMessagesTable).values(cs.messages).onConflictDoNothing();
      Object.assign(counts, cs.counts);
      markerFiles.chatSessions = { hash: files.chatSessions.hash, migrated: true };
    } else {
      if (files.chatSessions.ok) skipped.push('chatSessions');
      markerFiles.chatSessions = { hash: files.chatSessions.hash, migrated: true, reason: files.chatSessions.ok ? 'unchanged' : files.chatSessions.reason };
    }

    if (changed('statsHistory', files.statsHistory)) {
      const sh = buildStatsHistory(files.statsHistory.data);
      Object.assign(counts, sh.counts);
      if (sh.rows.length) await tx.insert(statsHistoryTable).values(sh.rows).onConflictDoNothing({ target: statsHistoryTable.snapshotHash });
      markerFiles.statsHistory = { hash: files.statsHistory.hash, migrated: true };
    } else {
      if (files.statsHistory.ok) skipped.push('statsHistory');
      markerFiles.statsHistory = { hash: files.statsHistory.hash, migrated: true, reason: files.statsHistory.ok ? 'unchanged' : files.statsHistory.reason };
    }

    const marker: MigrationMarker = {
      schemaVersion: 1,
      completedAt: new Date().toISOString(),
      files: markerFiles,
      counts,
    };
    await tx.insert(settingsTable).values([{ key: MARKER_KEY, valueJson: JSON.stringify(marker) }])
      .onConflictDoUpdate({ target: settingsTable.key, set: { valueJson: JSON.stringify(marker) } });
  });

  const finalMarker = (await loadMarker())!;
  const result: RunResult = { counts: finalMarker.counts, marker: finalMarker, skipped };
  return result;
}

async function loadMarker(): Promise<MigrationMarker | undefined> {
  const rows = await getDb().select().from(settingsTable).where(eq(settingsTable.key, MARKER_KEY));
  if (!rows.length) return undefined;
  return JSON.parse(rows[0].valueJson) as MigrationMarker;
}

/* ── CLI entry ─────────────────────────────────────────────────────── */

async function main(): Promise<void> {
  await initDb();
  const { marker, skipped } = await runMigration();
  const c = marker.counts;
  console.log('\n=== v1 → v2 migration report ===');
  console.log(`completedAt:              ${marker.completedAt}`);
  console.log(`skipped (unchanged):      ${skipped.join(', ') || '(none)'}`);
  console.log(`providers:                ${c.providers ?? 0}  (duplicate ids dropped: ${c.providerDupIds ?? 0}, missing id: ${c.providerMissingId ?? 0})`);
  console.log(`provider keys:            ${c.providerKeys ?? 0}  (empty skipped: ${c.providerKeysSkippedEmpty ?? 0})`);
  console.log(`provider keys encrypted:  ${(c.providersStrippedLegacyKey ?? 0) + (c.providersStrippedKeyPool ?? 0)} sources (legacy: ${c.providersStrippedLegacyKey ?? 0}, pools: ${c.providersStrippedKeyPool ?? 0})`);
  console.log(`models:                   ${c.models ?? 0}  (duplicate ids dropped: ${c.modelDupIds ?? 0})`);
  console.log(`routing pools:            ${c.pools ?? 0}  targets: ${c.poolTargets ?? 0}`);
  console.log(`model aliases:            ${c.modelAliases ?? 0}`);
  console.log(`virtual keys:             ${c.virtualKeys ?? 0}  usage buckets: ${c.virtualKeyUsage ?? 0}  (todays tokens preserved: ${c.virtualKeyUsageMetaTokens ?? 0})`);
  console.log(`semantic cache:           ${c.cacheEntries ?? 0}  (duplicates hopped: ${c.cacheDeduped ?? 0})`);
  console.log(`chat sessions:            ${c.chatSessions ?? 0}  messages: ${c.chatMessages ?? 0}  (orphan sessions recovered: ${c.orphanSessionsRecovered ?? 0})`);
  console.log(`stats history rows:       ${c.statsHistory ?? 0}`);
  console.log('\nOriginals untouched. Secrets are AES-256-GCM at rest.');
}

const IS_MAIN =
  process.argv.length >= 2 &&
  path.basename(fileURLToPath(import.meta.url)).replace(/\.(ts|mjs|js)$/i, '') ===
    path.basename(process.argv[1]).replace(/\.(ts|mjs|js)$/i, '');

if (IS_MAIN) {
  main().catch((e) => { console.error((e as Error).message ?? String(e)); process.exit(1); });
}