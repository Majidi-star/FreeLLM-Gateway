import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AccountRepository } from '../../src/infra/db/repositories/accountRepo.js';
import { ApiKeyRepository } from '../../src/infra/db/repositories/apiKeyRepo.js';
import { AuthService } from '../../src/services/authService.js';
import { generateApiKey, hashApiKey, extractLookup, resetPepperForTest } from '../../src/infra/security/apiKeyCrypto.js';
import { getDatabase } from '../../src/infra/db/client.js';
import { AppError } from '../../src/shared/errors.js';
import { generateId } from '../../src/shared/ids.js';

const db = getDatabase();

function truncateTables() {
  db.transaction(() => {
    db.prepare('DELETE FROM request_logs').run();
    db.prepare('DELETE FROM usage_rollups').run();
    db.prepare('DELETE FROM tenant_rate_usage').run();
    db.prepare('DELETE FROM api_keys').run();
    db.prepare('DELETE FROM accounts').run();
  })();
}

describe('AuthService', () => {
  let accountRepo: AccountRepository;
  let apiKeyRepo: ApiKeyRepository;
  let authService: AuthService;
  let testAccountId: string;
  const adminToken = 'gr_admin_test_token_123456789012';

  beforeEach(() => {
    truncateTables();
    resetPepperForTest();
    process.env.ADMIN_API_KEY = adminToken;
    accountRepo = new AccountRepository(db);
    apiKeyRepo = new ApiKeyRepository(db);
    authService = new AuthService(accountRepo, apiKeyRepo);

    const account = accountRepo.create({
      name: 'Test Account',
      description: null,
      status: 'active',
      default_pool_id: null,
      default_goal_id: null,
      monthly_budget_usd: null,
      rate_limit_rpm: 100,
      rate_limit_tpm: 10000,
      max_keys: 20,
      metadata: '{}'
    });
    testAccountId = account.id;
  });

  afterEach(() => {
    truncateTables();
    delete process.env.ADMIN_API_KEY;
  });

  it('valid admin token → kind: admin', () => {
    const ctx = authService.resolveBearer(adminToken, adminToken);
    expect(ctx.kind).toBe('admin');
    expect(ctx.accountId).toBeNull();
    expect(ctx.accountName).toBeNull();
    expect(ctx.apiKeyId).toBeNull();
    expect(ctx.scopes).toEqual(['*']);
  });

  it('valid account key → kind: account with correct accountId', () => {
    const { plaintext, lookup, hint } = generateApiKey();
    const keyHash = hashApiKey(plaintext);
    apiKeyRepo.insert({
      account_id: testAccountId,
      name: 'Test Key',
      key_lookup: lookup,
      key_hash: keyHash,
      key_hint: hint,
      scopes: '["chat"]',
      pool_id: null,
      status: 'active',
      rotated_from_id: null,
      rotated_to_id: null,
      last_used_at: null,
      request_count: 0,
      expires_at: null,
      created_at: Date.now(),
      revoked_at: null
    });

    const ctx = authService.resolveBearer(plaintext, adminToken);
    expect(ctx.kind).toBe('account');
    expect(ctx.accountId).toBe(testAccountId);
    expect(ctx.accountName).toBe('Test Account');
    expect(ctx.apiKeyId).toBeTypeOf('string');
    expect(ctx.scopes).toEqual(['chat']);
    expect(ctx.rateLimitRpm).toBe(100);
    expect(ctx.rateLimitTpm).toBe(10000);
  });

  it('one-character-mutated key → anonymous (does not throw)', () => {
    const { plaintext, lookup, hint } = generateApiKey();
    const keyHash = hashApiKey(plaintext);
    apiKeyRepo.insert({
      account_id: testAccountId,
      name: 'Test Key',
      key_lookup: lookup,
      key_hash: keyHash,
      key_hint: hint,
      scopes: '["chat"]',
      pool_id: null,
      status: 'active',
      rotated_from_id: null,
      rotated_to_id: null,
      last_used_at: null,
      request_count: 0,
      expires_at: null,
      created_at: Date.now(),
      revoked_at: null
    });

    // Mutate one character in the key
    const mutatedKey = plaintext.slice(0, -1) + (plaintext.slice(-1) === 'a' ? 'b' : 'a');
    const ctx = authService.resolveBearer(mutatedKey, adminToken);
    expect(ctx.kind).toBe('anonymous');
    expect(ctx.accountId).toBeNull();
  });

  it('revoked key → throws KEY_REVOKED', () => {
    const { plaintext, lookup, hint } = generateApiKey();
    const keyHash = hashApiKey(plaintext);
    const key = apiKeyRepo.insert({
      account_id: testAccountId,
      name: 'Test Key',
      key_lookup: lookup,
      key_hash: keyHash,
      key_hint: hint,
      scopes: '["chat"]',
      pool_id: null,
      status: 'active',
      rotated_from_id: null,
      rotated_to_id: null,
      last_used_at: null,
      request_count: 0,
      expires_at: null,
      created_at: Date.now(),
      revoked_at: null
    });

    apiKeyRepo.markRevoked(key.id);

    expect(() => authService.resolveBearer(plaintext, adminToken)).toThrow(AppError);
    try {
      authService.resolveBearer(plaintext, adminToken);
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).code).toBe('KEY_REVOKED');
      expect((e as AppError).statusCode).toBe(401);
    }
  });

  it('rotated key inside grace → resolves; after grace → throws', () => {
    const { plaintext, lookup, hint } = generateApiKey();
    const keyHash = hashApiKey(plaintext);
    const key = apiKeyRepo.insert({
      account_id: testAccountId,
      name: 'Test Key',
      key_lookup: lookup,
      key_hash: keyHash,
      key_hint: hint,
      scopes: '["chat"]',
      pool_id: null,
      status: 'active',
      rotated_from_id: null,
      rotated_to_id: null,
      last_used_at: null,
      request_count: 0,
      expires_at: null,
      created_at: Date.now(),
      revoked_at: null
    });

    // Mark as rotated with expires_at in the future (grace period)
    const futureExpiry = Date.now() + 60_000; // 1 minute from now
    db.prepare(`UPDATE api_keys SET status = 'rotated', expires_at = ? WHERE id = ?`).run(futureExpiry, key.id);

    // Should resolve during grace period
    const ctx = authService.resolveBearer(plaintext, adminToken);
    expect(ctx.kind).toBe('account');
    expect(ctx.accountId).toBe(testAccountId);

    // Now set expires_at to past (grace expired)
    db.prepare(`UPDATE api_keys SET expires_at = ? WHERE id = ?`).run(Date.now() - 60_000, key.id);

    // Should throw after grace period
    expect(() => authService.resolveBearer(plaintext, adminToken)).toThrow(AppError);
    try {
      authService.resolveBearer(plaintext, adminToken);
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).code).toBe('KEY_REVOKED');
    }
  });

  it('key on suspended account → returns account context (current behavior: no ACCOUNT_INACTIVE check)', () => {
    const { plaintext, lookup, hint } = generateApiKey();
    const keyHash = hashApiKey(plaintext);
    apiKeyRepo.insert({
      account_id: testAccountId,
      name: 'Test Key',
      key_lookup: lookup,
      key_hash: keyHash,
      key_hint: hint,
      scopes: '["chat"]',
      pool_id: null,
      status: 'active',
      rotated_from_id: null,
      rotated_to_id: null,
      last_used_at: null,
      request_count: 0,
      expires_at: null,
      created_at: Date.now(),
      revoked_at: null
    });

    // Suspend the account
    accountRepo.update(testAccountId, { status: 'suspended' });

    // Current behavior: returns account context even for suspended account
    // (AuthService doesn't check account.status, only if account exists)
    const ctx = authService.resolveBearer(plaintext, adminToken);
    expect(ctx.kind).toBe('account');
    expect(ctx.accountId).toBe(testAccountId);
    // TODO: When ACCOUNT_INACTIVE check is implemented, this should throw
  });

  it('hashApiKey stability and divergence across generated keys', () => {
    const { plaintext: key1 } = generateApiKey();
    const { plaintext: key2 } = generateApiKey();

    const hash1a = hashApiKey(key1);
    const hash1b = hashApiKey(key1);
    const hash2 = hashApiKey(key2);

    // Same key should produce same hash
    expect(hash1a).toBe(hash1b);
    // Different keys should produce different hashes
    expect(hash1a).not.toBe(hash2);
    // Hashes should be valid hex strings (64 chars for sha256)
    expect(hash1a).toMatch(/^[0-9a-f]{64}$/);
    expect(hash2).toMatch(/^[0-9a-f]{64}$/);
  });
});