import { AccountRepository } from '../infra/db/repositories/accountRepo.js';
import { ApiKeyRepository } from '../infra/db/repositories/apiKeyRepo.js';
import { AuthContext, ADMIN_CONTEXT } from '../domain/auth/types.js';
import { safeCompareTokens } from '../infra/security/constantTime.js';
import { AppError } from '../shared/errors.js';
import { extractLookup, verifyApiKeyHash } from '../infra/security/apiKeyCrypto.js';

export class AuthService {
  constructor(
    private accountRepo: AccountRepository,
    private apiKeyRepo: ApiKeyRepository
  ) {}

  public resolveBearer(token: string | undefined, adminToken: string): AuthContext {
    // 1. If !token → return anonymous
    if (!token) {
      return { kind: 'anonymous', accountId: null, accountName: null, apiKeyId: null, pinnedPoolId: null, defaultPoolId: null, scopes: [], rateLimitRpm: null, rateLimitTpm: null };
    }

    // 2. If safeCompareTokens(token, adminToken) → ADMIN_CONTEXT
    if (safeCompareTokens(token, adminToken)) {
      return ADMIN_CONTEXT;
    }

    // 3. lookup = extractLookup(token); if null → anonymous
    const lookup = extractLookup(token);
    if (lookup === null) {
      return { kind: 'anonymous', accountId: null, accountName: null, apiKeyId: null, pinnedPoolId: null, defaultPoolId: null, scopes: [], rateLimitRpm: null, rateLimitTpm: null };
    }

    // 4. rec = apiKeyRepo.findByLookup(lookup); if null → anonymous
    const rec = this.apiKeyRepo.findByLookup(lookup);
    if (!rec) {
      return { kind: 'anonymous', accountId: null, accountName: null, apiKeyId: null, pinnedPoolId: null, defaultPoolId: null, scopes: [], rateLimitRpm: null, rateLimitTpm: null };
    }

    // 5. If !verifyApiKeyHash(token, rec.key_hash) → anonymous
    if (!verifyApiKeyHash(token, rec.key_hash)) {
      return { kind: 'anonymous', accountId: null, accountName: null, apiKeyId: null, pinnedPoolId: null, defaultPoolId: null, scopes: [], rateLimitRpm: null, rateLimitTpm: null };
    }

    // 6. If rec.status !== 'active' → throw AppError('API key has been revoked', 'KEY_REVOKED', 401)
    // Exception: status === 'rotated' && rec.expires_at !== null && Date.now() < rec.expires_at → allow
    if (rec.status !== 'active') {
      if (rec.status === 'rotated' && rec.expires_at !== null && Date.now() < rec.expires_at) {
        // allow
      } else {
        throw new AppError('API key has been revoked', 'KEY_REVOKED', 401);
      }
    }

    // 7. Fetch account
    const account = this.accountRepo.findById(rec.account_id);
    if (!account) {
      // Should not happen if FK constraints, but treat as anonymous
      return { kind: 'anonymous', accountId: null, accountName: null, apiKeyId: null, pinnedPoolId: null, defaultPoolId: null, scopes: [], rateLimitRpm: null, rateLimitTpm: null };
    }

    // 8. Return AuthContext
    return {
      kind: 'account',
      accountId: account.id,
      accountName: account.name,
      apiKeyId: rec.id,
      pinnedPoolId: rec.pool_id ?? null,
      defaultPoolId: account.default_pool_id ?? null,
      scopes: rec.scopes ? JSON.parse(rec.scopes) : [],
      rateLimitRpm: account.rate_limit_rpm ?? null,
      rateLimitTpm: account.rate_limit_tpm ?? null
    };
  }

  public touch(ctx: AuthContext): void {
    if (ctx.kind === 'account' && ctx.apiKeyId) {
      this.apiKeyRepo.touchUsage(ctx.apiKeyId, Date.now());
    }
    // no-op for admin
  }
}