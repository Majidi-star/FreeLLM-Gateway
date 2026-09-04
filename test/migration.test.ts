import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { writeV1Fixture, setEnvForDb, makeTempDir } from './helpers.js';
import { initDb, getDb, getClient, isWalMode } from '../server/db/client.js';
import { runMigration } from '../scripts/migrate-v1.js';
import { masterKey, encryptSecret, decryptSecret } from '../server/db/keystore.js';
import { getSettingJson } from '../server/db/repos.js';
import { eq } from 'drizzle-orm';
import {
  providers as providersTable,
  providerKeys as providerKeysTable,
  models as modelsTable,
  routingPools as routingPoolsTable,
  poolTargets as poolTargetsTable,
  chatSessions as chatSessionsTable,
  chatMessages as chatMessagesTable,
  cacheEntries as cacheTable,
  statsHistory as statsHistoryTable,
} from '../server/db/schema.js';

const tempDirs: string[] = [];
function freshV1(withKeys = true) {
  const fx = writeV1Fixture({ withKeys, withConnectingKeys: true });
  tempDirs.push(fx.dir);
  setEnvForDb(fx.dir);
  return fx;
}

afterEach(() => {
  for (const d of tempDirs.splice(0)) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ }
  }
  delete process.env.GATEWAY_DB_PATH;
  delete process.env.GATEWAY_DATA_DIR;
  delete process.env.GATEWAY_MASTER_KEY_PATH;
});

function fileHash(file: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

describe('keystore (AES-256-GCM)', () => {
  it('round-trips a secret and never stores it in plaintext', () => {
    const d = makeTempDir();
    tempDirs.push(d);
    setEnvForDb(d);
    const secret = 'sk-plaintext-super-secret-value';
    const blob = encryptSecret(secret);
    expect(blob).toBeTruthy();
    expect(blob).not.toContain(secret);
    expect(blob).not.toEqual(secret);
    expect(decryptSecret(blob)).toBe(secret);
  });

  it('produces a unique ciphertext for the same plaintext (fresh IV)', () => {
    const d = makeTempDir();
    tempDirs.push(d);
    setEnvForDb(d);
    expect(encryptSecret('same-value')).not.toEqual(encryptSecret('same-value'));
  });

  it('generates a 32-byte master key file with restrictive permissions', () => {
    const d = makeTempDir();
    tempDirs.push(d);
    setEnvForDb(d);
    const key = masterKey();
    expect(key).toHaveLength(32);
    const f = path.join(d, '.gateway-master-key');
    expect(fs.existsSync(f)).toBe(true);
    expect(fs.readFileSync(f)).toHaveLength(32);
    // On Unix the keystore file is created 0600 (owner read/write only).
    // Windows ignores chmod for files, so the mode check only applies there.
    if (process.platform !== 'win32') {
      expect(fs.statSync(f).mode & 0o777).toBeLessThanOrEqual(0o600);
    }
  });
});

describe('database layer', () => {
  it('initializes to WAL mode', async () => {
    freshV1();
    await initDb();
    expect(await isWalMode()).toBe(true);
  });

  it('creates all expected tables', async () => {
    freshV1();
    await initDb();
    const tables: string[] = [];
    const rows = (await getClient().execute(`SELECT name FROM sqlite_master WHERE type='table'`)).rows;
    for (const r of rows) tables.push(String((r as Record<string, unknown>).name));
    for (const t of ['providers', 'provider_keys', 'models', 'routing_pools', 'pool_targets',
      'model_aliases', 'virtual_keys', 'virtual_key_usage', 'cache_entries', 'chat_sessions',
      'chat_messages', 'stats_history', 'settings']) {
      expect(tables).toContain(t);
    }
  });
});
describe('migration (v1 flat files → v2 sqlite)', () => {
  it('encrypts provider keys at rest and leaves originals untouched', async () => {
    const fx = freshV1(true);
    await initDb();
    await runMigration({ config: fx.configPath, cache: fx.cachePath, chatSessions: fx.chatPath, statsHistory: fx.statsPath });

    const db = getDb();
    const prov = await db.select().from(providersTable).where(eq(providersTable.id, 'groq'));
    expect(prov).toHaveLength(1);
    expect(prov[0].encryptedApiKey).toBeTruthy();
    expect(prov[0].encryptedApiKey).not.toContain('super-secret');
    expect(decryptSecret(prov[0].encryptedApiKey)).toBe('sk-plaintext-super-secret-value');

    const keys = await db.select().from(providerKeysTable);
    expect(keys).toHaveLength(2);
    for (const k of keys) {
      expect(k.encryptedKey).not.toContain('pk-a');
      expect(k.encryptedKey).not.toContain('pk-b');
      expect(k.encryptedKey.length).toBeGreaterThan(10);
    }

    const raw = fs.readFileSync(fx.configPath, 'utf8');
    expect(raw).toContain('sk-plaintext-super-secret-value'); // originals untouched
    expect(fileHash(fx.configPath)).toBeTruthy();
  });

  it('is idempotent — rerunning does not duplicate rows', async () => {
    const fx = freshV1(true);
    await initDb();
    const sources = { config: fx.configPath, cache: fx.cachePath, chatSessions: fx.chatPath, statsHistory: fx.statsPath };
    await runMigration(sources);
    const db = getDb();
    const snapshot = async () => ({
      providers: (await db.select().from(providersTable)).length,
      keys: (await db.select().from(providerKeysTable)).length,
      models: (await db.select().from(modelsTable)).length,
      caches: (await db.select().from(cacheTable)).length,
      sessions: (await db.select().from(chatSessionsTable)).length,
      messages: (await db.select().from(chatMessagesTable)).length,
      stats: (await db.select().from(statsHistoryTable)).length,
    });
    const before = await snapshot();
    await runMigration(sources);
    expect(await snapshot()).toEqual(before);
    expect(before.providers).toBe(1);
    expect(before.keys).toBe(2);
    expect(before.caches).toBe(2);
    expect(before.sessions).toBeGreaterThanOrEqual(2);
  });

  it('writes a migration marker with file hashes', async () => {
    const fx = freshV1(true);
    await initDb();
    await runMigration({ config: fx.configPath, cache: fx.cachePath, chatSessions: fx.chatPath, statsHistory: fx.statsPath });
    const marker = await getSettingJson<{ schemaVersion: number; files: Record<string, { migrated: boolean; hash: string }> }>('v1.migration');
    expect(marker).toBeTruthy();
    expect(marker!.schemaVersion).toBe(1);
    expect(marker!.files.config.migrated).toBe(true);
    expect(marker!.files.config.hash.length).toBe(64);
    expect(marker!.files.statsHistory.migrated).toBe(true);
  });

  it('preserves orphaned chat messages by synthesizing a session', async () => {
    const fx = freshV1(true);
    await initDb();
    await runMigration({ config: fx.configPath, cache: fx.cachePath, chatSessions: fx.chatPath, statsHistory: fx.statsPath });
    const db = getDb();
    const orphanMsg = await db.select().from(chatMessagesTable).where(eq(chatMessagesTable.id, 'orphan_msg'));
    expect(orphanMsg).toHaveLength(1);
    const recovered = await db.select().from(chatSessionsTable).where(eq(chatSessionsTable.id, 'sess_missing'));
    expect(recovered).toHaveLength(1);
    expect(recovered[0].title).toContain('recovered');
  });

  it('rolls back atomically when config is malformed', async () => {
    const fx = freshV1(true);
    await initDb();
    const badConfig = path.join(fx.dir, 'bad-config.json');
    fs.writeFileSync(badConfig, '{"providers": [', 'utf8');
    const err = await (async () => {
      try {
        await runMigration({ config: badConfig, cache: fx.cachePath, chatSessions: fx.chatPath, statsHistory: fx.statsPath });
        return null;
      } catch (e) { return e as Error; }
    })();
    expect(err).not.toBeNull();
    expect((await getDb().select().from(providersTable)).length).toBe(0);
  });

  it('imports into real per-table queries (round-trip)', async () => {
    const fx = freshV1(true);
    await initDb();
    await runMigration({ config: fx.configPath, cache: fx.cachePath, chatSessions: fx.chatPath, statsHistory: fx.statsPath });
    const db = getDb();
    const providers = await db.select().from(providersTable);
    const pools = await db.select().from(routingPoolsTable);
    const targets = await db.select().from(poolTargetsTable);
    const models = await db.select().from(modelsTable);
    const stats = await db.select().from(statsHistoryTable);

    expect(providers.map((p) => p.id)).toContain('groq');
    expect(pools.map((p) => p.id)).toContain('coding-agent');
    expect(targets).toHaveLength(1);
    expect(targets[0].providerId).toBe('groq');
    expect(models.map((m) => m.id)).toContain('groq:llama-3.1-8b-instant');
    expect(stats).toHaveLength(2);
  });
});