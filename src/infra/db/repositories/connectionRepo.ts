import Database from 'better-sqlite3';
import { generateId } from '../../../shared/ids.js';
import { ConnectionStatus, ConnectionTier } from '../../../shared/types.js';

export interface ProviderConnectionRecord {
  id: string;
  provider_id: string;
  label: string;
  credential_enc: Buffer;
  credential_iv: Buffer;
  credential_tag: Buffer;
  tier: ConnectionTier;
  status: ConnectionStatus;
  last_tested_at: number | null;
  last_error: string | null;
  created_at: number;
  updated_at: number;
}

export class ConnectionRepository {
  constructor(private db: Database.Database) {}

  public create(connection: Omit<ProviderConnectionRecord, 'id' | 'created_at' | 'updated_at'>): ProviderConnectionRecord {
    const id = generateId('conn');
    const now = Date.now();

    const stmt = this.db.prepare(`
      INSERT INTO provider_connections (
        id, provider_id, label, credential_enc, credential_iv, credential_tag, tier, status, last_tested_at, last_error, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      connection.provider_id,
      connection.label,
      connection.credential_enc,
      connection.credential_iv,
      connection.credential_tag,
      connection.tier || 'free',
      connection.status || 'untested',
      connection.last_tested_at || null,
      connection.last_error || null,
      now,
      now
    );

    return this.findById(id)!;
  }

  public findById(id: string): ProviderConnectionRecord | null {
    const stmt = this.db.prepare('SELECT * FROM provider_connections WHERE id = ?');
    return (stmt.get(id) as ProviderConnectionRecord) || null;
  }

  public listByProviderId(providerId: string): ProviderConnectionRecord[] {
    const stmt = this.db.prepare('SELECT * FROM provider_connections WHERE provider_id = ? ORDER BY created_at DESC');
    return stmt.all(providerId) as ProviderConnectionRecord[];
  }

  public listAll(): ProviderConnectionRecord[] {
    const stmt = this.db.prepare('SELECT * FROM provider_connections ORDER BY created_at DESC');
    return stmt.all() as ProviderConnectionRecord[];
  }

  public updateStatus(id: string, status: ConnectionStatus, lastError?: string | null): void {
    const now = Date.now();
    const stmt = this.db.prepare(`
      UPDATE provider_connections
      SET status = ?, last_tested_at = ?, last_error = ?, updated_at = ?
      WHERE id = ?
    `);
    stmt.run(status, now, lastError || null, now, id);
  }

  public delete(id: string): boolean {
    const stmt = this.db.prepare('DELETE FROM provider_connections WHERE id = ?');
    const result = stmt.run(id);
    return result.changes > 0;
  }
}
