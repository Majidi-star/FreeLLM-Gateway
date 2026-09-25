import type Database from 'better-sqlite3';
import type { AuthContext } from '../../domain/auth/types.js';
import { AppError } from '../../shared/errors.js';

export class TenantRateLimiter {
  private checkRpmStmt: Database.Statement;
  private upsertRpmStmt: Database.Statement;
  private checkTpmStmt: Database.Statement;
  private upsertTpmStmt: Database.Statement;

  constructor(private db: Database.Database) {
    this.checkRpmStmt = this.db.prepare(`
      SELECT used_value FROM tenant_rate_usage
      WHERE scope_id = ? AND dimension = 'requests' AND window_start = ?
    `);
    this.upsertRpmStmt = this.db.prepare(`
      INSERT INTO tenant_rate_usage (scope_id, dimension, window_start, used_value)
      VALUES (?, 'requests', ?, 1)
      ON CONFLICT(scope_id, dimension, window_start)
      DO UPDATE SET used_value = used_value + 1
    `);

    this.checkTpmStmt = this.db.prepare(`
      SELECT used_value FROM tenant_rate_usage
      WHERE scope_id = ? AND dimension = 'tokens' AND window_start = ?
    `);
    this.upsertTpmStmt = this.db.prepare(`
      INSERT INTO tenant_rate_usage (scope_id, dimension, window_start, used_value)
      VALUES (?, 'tokens', ?, ?)
      ON CONFLICT(scope_id, dimension, window_start)
      DO UPDATE SET used_value = used_value + excluded.used_value
    `);
  }

  public checkOrThrow(ctx: AuthContext): void {
    if (ctx.kind !== 'account') return;
    const rpmLimit = ctx.rateLimitRpm;
    if (rpmLimit === null || rpmLimit === undefined) return;

    const nowMs = Date.now();
    const windowStart = Math.floor(nowMs / 60000) * 60000;
    const scopeIds = [`account:${ctx.accountId}`];
    if (ctx.apiKeyId) {
      scopeIds.push(`key:${ctx.apiKeyId}`);
    }

    const checkTx = this.db.transaction(() => {
      for (const scopeId of scopeIds) {
        const row = this.checkRpmStmt.get(scopeId, windowStart) as { used_value: number } | undefined;
        const current = row ? row.used_value : 0;
        if (current >= rpmLimit) {
          const retryAfterSeconds = Math.ceil((windowStart + 60000 - nowMs) / 1000);
          throw new AppError(
            `Rate limit exceeded (RPM limit: ${rpmLimit})`,
            'RATE_LIMIT_EXCEEDED',
            429,
            { retryAfterSeconds: Math.max(1, retryAfterSeconds) }
          );
        }
      }

      for (const scopeId of scopeIds) {
        this.upsertRpmStmt.run(scopeId, windowStart);
      }
    });

    checkTx();
  }

  public recordTokens(ctx: AuthContext, tokens: number): void {
    if (ctx.kind !== 'account' || tokens <= 0) return;
    const nowMs = Date.now();
    const windowStart = Math.floor(nowMs / 60000) * 60000;
    const scopeIds = [`account:${ctx.accountId}`];
    if (ctx.apiKeyId) {
      scopeIds.push(`key:${ctx.apiKeyId}`);
    }

    const recordTx = this.db.transaction(() => {
      for (const scopeId of scopeIds) {
        this.upsertTpmStmt.run(scopeId, windowStart, tokens);
      }
    });

    recordTx();
  }
}
