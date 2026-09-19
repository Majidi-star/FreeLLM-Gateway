import Database from 'better-sqlite3';
import { generateId } from '../../../shared/ids.js';

export interface AccountRecord {
  id: string;
  name: string;
  description: string | null;
  status: 'active' | 'suspended' | 'deleted';
  default_pool_id: string | null;
  default_goal_id: string | null;
  monthly_budget_usd: number | null;
  rate_limit_rpm: number | null;
  rate_limit_tpm: number | null;
  max_keys: number;
  metadata: string;
  created_at: number;
  updated_at: number;
}

export class AccountRepository {
  private createStmt: any;
  private findByIdStmt: any;
  private findByNameStmt: any;
  private listAllStmt: any;
  private updateStmt: any;
  private softDeleteStmt: any;
  private countActiveStmt: any;
  constructor(private db: Database.Database) {
    // Prepare statements
    this.createStmt = this.db.prepare(`
      INSERT INTO accounts (
        id, name, description, status, default_pool_id, default_goal_id,
        monthly_budget_usd, rate_limit_rpm, rate_limit_tpm, max_keys, metadata,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.findByIdStmt = this.db.prepare('SELECT * FROM accounts WHERE id = ?');
    this.findByNameStmt = this.db.prepare('SELECT * FROM accounts WHERE name = ?');
    this.listAllStmt = this.db.prepare(`
      SELECT * FROM accounts
      WHERE (status <> 'deleted' OR ? = 1)
      ORDER BY created_at DESC
    `);
    this.updateStmt = this.db.prepare(`
      UPDATE accounts SET
        name = COALESCE(?, name),
        description = COALESCE(?, description),
        status = COALESCE(?, status),
        default_pool_id = COALESCE(?, default_pool_id),
        default_goal_id = COALESCE(?, default_goal_id),
        monthly_budget_usd = COALESCE(?, monthly_budget_usd),
        rate_limit_rpm = COALESCE(?, rate_limit_rpm),
        rate_limit_tpm = COALESCE(?, rate_limit_tpm),
        max_keys = COALESCE(?, max_keys),
        metadata = COALESCE(?, metadata),
        updated_at = ?
      WHERE id = ?
    `);
    this.softDeleteStmt = this.db.prepare(`
      UPDATE accounts SET status = 'deleted', updated_at = ? WHERE id = ?
    `);
    this.countActiveStmt = this.db.prepare('SELECT COUNT(*) AS count FROM accounts WHERE status = \'active\'');
  }

  public create(input: Omit<AccountRecord, 'id' | 'created_at' | 'updated_at'>): AccountRecord {
    const id = generateId('acc');
    const now = Date.now();
    this.createStmt.run(
      id,
      input.name,
      input.description ?? null,
      input.status ?? 'active',
      input.default_pool_id ?? null,
      input.default_goal_id ?? null,
      input.monthly_budget_usd ?? null,
      input.rate_limit_rpm ?? null,
      input.rate_limit_tpm ?? null,
      input.max_keys ?? 20,
      input.metadata ?? '{}',
      now,
      now
    );
    return this.findById(id)!;
  }

  public findById(id: string): AccountRecord | null {
    const row = this.findByIdStmt.get(id);
    return row as AccountRecord || null;
  }

  public findByName(name: string): AccountRecord | null {
    const row = this.findByNameStmt.get(name);
    return row as AccountRecord || null;
  }

  public listAll(opts: { includeDeleted?: boolean } = {}): AccountRecord[] {
    const includeDeleted = opts.includeDeleted ?? false;
    const rows = this.listAllStmt.all(includeDeleted ? 1 : 0);
    return rows as AccountRecord[];
  }

  public update(id: string, patch: Partial<Omit<AccountRecord, 'id' | 'created_at' | 'updated_at'>>): AccountRecord | null {
    const current = this.findById(id);
    if (!current) return null;
    const now = Date.now();
    this.updateStmt.run(
      patch.name ?? undefined,
      patch.description ?? undefined,
      patch.status ?? undefined,
      patch.default_pool_id ?? undefined,
      patch.default_goal_id ?? undefined,
      patch.monthly_budget_usd ?? undefined,
      patch.rate_limit_rpm ?? undefined,
      patch.rate_limit_tpm ?? undefined,
      patch.max_keys ?? undefined,
      patch.metadata ?? undefined,
      now,
      id
    );
    return this.findById(id);
  }

  public softDelete(id: string): void {
    const now = Date.now();
    this.softDeleteStmt.run(now, id);
  }

  public countActive(): number {
    const row = this.countActiveStmt.get();
    return row.count as number;
  }
}