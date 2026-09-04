/**
 * SQLite (libsql) client.
 *
 * WAL journal mode gives real concurrent-safe readers + a single writer across
 * the HTTP process and the MCP process — the structural fix for weaknesses
 * W-1..W-5 (no more cross-process config clobber). The file path is overridable
 * via GATEWAY_DB_PATH so tests can use an ephemeral DB.
 */
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import { createClient, type Client } from '@libsql/client';
import fs from 'node:fs';
import path from 'node:path';
import { schema } from './schema.js';

export function resolveDbPath(): string {
  const env = process.env.GATEWAY_DB_PATH;
  if (env) return path.isAbsolute(env) ? env : path.resolve(env);
  return path.resolve(process.cwd(), 'data', 'gateway.db');
}

let client: Client | null = null;
let db: LibSQLDatabase<typeof schema> | null = null;

const DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS providers (
     id TEXT PRIMARY KEY, name TEXT NOT NULL, base_url TEXT NOT NULL,
     protocol TEXT NOT NULL DEFAULT 'openai-compatible', category TEXT,
     enabled INTEGER NOT NULL DEFAULT 1, proxy_enabled INTEGER NOT NULL DEFAULT 0,
     proxy_url TEXT NOT NULL DEFAULT '', encrypted_api_key TEXT, website TEXT,
     signup_url TEXT, credits_description TEXT, limits_description TEXT,
     limits_json TEXT, legacy_json TEXT,
     created_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z',
     updated_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z'
   )`,
  `CREATE TABLE IF NOT EXISTS provider_keys (
     id TEXT PRIMARY KEY, provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
     encrypted_key TEXT NOT NULL, weight INTEGER NOT NULL DEFAULT 1, enabled INTEGER NOT NULL DEFAULT 1
   )`,
  `CREATE TABLE IF NOT EXISTS capability_profiles (
     id TEXT PRIMARY KEY, protocol TEXT NOT NULL DEFAULT 'openai-compatible',
     param_map_json TEXT NOT NULL DEFAULT '{}', unsupported_params_json TEXT NOT NULL DEFAULT '[]',
     rate_limit_header_format TEXT NOT NULL DEFAULT 'openai-standard'
   )`,
  `CREATE TABLE IF NOT EXISTS models (
     id TEXT PRIMARY KEY, provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
     model_id TEXT NOT NULL, name TEXT, context_window INTEGER, supports_tools INTEGER NOT NULL DEFAULT 0,
     supports_vision INTEGER NOT NULL DEFAULT 0, supports_json_mode INTEGER NOT NULL DEFAULT 0,
     limits_json TEXT, capability_profile_id TEXT REFERENCES capability_profiles(id)
   )`,
  `CREATE TABLE IF NOT EXISTS routing_pools (
     id TEXT PRIMARY KEY, name TEXT NOT NULL, strategy TEXT NOT NULL DEFAULT 'priority',
     config_json TEXT NOT NULL DEFAULT '{}', limits_json TEXT
   )`,
  `CREATE TABLE IF NOT EXISTS pool_targets (
     id INTEGER PRIMARY KEY AUTOINCREMENT, pool_id TEXT NOT NULL REFERENCES routing_pools(id) ON DELETE CASCADE,
     provider_id TEXT REFERENCES providers(id) ON DELETE SET NULL, model_id TEXT, priority INTEGER NOT NULL DEFAULT 0,
     UNIQUE(pool_id, provider_id, model_id)
   )`,
  `CREATE TABLE IF NOT EXISTS model_aliases (
     source_model TEXT PRIMARY KEY, target_id TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS virtual_keys (
     id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 1, rpm_limit INTEGER NOT NULL DEFAULT 0,
     rpd_limit INTEGER NOT NULL DEFAULT 0
   )`,
  `CREATE TABLE IF NOT EXISTS virtual_key_usage (
     id INTEGER PRIMARY KEY AUTOINCREMENT, virtual_key_id TEXT NOT NULL REFERENCES virtual_keys(id) ON DELETE CASCADE,
     bucket_type TEXT NOT NULL, window_start INTEGER NOT NULL, requests INTEGER NOT NULL DEFAULT 0, tokens INTEGER NOT NULL DEFAULT 0,
     UNIQUE(virtual_key_id, bucket_type, window_start)
   )`,
  `CREATE TABLE IF NOT EXISTS rate_limit_state (
     scope_key TEXT NOT NULL, window_type TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0,
     tokens INTEGER NOT NULL DEFAULT 0, next_reset_at INTEGER NOT NULL,
     PRIMARY KEY(scope_key, window_type)
  )`,
  `CREATE TABLE IF NOT EXISTS circuit_breaker_state (
     target_key TEXT PRIMARY KEY, state TEXT NOT NULL DEFAULT 'CLOSED',
     consecutive_failures INTEGER NOT NULL DEFAULT 0, opened_at INTEGER,
     half_open_at INTEGER, next_probe_at INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS requests_history (
     id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT NOT NULL, success INTEGER NOT NULL DEFAULT 1,
     requested_model TEXT, provider_id TEXT, model_id TEXT, prompt_tokens INTEGER NOT NULL DEFAULT 0,
     completion_tokens INTEGER NOT NULL DEFAULT 0, latency_ms INTEGER NOT NULL DEFAULT 0,
     cache_hit INTEGER NOT NULL DEFAULT 0, error_code TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS cache_entries (
     id INTEGER PRIMARY KEY AUTOINCREMENT, prompt_hash TEXT NOT NULL, model_scope TEXT NOT NULL,
     prompt_text TEXT, completion_json TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER,
     UNIQUE(prompt_hash, model_scope)
  )`,
  `CREATE TABLE IF NOT EXISTS chat_sessions (
     id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS chat_messages (
     id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
     role TEXT NOT NULL, content TEXT, steps_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS stats_history (
     id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT NOT NULL,
     snapshot_hash TEXT NOT NULL UNIQUE, snapshot_json TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS logs (
     id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp TEXT NOT NULL, level TEXT NOT NULL,
     message TEXT NOT NULL, details_json TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL)`,
];

/** Initialize the singleton DB connection (WAL + schema). */
export async function initDb(): Promise<{ db: LibSQLDatabase<typeof schema>; client: Client }> {
  const file = resolveDbPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // libsql accepts file: URLs; Windows backslashes must be converted.
  const fileUrl = `file:${file.replace(/\\/g, '/')}`;
  const c = createClient({ url: fileUrl });
  for (const stmt of [
    `PRAGMA journal_mode = WAL`,
    `PRAGMA busy_timeout = 5000`,
    `PRAGMA synchronous = NORMAL`,
    `PRAGMA foreign_keys = ON`,
    `PRAGMA temp_store = MEMORY`,
  ]) {
    try {
      await c.execute(stmt);
    } catch {
      /* journal_mode returns a row; harmless. */
    }
  }
  for (const stmt of DDL) await c.execute(stmt);
  const d = drizzle(c, { schema, casing: 'snake_case' });
  client = c;
  db = d;
  return { db: d, client: c };
}

/** Returns the singleton Drizzle handle (initDb must have run first). */
export function getDb(): LibSQLDatabase<typeof schema> {
  if (!db) throw new Error('Database not initialized — call initDb() first.');
  return db;
}
export function getClient(): Client {
  if (!client) throw new Error('Database client not initialized — call initDb() first.');
  return client;
}

/** True when the live database is in WAL mode (used by migration tests). */
export async function isWalMode(): Promise<boolean> {
  const res = await getClient().execute(`PRAGMA journal_mode`);
  const row = res.rows?.[0];
  const mode = row && typeof row === 'object' ? (row as Record<string, unknown>).journal_mode : undefined;
  return mode === 'wal';
}
