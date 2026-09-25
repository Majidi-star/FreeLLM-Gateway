import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AccountRepository } from "../../src/infra/db/repositories/accountRepo.js";
import { ApiKeyRepository } from "../../src/infra/db/repositories/apiKeyRepo.js";
import { PoolRepository } from "../../src/infra/db/repositories/poolRepo.js";
import { GoalService } from "../../src/services/goalService.js";
import { GoalRepository } from "../../src/infra/db/repositories/goalRepo.js";
import { ConnectionRepository } from "../../src/infra/db/repositories/connectionRepo.js";
import { ProviderRepository } from "../../src/infra/db/repositories/providerRepo.js";
import { ModelRepository } from "../../src/infra/db/repositories/modelRepo.js";
import { HealthRepository } from "../../src/infra/db/repositories/healthRepo.js";
import { QuotaRepository } from "../../src/infra/db/repositories/quotaRepo.js";
import { AccountService } from "../../src/services/accountService.js";
import { AuthService } from "../../src/services/authService.js";
import { AppError } from "../../src/shared/errors.js";
import { getDatabase } from "../../src/infra/db/client.js";

const db = getDatabase();

function truncateTables() {
  db.transaction(() => {
    db.prepare("DELETE FROM accounts").run();
    db.prepare("DELETE FROM api_keys").run();
    db.prepare("DELETE FROM pools").run();
    db.prepare("DELETE FROM goals").run();
    db.prepare("DELETE FROM request_logs").run();
    db.prepare("DELETE FROM usage_rollups").run();
  })();
}

describe("AccountService", () => {
  let accountRepo: AccountRepository;
  let apiKeyRepo: ApiKeyRepository;
  let poolRepo: PoolRepository;
  let goalRepo: GoalRepository;
  let connectionRepo: ConnectionRepository;
  let providerRepo: ProviderRepository;
  let modelRepo: ModelRepository;
  let healthRepo: HealthRepository;
  let quotaRepo: QuotaRepository;
  let goalService: GoalService;
  let accountService: AccountService;
  let authService: AuthService;

  beforeEach(() => {
    truncateTables();
    accountRepo = new AccountRepository(db);
    apiKeyRepo = new ApiKeyRepository(db);
    poolRepo = new PoolRepository(db);
    goalRepo = new GoalRepository(db);
    connectionRepo = new ConnectionRepository(db);
    providerRepo = new ProviderRepository(db);
    modelRepo = new ModelRepository(db);
    healthRepo = new HealthRepository(db);
    quotaRepo = new QuotaRepository(db);
    goalService = new GoalService(goalRepo, connectionRepo, providerRepo, modelRepo, healthRepo, quotaRepo);
    accountService = new AccountService(accountRepo, apiKeyRepo, poolRepo, goalService, db);
        authService = new AuthService(accountRepo, apiKeyRepo);
  });

  afterEach(() => {
    truncateTables();
  });

  it("createAccount -> listAccounts shows activeKeyCount: 0", () => {
    const account = accountService.createAccount({ name: "Test Account" });
    expect(account.name).toBe("Test Account");
    expect(account.activeKeyCount).toBe(0);

    const accounts = accountService.listAccounts();
    expect(accounts.length).toBe(1);
    expect(accounts[0].activeKeyCount).toBe(0);
  });

  it("createKey returns plaintext matching /^gr_live_[A-Za-z0-9_-]{20,}$/; listKeys contains no plaintext property", () => {
    const account = accountService.createAccount({ name: "Test Account", maxKeys: 5 });
    const key = accountService.createKey(account.id, { name: "Test Key" });

    expect(key.plaintext).toMatch(/^gr_live_[A-Za-z0-9_-]{20,}$/);

    const keys = accountService.listKeys(account.id);
    expect(keys.length).toBe(1);
    expect(keys[0]).not.toHaveProperty("plaintext");
    expect(keys[0].hint).toBeDefined();
    expect(keys[0].scopes).toEqual(["chat"]);
  });

  it("rotateKey: old key status === rotated with rotatedToId; new key status === active with rotatedFromId; plaintexts differ", () => {
    const account = accountService.createAccount({ name: "Test Account" });
    const key = accountService.createKey(account.id, { name: "Test Key" });
    const originalPlaintext = key.plaintext;

    const rotated = accountService.rotateKey(key.id);
    expect(rotated.plaintext).not.toBe(originalPlaintext);
    expect(rotated.plaintext).toMatch(/^gr_live_[A-Za-z0-9_-]{20,}$/);

    const keys = accountService.listKeys(account.id, true);
    const oldKey = keys.find(k => k.id === key.id);
    const newKey = keys.find(k => k.id === rotated.id);

    expect(oldKey).toBeDefined();
    expect(oldKey!.status).toBe("rotated");
    expect(oldKey!.rotatedToId).toBe(rotated.id);
    expect(oldKey!.rotatedFromId).toBeNull();

    expect(newKey).toBeDefined();
    expect(newKey!.status).toBe("active");
    expect(newKey!.rotatedFromId).toBe(key.id);
    expect(newKey!.rotatedToId).toBeNull();
  });

  it("rotateKey with graceSeconds: 60 leaves old key resolvable in AuthService for 60s", () => {
    const account = accountService.createAccount({ name: "Test Account" });
    const key = accountService.createKey(account.id, { name: "Test Key" });
    const plaintext = key.plaintext;

    accountService.rotateKey(key.id, { graceSeconds: 60 });

    // The old key should still be resolvable via AuthService (status is rotated but not revoked, expires_at in future)
    const authResult = authService.resolveBearer(plaintext, "admin-token");
    expect(authResult).toBeDefined();
    expect(authResult.kind).toBe("account");
    expect(authResult.accountId).toBe(account.id);
    expect(authResult.apiKeyId).toBe(key.id);
  });

  it("exceeding maxKeys throws KEY_LIMIT_REACHED (409)", () => {
    const account = accountService.createAccount({ name: "Test Account", maxKeys: 2 });
    
    accountService.createKey(account.id, { name: "Key 1" });
    accountService.createKey(account.id, { name: "Key 2" });

    expect(() => {
      accountService.createKey(account.id, { name: "Key 3" });
    }).toThrow(AppError);
    
    try {
      accountService.createKey(account.id, { name: "Key 3" });
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      if (e instanceof AppError) {
        expect(e.code).toBe("KEY_LIMIT_REACHED");
        expect(e.statusCode).toBe(409);
      }
    }
  });

  it("deleteAccount soft-deletes and revokes all keys; subsequent resolveBearer throws", () => {
    const account = accountService.createAccount({ name: "Test Account" });
    const key = accountService.createKey(account.id, { name: "Test Key" });
    const plaintext = key.plaintext;

    accountService.deleteAccount(account.id);

    // Account should be soft-deleted (not in listAccounts)
    const accounts = accountService.listAccounts();
    expect(accounts.length).toBe(0);

    // Key should be revoked (check via repo directly since account is deleted)
    const keys = apiKeyRepo.listByAccount(account.id, { includeRevoked: true });
    expect(keys.length).toBe(1);
    expect(keys[0].status).toBe("revoked");

    // resolveBearer should throw for revoked key
    expect(() => {
      authService.resolveBearer(plaintext, "admin-token");
    }).toThrow(AppError);
  });
});
