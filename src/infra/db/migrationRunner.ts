import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { logger } from '../logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function runMigrations(db: Database.Database, migrationsDir?: string): void {
  const projectRoot = process.cwd();
  const srcDir = path.join(projectRoot, 'src', 'infra', 'db', 'migrations');
  const distDir = path.join(__dirname, 'migrations');

  const dir = migrationsDir || (fs.existsSync(srcDir) ? srcDir : distDir);

  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      checksum TEXT NOT NULL,
      executed_at INTEGER NOT NULL
    );
  `);

  if (!fs.existsSync(dir)) {
    logger.warn({ dir }, 'Migrations directory does not exist, skipping migrations');
    return;
  }

  const files = fs.readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const getMigrationStmt = db.prepare('SELECT checksum FROM _migrations WHERE name = ?');
  const insertMigrationStmt = db.prepare('INSERT INTO _migrations (name, checksum, executed_at) VALUES (?, ?, ?)');

  for (const file of files) {
    const filePath = path.join(dir, file);
    const sqlContent = fs.readFileSync(filePath, 'utf-8');
    const checksum = crypto.createHash('sha256').update(sqlContent).digest('hex');

    const existing = getMigrationStmt.get(file) as { checksum: string } | undefined;

    if (existing) {
      if (existing.checksum !== checksum) {
        throw new Error(`Checksum mismatch for migration ${file}. Expected ${existing.checksum}, got ${checksum}. Shipped migrations must be immutable.`);
      }
      continue;
    }

    logger.info({ migration: file }, 'Executing database migration');

    db.transaction(() => {
      db.exec(sqlContent);
      insertMigrationStmt.run(file, checksum, Date.now());
    })();
  }
}
