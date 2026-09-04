/**
 * Typed repository layer over the Drizzle schema.
 *
 * Kept intentionally thin at this phase: it exposes settings (which carries the
 * migration marker), plus read helpers used by the migration verifier and by
 * future phases. All writes in the migration run inside one transaction.
 */
import { eq } from 'drizzle-orm';
import { getClient, getDb } from './client.js';
import { settings } from './schema.js';

export async function setSettingJson<T>(key: string, value: T): Promise<void> {
  const db = getDb();
  const json = JSON.stringify(value);
  await db
    .insert(settings)
    .values({ key, valueJson: json })
    .onConflictDoUpdate({ target: settings.key, set: { valueJson: json } });
}

export async function getSettingJson<T>(key: string, fallback?: T): Promise<T | undefined> {
  const db = getDb();
  const rows = await db.select().from(settings).where(eq(settings.key, key));
  if (!rows.length) return fallback;
  return JSON.parse(rows[0].valueJson) as T;
}

/**
 * Row count for one of our schema tables. `table` must be a literal string from
 * a bounded allow-list (never user input) — enforced by the caller.
 */
export async function tableCount(table: string): Promise<number> {
  const rows = (await getClient().execute(`SELECT COUNT(*) AS n FROM ${table}`)).rows;
  return Number(rows[0]?.n ?? 0);
}

/** True when the provided table exists in the live database (for verifier t.s). */
export async function tableExists(table: string): Promise<boolean> {
  const rows = (
    await getClient().execute(
      `SELECT name FROM sqlite_master WHERE type='table' AND name = ?`,
      [table],
    )
  ).rows;
  return (rows?.length ?? 0) > 0;
}