import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { getConfig } from '../config.js';
import { logger } from '../logger.js';

let dbInstance: Database.Database | null = null;

export function getDatabase(dbPathOverride?: string): Database.Database {
  if (dbInstance && !dbPathOverride) {
    return dbInstance;
  }

  const config = getConfig();
  const dbPath = dbPathOverride || config.DATABASE_PATH;

  if (dbPath !== ':memory:') {
    const dbDir = path.dirname(path.resolve(dbPath));
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
  }

  logger.debug({ dbPath }, 'Initializing SQLite database');

  let db: Database.Database;
  try {
    db = new Database(dbPath);
    // Set WAL mode and pragmas for performance and data safety
    if (dbPath !== ':memory:') {
      db.pragma('journal_mode = WAL');
      db.pragma('synchronous = NORMAL');
      db.pragma('busy_timeout = 5000');
    }
    db.pragma('busy_timeout = 5000');
    db.pragma('foreign_keys = ON');
  } catch (err: any) {
    const msg = err?.message || String(err);
    if (msg.includes('SQLITE_BUSY') || msg.includes('locked')) {
      throw new Error(`SQLite database file at '${dbPath}' is locked by another process. (${msg})`);
    } else if (msg.includes('SQLITE_READONLY') || msg.includes('readonly') || msg.includes('EACCES') || msg.includes('PERM')) {
      throw new Error(`SQLite database file at '${dbPath}' is read-only or lacks write permissions. (${msg})`);
    } else if (msg.includes('SQLITE_CANTOPEN') || msg.includes('IOERR')) {
      throw new Error(`Failed to open SQLite database at '${dbPath}'. Check directory permissions or filesystem compatibility. (${msg})`);
    }
    throw new Error(`Failed to initialize SQLite database at '${dbPath}': ${msg}`);
  }

  if (!dbPathOverride) {
    dbInstance = db;
  }

  return db;
}

export function closeDatabase(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}
