import Database from 'better-sqlite3';
import { generateId } from '../../../shared/ids.js';

export interface ProviderRecord {
  id: string;
  slug: string;
  display_name: string;
  base_url: string;
  auth_type: 'api_key' | 'oauth' | 'keyless';
  protocol: 'openai' | 'anthropic' | 'gemini' | 'custom';
  docs_url: string | null;
  capabilities: string; // JSON string
  is_active: number;
  created_at: number;
  updated_at: number;
}

export class ProviderRepository {
  constructor(private db: Database.Database) {}

  public upsert(provider: Omit<ProviderRecord, 'id' | 'created_at' | 'updated_at'> & { id?: string }): ProviderRecord {
    const now = Date.now();
    const existing = this.findBySlug(provider.slug);

    if (existing) {
      const stmt = this.db.prepare(`
        UPDATE providers
        SET display_name = ?, base_url = ?, auth_type = ?, protocol = ?, docs_url = ?, capabilities = ?, is_active = ?, updated_at = ?
        WHERE id = ?
      `);
      stmt.run(
        provider.display_name,
        provider.base_url,
        provider.auth_type,
        provider.protocol,
        provider.docs_url || null,
        provider.capabilities || '{}',
        provider.is_active ?? 1,
        now,
        existing.id
      );
      return this.findById(existing.id)!;
    } else {
      const id = provider.id || generateId('prov');
      const stmt = this.db.prepare(`
        INSERT INTO providers (id, slug, display_name, base_url, auth_type, protocol, docs_url, capabilities, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        id,
        provider.slug,
        provider.display_name,
        provider.base_url,
        provider.auth_type,
        provider.protocol,
        provider.docs_url || null,
        provider.capabilities || '{}',
        provider.is_active ?? 1,
        now,
        now
      );
      return this.findById(id)!;
    }
  }

  public findById(id: string): ProviderRecord | null {
    const stmt = this.db.prepare('SELECT * FROM providers WHERE id = ?');
    return (stmt.get(id) as ProviderRecord) || null;
  }

  public findBySlug(slug: string): ProviderRecord | null {
    const stmt = this.db.prepare('SELECT * FROM providers WHERE slug = ?');
    return (stmt.get(slug) as ProviderRecord) || null;
  }

  public listAll(onlyActive = false): ProviderRecord[] {
    const sql = onlyActive
      ? 'SELECT * FROM providers WHERE is_active = 1 ORDER BY display_name ASC'
      : 'SELECT * FROM providers ORDER BY display_name ASC';
    const stmt = this.db.prepare(sql);
    return stmt.all() as ProviderRecord[];
  }
}
