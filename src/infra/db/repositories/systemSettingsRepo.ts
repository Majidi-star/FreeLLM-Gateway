import Database from 'better-sqlite3';

export class SystemSettingsRepository {
  private getStmt: Database.Statement;
  private setStmt: Database.Statement;
  private deleteStmt: Database.Statement;

  constructor(private db: Database.Database) {
    this.getStmt = this.db.prepare('SELECT value FROM system_settings WHERE key = ?');
    this.setStmt = this.db.prepare(
      'INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'
    );
    this.deleteStmt = this.db.prepare('DELETE FROM system_settings WHERE key = ?');
  }

  public get(key: string): string | null {
    const row = this.getStmt.get(key) as { value: string } | undefined;
    return row ? row.value : null;
  }

  public set(key: string, value: string): void {
    this.setStmt.run(key, value, Date.now());
  }

  public delete(key: string): void {
    this.deleteStmt.run(key);
  }
}
