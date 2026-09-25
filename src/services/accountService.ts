import { AccountRepository } from "../../src/infra/db/repositories/accountRepo.js";
import { ApiKeyRepository } from "../../src/infra/db/repositories/apiKeyRepo.js";
import { PoolRepository } from "../../src/infra/db/repositories/poolRepo.js";
import { GoalService } from "../../src/services/goalService.js";
import { generateApiKey, hashApiKey } from "../../src/infra/security/apiKeyCrypto.js";
import { AppError, NotFoundError } from "../../src/shared/errors.js";
import type { AccountRecord } from "../../src/infra/db/repositories/accountRepo.js";
import type { ApiKeyRecord } from "../../src/infra/db/repositories/apiKeyRepo.js";
import Database from "better-sqlite3";

export interface AccountDTO {
  id: string;
  name: string;
  description: string | null;
  status: "active" | "suspended" | "deleted";
  defaultPoolId: string | null;
  defaultGoalId: string | null;
  monthlyBudgetUsd: number | null;
  rateLimitRpm: number | null;
  rateLimitTpm: number | null;
  maxKeys: number;
  activeKeyCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface CreatedKeyDTO {
  id: string;
  accountId: string;
  name: string;
  plaintext: string;
  hint: string;
  scopes: string[];
  poolId: string | null;
  expiresAt: number | null;
  createdAt: number;
}

export interface ApiKeyDTO {
  id: string;
  accountId: string;
  name: string;
  hint: string;
  scopes: string[];
  poolId: string | null;
  status: string;
  rotatedFromId: string | null;
  rotatedToId: string | null;
  lastUsedAt: number | null;
  requestCount: number;
  expiresAt: number | null;
  createdAt: number;
  revokedAt: number | null;
}

function parseScopes(scopes: string): string[] {
  try {
    return JSON.parse(scopes);
  } catch {
    return ["chat"];
  }
}

function stringifyScopes(scopes: string[]): string {
  return JSON.stringify(scopes);
}

export class AccountService {
  constructor(
    private accountRepo: AccountRepository,
    private apiKeyRepo: ApiKeyRepository,
    private poolRepo: PoolRepository,
    private goalService: GoalService,
    private db: Database.Database
  ) {}

  public createAccount(input: {
    name: string;
    description?: string | null;
    status?: "active" | "suspended" | "deleted";
    defaultPoolId?: string | null;
    defaultGoalId?: string | null;
    monthlyBudgetUsd?: number | null;
    rateLimitRpm?: number | null;
    rateLimitTpm?: number | null;
    maxKeys?: number;
  }): AccountDTO {
    const name = input.name.trim();
    if (name.length < 1 || name.length > 64) {
      throw new AppError("Account name must be 1-64 characters", "ACCOUNT_NAME_INVALID", 400);
    }
    if (!/^[A-Za-z0-9 ._-]+$/.test(name)) {
      throw new AppError("Account name contains invalid characters", "ACCOUNT_NAME_INVALID", 400);
    }
    const existing = this.accountRepo.findByName(name);
    if (existing) {
      throw new AppError("Account name already taken", "ACCOUNT_NAME_TAKEN", 409);
    }
    const account = this.accountRepo.create({
      name,
      description: input.description ?? null,
      status: input.status ?? "active",
      default_pool_id: input.defaultPoolId ?? null,
      default_goal_id: input.defaultGoalId ?? null,
      monthly_budget_usd: input.monthlyBudgetUsd ?? null,
      rate_limit_rpm: input.rateLimitRpm ?? null,
      rate_limit_tpm: input.rateLimitTpm ?? null,
      max_keys: input.maxKeys ?? 20,
      metadata: "{}",
    });
    return this.toDTO(account);
  }

  public listAccounts(): AccountDTO[] {
    return this.accountRepo.listAll({ includeDeleted: false }).map(this.toDTO.bind(this));
  }

  public getAccount(id: string): AccountDTO {
    const account = this.accountRepo.findById(id);
    if (!account || account.status === "deleted") {
      throw new NotFoundError(`Account with ID "${id}" not found`);
    }
    return this.toDTO(account);
  }

  public updateAccount(id: string, patch: {
    description?: string | null;
    status?: "active" | "suspended" | "deleted";
    defaultPoolId?: string | null;
    defaultGoalId?: string | null;
    monthlyBudgetUsd?: number | null;
    rateLimitRpm?: number | null;
    rateLimitTpm?: number | null;
    maxKeys?: number;
  }): AccountDTO {
    this.getAccount(id);
    this.accountRepo.update(id, {
      description: patch.description ?? undefined,
      status: patch.status ?? undefined,
      default_pool_id: patch.defaultPoolId ?? undefined,
      default_goal_id: patch.defaultGoalId ?? undefined,
      monthly_budget_usd: patch.monthlyBudgetUsd ?? null,
      rate_limit_rpm: patch.rateLimitRpm ?? null,
      rate_limit_tpm: patch.rateLimitTpm ?? null,
      max_keys: patch.maxKeys ?? undefined,
      metadata: undefined,
    });
    const updated = this.accountRepo.findById(id);
    if (!updated) {
      throw new Error("Update failed");
    }
    return this.toDTO(updated);
  }

  public deleteAccount(id: string): void {
    this.db.transaction(() => {
      this.accountRepo.softDelete(id);
      const keys = this.apiKeyRepo.listByAccount(id, { includeRevoked: false });
      for (const key of keys) {
        this.apiKeyRepo.markRevoked(key.id);
      }
    })();
  }

  public createKey(accountId: string, input: {
    name: string;
    scopes?: string[];
    poolId?: string | null;
    expiresAt?: number | null;
  }): CreatedKeyDTO {
    const account = this.getAccount(accountId);
    const activeKeys = this.apiKeyRepo.listByAccount(accountId, { includeRevoked: false });
    if (activeKeys.length >= account.maxKeys) {
      throw new AppError("Key limit reached for account", "KEY_LIMIT_REACHED", 409);
    }
    const { plaintext, lookup, hint } = generateApiKey();
    const hashed = hashApiKey(plaintext);
    const key = this.apiKeyRepo.insert({
      account_id: accountId,
      name: input.name.trim(),
      key_lookup: lookup,
      key_hash: hashed,
      key_hint: hint,
      scopes: stringifyScopes(input.scopes ?? ["chat"]),
      pool_id: input.poolId ?? null,
      status: "active",
      rotated_from_id: null,
      rotated_to_id: null,
      last_used_at: null,
      request_count: 0,
      expires_at: input.expiresAt ?? null,
      revoked_at: null,
    });
    return {
      id: key.id,
      accountId: key.account_id,
      name: key.name,
      plaintext,
      hint: key.key_hint,
      scopes: parseScopes(key.scopes),
      poolId: key.pool_id,
      expiresAt: key.expires_at,
      createdAt: key.created_at,
    };
  }

  public listKeys(accountId: string, includeRevoked: boolean = false): ApiKeyDTO[] {
    this.getAccount(accountId);
    return this.apiKeyRepo.listByAccount(accountId, { includeRevoked }).map(this.toKeyDTO.bind(this));
  }

  public rotateKey(keyId: string, input: { graceSeconds?: number } = {}): CreatedKeyDTO {
    const key = this.apiKeyRepo.findById(keyId);
    if (!key) {
      throw new NotFoundError(`Key with ID "${keyId}" not found`);
    }
    if (key.status !== "active") {
      throw new AppError("Only active keys can be rotated", "KEY_NOT_ACTIVE", 400);
    }
    const account = this.getAccount(key.account_id);
    const { plaintext, lookup, hint } = generateApiKey();
    const hashed = hashApiKey(plaintext);
    const newKey = this.apiKeyRepo.insert({
      account_id: key.account_id,
      name: key.name,
      key_lookup: lookup,
      key_hash: hashed,
      key_hint: hint,
      scopes: key.scopes,
      pool_id: key.pool_id,
      status: "active",
      rotated_from_id: key.id,
      rotated_to_id: null,
      last_used_at: null,
      request_count: 0,
      expires_at: key.expires_at,
      revoked_at: null,
    });
    const graceSeconds = input.graceSeconds ?? 0;
    if (graceSeconds > 0) {
      // Graceful rotation: set old key to rotated with future expires_at, do not revoke
      const graceExpiry = Date.now() + graceSeconds * 1000;
      this.db.transaction(() => {
        this.db.prepare("UPDATE api_keys SET status = 'rotated', rotated_to_id = ?, expires_at = ?, revoked_at = NULL WHERE id = ?")
          .run(newKey.id, graceExpiry, keyId);
        this.db.prepare("UPDATE api_keys SET rotated_from_id = ? WHERE id = ?")
          .run(keyId, newKey.id);
      })();
    } else {
      // Immediate rotation: use markRotated which revokes old key
      this.apiKeyRepo.markRotated(keyId, newKey.id);
    }
    return {
      id: newKey.id,
      accountId: newKey.account_id,
      name: newKey.name,
      plaintext,
      hint: newKey.key_hint,
      scopes: parseScopes(newKey.scopes),
      poolId: newKey.pool_id,
      expiresAt: newKey.expires_at,
      createdAt: newKey.created_at,
    };
  }

  public revokeKey(keyId: string): void {
    const key = this.apiKeyRepo.findById(keyId);
    if (!key) return;
    this.apiKeyRepo.markRevoked(key.id);
  }

  private toDTO(account: AccountRecord): AccountDTO {
    const activeKeys = this.apiKeyRepo.listByAccount(account.id, { includeRevoked: false });
    return {
      id: account.id,
      name: account.name,
      description: account.description,
      status: account.status,
      defaultPoolId: account.default_pool_id,
      defaultGoalId: account.default_goal_id,
      monthlyBudgetUsd: account.monthly_budget_usd,
      rateLimitRpm: account.rate_limit_rpm,
      rateLimitTpm: account.rate_limit_tpm,
      maxKeys: account.max_keys,
      activeKeyCount: activeKeys.length,
      createdAt: account.created_at,
      updatedAt: account.updated_at,
    };
  }

  private toKeyDTO(key: ApiKeyRecord): ApiKeyDTO {
    return {
      id: key.id,
      accountId: key.account_id,
      name: key.name,
      hint: key.key_hint,
      scopes: parseScopes(key.scopes),
      poolId: key.pool_id,
      status: key.status,
      rotatedFromId: key.rotated_from_id,
      rotatedToId: key.rotated_to_id,
      lastUsedAt: key.last_used_at,
      requestCount: key.request_count,
      expiresAt: key.expires_at,
      createdAt: key.created_at,
      revokedAt: key.revoked_at,
    };
  }
}
