import Database from 'better-sqlite3';
import { generateId } from '../../../shared/ids.js';

export interface ApiKeyRecord {
  id: string;
  account_id: string;
  name: string;
  key_lookup: string;
  key_hash: string;
  key_hint: string;
  scopes: string;
  pool_id: string | null;
  status: 'active' | 'revoked' | 'rotated';
  rotated_from_id: string | null;
  rotated_to_id: string | null;
  last_used_at: number | null;
  request_count: number;
  expires_at: number | null;
  created_at: number;
  revoked_at: number | null;
}

export class ApiKeyRepository {
  private insertStmt: any;
  private findByLookupStmt: any;
  private findByIdStmt: any;
  private listByAccountStmt: any;
  private countActiveForAccountStmt: any;
  private markRevokedStmt: any;
  private markRotatedOldStmt: any;
  private markRotatedNewStmt: any;
  private touchUsageStmt: any;
  constructor(private db: Database.Database) {
    // Prepare statements
    this.insertStmt = this.db.prepare(`
      INSERT INTO api_keys (
        id, account_id, name, key_lookup, key_hash, key_hint, scopes, pool_id,
        status, rotated_from_id, rotated_to_id, last_used_at, request_count,
        expires_at, created_at, revoked_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.findByLookupStmt = this.db.prepare('SELECT * FROM api_keys WHERE key_lookup = ?');
    this.findByIdStmt = this.db.prepare('SELECT * FROM api_keys WHERE id = ?');
    this.listByAccountStmt = this.db.prepare(`
      SELECT * FROM api_keys
      WHERE account_id = ? AND (status <> 'revoked' OR ? = 1)
      ORDER BY created_at DESC
    `);
    this.countActiveForAccountStmt = this.db.prepare(`
      SELECT COUNT(*) AS count FROM api_keys
      WHERE account_id = ? AND status = 'active'
    `);
    this.markRevokedStmt = this.db.prepare(`
      UPDATE api_keys SET status = 'revoked', revoked_at = ? WHERE id = ?
    `);
    this.markRotatedOldStmt = this.db.prepare(`
      UPDATE api_keys SET status = 'rotated', rotated_to_id = ?, revoked_at = ? WHERE id = ?
    `);
    this.markRotatedNewStmt = this.db.prepare(`
      UPDATE api_keys SET rotated_from_id = ? WHERE id = ?
    `);
    this.touchUsageStmt = this.db.prepare(`
      UPDATE api_keys SET last_used_at = ?, request_count = request_count + 1 WHERE id = ?
    `);
  }

  public insert(rec: Omit<ApiKeyRecord, 'id' | 'created_at'>): ApiKeyRecord {
    const id = generateId('key');
    const now = Date.now();
    this.insertStmt.run(
      id,
      rec.account_id,
      rec.name,
      rec.key_lookup,
      rec.key_hash,
      rec.key_hint,
      rec.scopes ?? '[\\\"chat\\\"]',
      rec.pool_id ?? null,
      rec.status ?? 'active',
      rec.rotated_from_id ?? null,
      rec.rotated_to_id ?? null,
      rec.last_used_at ?? null,
      rec.request_count ?? 0,
      rec.expires_at ?? null,
      now,
      rec.revoked_at ?? null
    );
    return this.findById(id)!;
  }

  public findByLookup(lookup: string): ApiKeyRecord | null {
    const row = this.findByLookupStmt.get(lookup);
    return row as ApiKeyRecord || null;
  }

  public findById(id: string): ApiKeyRecord | null {
    const row = this.findByIdStmt.get(id);
    return row as ApiKeyRecord || null;
  }

  public listByAccount(accountId: string, opts: { includeRevoked?: boolean } = {}): ApiKeyRecord[] {
    const includeRevoked = opts.includeRevoked ?? false;
    const rows = this.listByAccountStmt.all(accountId, includeRevoked ? 1 : 0);
    return rows as ApiKeyRecord[];
  }

  public countActiveForAccount(accountId: string): number {
    const row = this.countActiveForAccountStmt.get(accountId);
    return row.count as number;
  }

  public markRevoked(id: string): void {
    const now = Date.now();
    this.markRevokedStmt.run(now, id);
  }

  public markRotated(oldId: string, newId: string): void {
    const now = Date.now();
    this.db.transaction(() => {
      this.markRotatedOldStmt.run(oldId, newId, now);
      this.markRotatedNewStmt.run(newId, oldId);
    })();
  }

  public touchUsage(id: string, at: number): void {
    this.touchUsageStmt.run(at, id);
  }
}