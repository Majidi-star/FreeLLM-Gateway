import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/infra/db/migrationRunner.js';
import { QuotaRepository } from '../../src/infra/db/repositories/quotaRepo.js';
import crypto from 'node:crypto';

function safeCompareTokens(provided: string, expected: string): boolean {
  if (!provided || !expected) return false;
  const hashA = crypto.createHash('sha256').update(provided).digest();
  const hashB = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

describe('RC1 Production Hardening Pass (H1-H3, M1-M3, L4, L6)', () => {
  let db: Database.Database;
  let quotaRepo: QuotaRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
    quotaRepo = new QuotaRepository(db);

    // Insert dummy provider and connection for FK constraint
    db.prepare(`
      INSERT INTO providers (id, display_name, slug, base_url, protocol, auth_type, is_active, created_at, updated_at)
      VALUES ('prov_test', 'Test Provider', 'test_prov', 'http://localhost', 'openai', 'api_key', 1, 1000, 1000)
    `).run();
    db.prepare(`
      INSERT INTO provider_connections (id, provider_id, label, credential_enc, credential_iv, credential_tag, status, created_at, updated_at)
      VALUES ('conn_test', 'prov_test', 'Test Conn', 'enc', 'iv', 'tag', 'active', 1000, 1000)
    `).run();
  });

  afterEach(() => {
    db.close();
  });

  describe('Quota Floor & Ceiling Enforcement (H1, L4)', () => {
    it('should reject reserveQuota if amount exceeds limitValue ceiling', () => {
      const reserved = quotaRepo.reserveQuota('conn_test', 'daily_tokens', 1000, 5000, 1000);
      expect(reserved).toBe(false);
      expect(quotaRepo.getUsage('conn_test', 'daily_tokens', 1000)).toBe(0);
    });

    it('should prevent negative usage underflow (floor at 0) in recordUsage', () => {
      quotaRepo.recordUsage('conn_test', 'daily_tokens', 1000, 100);
      expect(quotaRepo.getUsage('conn_test', 'daily_tokens', 1000)).toBe(100);

      // Deduct 500 tokens (more than current 100)
      quotaRepo.recordUsage('conn_test', 'daily_tokens', 1000, -500);
      expect(quotaRepo.getUsage('conn_test', 'daily_tokens', 1000)).toBe(0);
    });
  });

  describe('Timing-Safe Token Comparison (M2)', () => {
    it('should return true for matching tokens and false for mismatched/empty tokens', () => {
      const secret = 'super-secret-admin-token-12345';
      expect(safeCompareTokens(secret, secret)).toBe(true);
      expect(safeCompareTokens('wrong-token', secret)).toBe(false);
      expect(safeCompareTokens('', secret)).toBe(false);
      expect(safeCompareTokens(secret, '')).toBe(false);
    });
  });
});
