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

  const db = new Database(dbPath);

  // Set WAL mode and pragmas for performance and data safety
  if (dbPath !== ':memory:') {
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
  }
  db.pragma('foreign_keys = ON');

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
