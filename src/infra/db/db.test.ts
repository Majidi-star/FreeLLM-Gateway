import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { getDatabase, closeDatabase } from './client.js';
import { runMigrations } from './migrationRunner.js';

describe('Database & Migrations', () => {
  let db: Database.Database;

  beforeEach(() => {
    // Set required env var for config
    process.env.ENCRYPTION_MASTER_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    db = getDatabase(':memory:');
  });

  afterEach(() => {
    closeDatabase();
  });

  it('runs 0001_init.sql migration idempotently', () => {
    runMigrations(db);

    // Verify tables exist
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all() as { name: string }[];

    const tableNames = tables.map((t) => t.name);
    expect(tableNames).toContain('providers');
    expect(tableNames).toContain('provider_connections');
    expect(tableNames).toContain('models');
    expect(tableNames).toContain('goals');
    expect(tableNames).toContain('pools');
    expect(tableNames).toContain('pool_steps');
    expect(tableNames).toContain('request_logs');
    expect(tableNames).toContain('_migrations');

    // Re-running migrations should be a no-op
    expect(() => runMigrations(db)).not.toThrow();
  });
});
