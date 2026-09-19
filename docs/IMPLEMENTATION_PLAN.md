# GoalRoute / FreeLLM-Gateway — Multi-Tenant Accounts, API Keys & Usage Analytics
## Implementation Plan (v1.0) — Authoritative Spec for Coding Agents

> **READ THIS FIRST.** This document is the single source of truth. You execute **one phase per task**.
> You do not redesign. You do not explore beyond the file lists given. You do not add dependencies.
> If this document and your instinct disagree, **this document wins**. If this document is genuinely
> ambiguous, pick the simplest option that satisfies the Definition of Done and write one line about
> it in `docs/DEVIATIONS.md`. Do not ask and stop.

---

## 0. Ground Truth — What Already Exists

Do **not** re-derive this. It is accurate as of the current working tree.

### 0.1 Stack
- Node >= 22, TypeScript ESM (`"type": "module"`, `moduleResolution: NodeNext`) — **all relative imports must end in `.js`**.
- Fastify 5, `better-sqlite3` 11 (synchronous), Zod 3, Pino 9, React 19 + Vite 6 + Tailwind 3, Vitest 3.
- `tsconfig.json` has `rootDir: src`, `strict: true`, and **excludes `tests/`**. `npx tsc --noEmit` therefore does not typecheck tests.

### 0.2 Directory map (only what matters)
```
src/
  api/server.ts                     # 786 lines. ALL routes. Auth hooks. Multi-port app factory.
  infra/
    config.ts                       # Zod env schema + getConfig() singleton + resetConfigForTest()
    logger.ts                       # pino + redactSensitiveData()
    db/client.ts                    # getDatabase() singleton
    db/migrationRunner.ts           # runs src/infra/db/migrations/*.sql in filename order
    db/migrations/0001..0004.sql
    db/repositories/{provider,connection,model,goal,pool,health,quota,requestLog}Repo.ts
    security/vault.ts               # AES-256-GCM encrypt/decryptCredential
    http/providerClient.ts          # callProviderEndpoint / callProviderEndpointStream
  services/
    gatewayService.ts               # 1027 lines. dispatch() + dispatchStream(). EventEmitter 'log'.
    providerService.ts  poolService.ts  goalService.ts  mcpService.ts
    multiPortServerService.ts       # starts/stops the 4 protocol listeners
  domain/
    routing/policies/*.ts  goal/solver.ts  quota/slidingWindow.ts
    resilience/circuitBreaker.ts    translation/*
  shared/{ids.ts,types.ts,errors.ts}
  web/components/{cockpit,vault,database,settings,bridge,chat,layout,...}
tests/                              # vitest, mirrors nothing — flat unit/integration/chaos dirs
```

### 0.3 Existing schema (migrations 0001–0004)
`providers`, `provider_connections`, `models`, `quota_policies`, `quota_usage`, `health_state`,
`goals`, `pools`, `pool_steps`, `request_logs`.

`request_logs` today: `id, pool_id, connection_id, model_id, status, latency_ms, tokens_in,
tokens_out, cost_usd, error_code, decision_trace, created_at`.

### 0.4 Existing auth (the thing you are replacing)
- `src/api/server.ts` → `safeCompareTokens(provided, expected)` — sha256 both sides then `timingSafeEqual`.
- Global `onRequest` hook: every `/api/v1/*` and `/mcp/*` requires `Authorization: Bearer <ADMIN_API_TOKEN>`.
- `buildProtocolAuthHook(config)`: used by the openai/anthropic/mcp/native sub-apps, also only checks `ADMIN_API_TOKEN`.
- Result: **one shared god-token for admin AND traffic.** There is no tenant concept anywhere.

### 0.5 Confirmed gaps you are closing
| # | Gap | Where |
|---|---|---|
| G1 | No `accounts` entity | schema, services, API, UI |
| G2 | No `api_keys`; no rotation; no one-time reveal | schema, services, API, UI |
| G3 | Gateway traffic is not attributable to a tenant | `server.ts`, `gatewayService.ts` |
| G4 | `cost_usd` is literally hardcoded `0` at 3 call sites in `gatewayService.ts` | `gatewayService.ts` |
| G5 | No usage aggregation — stats would require full table scans of `request_logs`, which are purged after 30 days | new `usage_rollups` |
| G6 | `request_logs` lacks: account, key, provider slug, model name, protocol, stream flag, TTFT, attempt count, fallback flag, finish reason | migration + repo |
| G7 | `GET /api/v1/request-logs` has no filtering, no pagination, no single-record fetch for the decision trace | `server.ts` |
| G8 | Goals/pools are global, not per-account | migration + services |
| G9 | No per-account / per-key rate limiting or budget enforcement | new middleware |
| G10 | No endpoint-discovery surface (what URL do I point my client at?) | new route + UI |

---

## 1. Target Architecture (the "after" picture)

```
                         ┌──────────────────────────────────────────┐
   client (Cline, SDK)   │  :8788 /v1/chat/completions   (OpenAI)   │
   Authorization:        │  :8789 /v1/messages           (Anthropic)│
   Bearer gr_live_xxxx ─▶│  :8790 /mcp                   (MCP)      │
                         │  :8787 /v1/chat/completions   (Native)   │
                         └───────────────┬──────────────────────────┘
                                         │ authenticateRequest()
                                         ▼
                              ┌─────────────────────┐
                              │   AuthContext       │  { kind:'account'|'admin',
                              │                     │    accountId, apiKeyId,
                              │                     │    pinnedPoolId, scopes }
                              └──────────┬──────────┘
                                         │ resolvePoolForAuth()  ← account-scoped
                                         ▼
                              ┌─────────────────────┐
                              │  GatewayService     │  existing routing, breakers,
                              │  .dispatch()        │  quotas, policies (UNCHANGED logic)
                              └──────────┬──────────┘
                                         │ RequestOutcome (enriched)
                          ┌──────────────┴───────────────┐
                          ▼                              ▼
                 request_logs (raw, 30d)          usage_rollups (hour+day, forever)
                 + full decision_trace            incremental UPSERT, same txn
                          │                              │
                          ▼                              ▼
              GET /api/v1/request-logs         GET /api/v1/stats/*
              (keyset paginated, filtered)     (O(1) — never scans request_logs)
```

### 1.1 Non-negotiable design decisions
1. **API keys are stored as HMAC-SHA256, never plaintext, never reversibly encrypted.** The plaintext is returned exactly once, in the HTTP response of the create/rotate call, and never persisted.
2. **Rollups are written synchronously in the same `better-sqlite3` transaction as the request log.** No background job, no queue. `better-sqlite3` is sync and fast; an UPSERT on a `WITHOUT ROWID` PK table is sub-100µs. This is what makes stats survive log purging.
3. **`request_logs` denormalizes `provider_slug` and `model_name`.** Providers/models can be deactivated or re-synced from the catalog; historical logs must not lose their labels.
4. **Admin API (`/api/v1/*`) stays on `ADMIN_API_TOKEN`.** Account API keys are for *traffic only* (`/v1/*`, `/mcp/*`). Do not let an account key call admin routes.
5. **Zero new npm dependencies.** Charts are hand-rolled SVG — see `src/web/components/database/BenchmarkMatrixChart.tsx` for the existing house pattern. Do not install recharts/chart.js/d3/argon2/bcrypt.
6. **Backward compatibility:** a request bearing the `ADMIN_API_TOKEN` on a traffic port still works and is logged with `account_id = NULL, api_key_id = NULL`. Existing tests must keep passing.

---

## 2. Execution Rules for the Coding Agent

### 2.1 The loop (per phase)
```
1. Open THIS file. Read ONLY the phase you were assigned.
2. Read ONLY the files listed in that phase's "Files to read" (use bounded ranges where given).
3. Make the edits listed in "Files to write". Nothing else.
4. Run the phase's "Verify" command. Fix real failures.
5. Append one line to docs/PROGRESS.md: `Phase N — DONE — <one sentence>`.
6. Stop. Report: files changed, verify result, anything deviating.
```

### 2.2 Hard prohibitions
- ❌ `git commit`, `git push`, `git checkout -b`, `git reset`, `git stash`, `git rebase`, `git clean`. **Never.** The developer does all git.
- ❌ `npm install <anything>`. Zero new dependencies. If you think you need one, you don't — write it by hand.
- ❌ `grep -r` / `find .` across the repo, or reading any file over 200 lines in full. Use `sed -n 'A,Bp' file`.
- ❌ Reformatting, re-indenting, or "cleaning up" code you were not told to change.
- ❌ `try { ... } catch { return [] }` to make an error disappear. Fix the cause or throw a typed `AppError`.
- ❌ Deleting or weakening an existing test to make the suite green. If an existing test genuinely encodes old behaviour you were told to change, update that one assertion and say so in your report.
- ❌ Starting the next phase because you "have context". One phase, then stop.
- ❌ Writing a summary document, a README of your changes, or an audit report. `docs/PROGRESS.md` gets one line.

### 2.3 Mandatory conventions
- Relative imports **must** carry the `.js` extension (`import { x } from '../foo.js'`) — NodeNext ESM.
- Every new API request body/query is validated with a **Zod** schema. Reject with `AppError(msg, 'VALIDATION_ERROR', 400)`.
- Every multi-statement DB mutation goes inside `db.transaction(() => { ... })()`.
- IDs come from `generateId(prefix)` in `src/shared/ids.ts`.
- Errors come from `src/shared/errors.ts` (`AppError`, `NotFoundError`). Add new ones there if needed, do not invent local error classes.
- New SQL migrations are **append-only**. Never edit `0001`–`0004`. Never edit a migration you created in an earlier phase once its phase is closed.
- SQLite `ALTER TABLE ADD COLUMN` must be a plain nullable column with **no** `REFERENCES` clause and **no** non-null default — SQLite rejects those. Add the index separately.
- React components: functional, hooks, Tailwind utility classes only, consistent with `src/web/components/cockpit/CockpitDashboard.tsx`.

### 2.4 Verify command
Add this once in Phase 0 and use it everywhere after:
```bash
npm run verify
```
which is `npx tsc --noEmit && npm run build && npm test`. Pipe noise: `npm run verify 2>&1 | tail -n 40`.

---

# PHASE 0 — Baseline & Guardrails

**Objective.** Establish a green baseline and the `verify` script. No feature work.

**Files to read:** `package.json`, `.env.example`.

**Files to write:**
1. `package.json` — add to `scripts`:
   ```json
   "typecheck": "tsc --noEmit",
   "verify": "npm run typecheck && npm run build && npm test"
   ```
2. `docs/PROGRESS.md` — create with a single `# Progress` heading.
3. `docs/DEVIATIONS.md` — create with a single `# Deviations` heading.

**Verify:** `npm ci && npm run verify 2>&1 | tail -n 40`

**Definition of Done:** `npm run verify` exits 0 on the untouched codebase. If it does **not**, record the exact failing test names in `docs/PROGRESS.md` under `## Pre-existing failures` and proceed — do not fix unrelated pre-existing failures, but you must not *add* any.

---

# PHASE 1 — Schema: Accounts, API Keys, Telemetry Columns, Rollups

**Objective.** Three new migration files. No TypeScript changes at all in this phase.

**Files to read:** `src/infra/db/migrationRunner.ts` (all, it is short), `src/infra/db/migrations/0001_init.sql` (lines 1–60 for style).

**Files to write:**

### 1A. `src/infra/db/migrations/0005_accounts_and_keys.sql`
```sql
-- 0005: Multi-tenant accounts and hashed API keys.

CREATE TABLE IF NOT EXISTS accounts (
    id                      TEXT PRIMARY KEY,
    name                    TEXT NOT NULL UNIQUE,
    description             TEXT,
    status                  TEXT NOT NULL DEFAULT 'active'
                                CHECK (status IN ('active','suspended','deleted')),
    default_pool_id         TEXT REFERENCES pools(id),
    default_goal_id         TEXT REFERENCES goals(id),
    monthly_budget_usd      REAL,
    rate_limit_rpm          INTEGER,
    rate_limit_tpm          INTEGER,
    max_keys                INTEGER NOT NULL DEFAULT 20,
    metadata                TEXT NOT NULL DEFAULT '{}',
    created_at              INTEGER NOT NULL,
    updated_at              INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS api_keys (
    id                      TEXT PRIMARY KEY,
    account_id              TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name                    TEXT NOT NULL,
    key_lookup              TEXT NOT NULL,   -- first 16 chars of the plaintext key; O(1) index probe
    key_hash                TEXT NOT NULL,   -- hex HMAC-SHA256(plaintext, pepper)
    key_hint                TEXT NOT NULL,   -- display only, e.g. 'gr_live_ab12...9xQz'
    scopes                  TEXT NOT NULL DEFAULT '["chat"]',
    pool_id                 TEXT REFERENCES pools(id),   -- optional hard pin
    status                  TEXT NOT NULL DEFAULT 'active'
                                CHECK (status IN ('active','revoked','rotated')),
    rotated_from_id         TEXT,
    rotated_to_id           TEXT,
    last_used_at            INTEGER,
    request_count           INTEGER NOT NULL DEFAULT 0,
    expires_at              INTEGER,
    created_at              INTEGER NOT NULL,
    revoked_at              INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_api_keys_lookup ON api_keys(key_lookup);
CREATE INDEX IF NOT EXISTS idx_api_keys_account_status ON api_keys(account_id, status);
CREATE INDEX IF NOT EXISTS idx_accounts_status ON accounts(status);
```

> **Why `key_lookup` + `key_hash` and not just a hash?** A single indexed equality probe on `key_lookup`
> finds the candidate row in O(log n); the `key_hash` is then compared in constant time. Hashing the
> whole key and indexing *that* would also work, but `key_lookup` keeps the door open for a pepper
> rotation without a full re-index, and it is what makes the `key_hint` display correct.
> **Do not "simplify" this away.**

### 1B. `src/infra/db/migrations/0006_telemetry_columns.sql`
```sql
-- 0006: Account scoping + rich per-request telemetry.
-- NOTE: SQLite ADD COLUMN cannot carry REFERENCES or a non-null default. Plain nullable only.

ALTER TABLE goals  ADD COLUMN account_id TEXT;
ALTER TABLE pools  ADD COLUMN account_id TEXT;

ALTER TABLE request_logs ADD COLUMN account_id      TEXT;
ALTER TABLE request_logs ADD COLUMN api_key_id      TEXT;
ALTER TABLE request_logs ADD COLUMN provider_slug   TEXT;
ALTER TABLE request_logs ADD COLUMN model_name      TEXT;
ALTER TABLE request_logs ADD COLUMN route_protocol  TEXT;
ALTER TABLE request_logs ADD COLUMN is_stream       INTEGER;
ALTER TABLE request_logs ADD COLUMN ttft_ms         INTEGER;
ALTER TABLE request_logs ADD COLUMN attempt_count   INTEGER;
ALTER TABLE request_logs ADD COLUMN fallback_used   INTEGER;
ALTER TABLE request_logs ADD COLUMN cached_tokens   INTEGER;
ALTER TABLE request_logs ADD COLUMN reasoning_tokens INTEGER;
ALTER TABLE request_logs ADD COLUMN finish_reason   TEXT;
ALTER TABLE request_logs ADD COLUMN client_name     TEXT;
ALTER TABLE request_logs ADD COLUMN trace_id        TEXT;

CREATE INDEX IF NOT EXISTS idx_goals_account   ON goals(account_id);
CREATE INDEX IF NOT EXISTS idx_pools_account   ON pools(account_id);
CREATE INDEX IF NOT EXISTS idx_logs_account_created ON request_logs(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_logs_key_created     ON request_logs(api_key_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_logs_model_created   ON request_logs(model_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_logs_status_created  ON request_logs(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_logs_trace           ON request_logs(trace_id);
```

### 1C. `src/infra/db/migrations/0007_usage_rollups.sql`
```sql
-- 0007: Pre-aggregated usage. Survives request_logs retention purges.

CREATE TABLE IF NOT EXISTS usage_rollups (
    bucket_start        INTEGER NOT NULL,  -- epoch ms, floored to the granularity
    granularity         TEXT    NOT NULL CHECK (granularity IN ('hour','day')),
    account_id          TEXT    NOT NULL DEFAULT '',   -- '' == unattributed/admin traffic
    api_key_id          TEXT    NOT NULL DEFAULT '',
    pool_id             TEXT    NOT NULL DEFAULT '',
    provider_slug       TEXT    NOT NULL DEFAULT '',
    model_name          TEXT    NOT NULL DEFAULT '',
    requests            INTEGER NOT NULL DEFAULT 0,
    requests_success    INTEGER NOT NULL DEFAULT 0,
    requests_failed     INTEGER NOT NULL DEFAULT 0,
    requests_timeout    INTEGER NOT NULL DEFAULT 0,
    tokens_in           INTEGER NOT NULL DEFAULT 0,
    tokens_out          INTEGER NOT NULL DEFAULT 0,
    tokens_cached       INTEGER NOT NULL DEFAULT 0,
    tokens_reasoning    INTEGER NOT NULL DEFAULT 0,
    cost_usd            REAL    NOT NULL DEFAULT 0,
    latency_sum_ms      INTEGER NOT NULL DEFAULT 0,
    latency_max_ms      INTEGER NOT NULL DEFAULT 0,
    ttft_sum_ms         INTEGER NOT NULL DEFAULT 0,
    ttft_count          INTEGER NOT NULL DEFAULT 0,
    fallback_count      INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (bucket_start, granularity, account_id, api_key_id, pool_id, provider_slug, model_name)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_rollups_acct_gran_bucket
    ON usage_rollups(account_id, granularity, bucket_start);
CREATE INDEX IF NOT EXISTS idx_rollups_gran_bucket
    ON usage_rollups(granularity, bucket_start);

-- Per-account / per-key sliding-window counters for rate limiting.
CREATE TABLE IF NOT EXISTS tenant_rate_usage (
    scope_id        TEXT    NOT NULL,   -- 'account:<id>' | 'key:<id>'
    dimension       TEXT    NOT NULL,   -- 'requests' | 'tokens'
    window_start    INTEGER NOT NULL,   -- epoch ms, floored to 60_000
    used_value      REAL    NOT NULL DEFAULT 0,
    PRIMARY KEY (scope_id, dimension, window_start)
) WITHOUT ROWID;
```

**Verify:**
```bash
npx tsc --noEmit && npx tsx scripts/check_db.ts 2>&1 | tail -n 20
```
(If `scripts/check_db.ts` does not do what you need, run a throwaway node script that calls
`getDatabase()` + `runMigrations(db)` then `SELECT name FROM sqlite_master WHERE type='table'`.
Delete the throwaway afterwards.)

**Definition of Done:** Fresh DB migrates cleanly; an *existing* DB with 0001–0004 already applied also migrates cleanly (re-run the migration twice to prove idempotency). Tables `accounts`, `api_keys`, `usage_rollups`, `tenant_rate_usage` exist. `npm run verify` still green.

---

# PHASE 2 — Repositories

**Objective.** Pure data-access layer. No HTTP, no business rules.

**Files to read:** `src/infra/db/repositories/poolRepo.ts` (full — it is the style template), `src/infra/db/repositories/requestLogRepo.ts` (full), `src/shared/ids.ts`.

**Files to write:**

### 2A. `src/infra/db/repositories/accountRepo.ts`
```ts
export interface AccountRecord {
  id: string; name: string; description: string | null;
  status: 'active' | 'suspended' | 'deleted';
  default_pool_id: string | null; default_goal_id: string | null;
  monthly_budget_usd: number | null;
  rate_limit_rpm: number | null; rate_limit_tpm: number | null;
  max_keys: number; metadata: string;
  created_at: number; updated_at: number;
}
```
Class `AccountRepository` with: `create(input)`, `findById(id)`, `findByName(name)`,
`listAll(opts?: { includeDeleted?: boolean })`, `update(id, patch: Partial<...>)` (build the SET
clause only from keys actually present in `patch`; always bump `updated_at`),
`softDelete(id)` (status → `'deleted'`), `countActive()`.

### 2B. `src/infra/db/repositories/apiKeyRepo.ts`
```ts
export interface ApiKeyRecord {
  id: string; account_id: string; name: string;
  key_lookup: string; key_hash: string; key_hint: string;
  scopes: string; pool_id: string | null;
  status: 'active' | 'revoked' | 'rotated';
  rotated_from_id: string | null; rotated_to_id: string | null;
  last_used_at: number | null; request_count: number;
  expires_at: number | null; created_at: number; revoked_at: number | null;
}
```
Class `ApiKeyRepository` with: `insert(rec)`, `findByLookup(lookup)` (single indexed SELECT),
`findById(id)`, `listByAccount(accountId, opts?: { includeRevoked?: boolean })`,
`countActiveForAccount(accountId)`, `markRevoked(id)`,
`markRotated(oldId, newId)` (**inside a transaction**: set old `status='rotated'`,
`rotated_to_id=newId`, `revoked_at` if no grace, and set new `rotated_from_id=oldId`),
`touchUsage(id, at)` — `UPDATE api_keys SET last_used_at=?, request_count=request_count+1 WHERE id=?`.

> `touchUsage` runs on every authenticated request. Keep it to that single UPDATE. Do not read back.

### 2C. `src/infra/db/repositories/usageRepo.ts`
```ts
export interface UsageFact {
  at: number;                 // epoch ms of the request
  accountId: string | null; apiKeyId: string | null; poolId: string | null;
  providerSlug: string | null; modelName: string | null;
  status: 'success' | 'failed' | 'timeout';
  tokensIn: number; tokensOut: number;
  tokensCached: number; tokensReasoning: number;
  costUsd: number; latencyMs: number; ttftMs: number | null;
  fallbackUsed: boolean;
}
export interface RollupRow { /* mirrors the usage_rollups columns */ }
export interface UsageQuery {
  accountId?: string; apiKeyId?: string; poolId?: string;
  providerSlug?: string; modelName?: string;
  from: number; to: number; granularity: 'hour' | 'day';
  groupBy: Array<'provider_slug' | 'model_name' | 'api_key_id' | 'pool_id' | 'account_id' | 'bucket_start'>;
}
```
Class `UsageRepository` with:
- `static floorBucket(at: number, g: 'hour'|'day'): number` — `hour` → `Math.floor(at/3_600_000)*3_600_000`; `day` → **UTC midnight**, `Math.floor(at/86_400_000)*86_400_000`. Document that days are UTC.
- `record(fact: UsageFact): void` — performs **two** UPSERTs (one `hour`, one `day`) using:
  ```sql
  INSERT INTO usage_rollups (bucket_start, granularity, account_id, api_key_id, pool_id,
      provider_slug, model_name, requests, requests_success, requests_failed, requests_timeout,
      tokens_in, tokens_out, tokens_cached, tokens_reasoning, cost_usd,
      latency_sum_ms, latency_max_ms, ttft_sum_ms, ttft_count, fallback_count)
  VALUES (?,?,?,?,?,?,?, 1,?,?,?, ?,?,?,?,?, ?,?,?,?,?)
  ON CONFLICT(bucket_start, granularity, account_id, api_key_id, pool_id, provider_slug, model_name)
  DO UPDATE SET
      requests         = requests + 1,
      requests_success = requests_success + excluded.requests_success,
      requests_failed  = requests_failed  + excluded.requests_failed,
      requests_timeout = requests_timeout + excluded.requests_timeout,
      tokens_in        = tokens_in        + excluded.tokens_in,
      tokens_out       = tokens_out       + excluded.tokens_out,
      tokens_cached    = tokens_cached    + excluded.tokens_cached,
      tokens_reasoning = tokens_reasoning + excluded.tokens_reasoning,
      cost_usd         = cost_usd         + excluded.cost_usd,
      latency_sum_ms   = latency_sum_ms   + excluded.latency_sum_ms,
      latency_max_ms   = MAX(latency_max_ms, excluded.latency_max_ms),
      ttft_sum_ms      = ttft_sum_ms      + excluded.ttft_sum_ms,
      ttft_count       = ttft_count       + excluded.ttft_count,
      fallback_count   = fallback_count   + excluded.fallback_count
  ```
  NULL identity columns are written as `''` (empty string), never NULL — the PK requires NOT NULL.
  **Prepare both statements once in the constructor**, not per call.
- `query(q: UsageQuery): RollupRow[]` — builds `SELECT <groupBy cols>, SUM(...)... FROM usage_rollups WHERE granularity=? AND bucket_start >= ? AND bucket_start < ? [+ filters] GROUP BY <groupBy cols> ORDER BY bucket_start ASC`. **Whitelist `groupBy` values against a hardcoded `Set`** before interpolating them into SQL. Everything else is a bound parameter.
- `purgeOlderThan(cutoffMs, granularity)` — used only for `hour` rollups (see Phase 10). Never purge `day`.

### 2D. Extend `src/infra/db/repositories/requestLogRepo.ts`
- Widen `RequestLogRecord` with all Phase-1B columns.
- Update `log()` to insert them (keep the existing `redactSensitiveData(decision_trace)` call — do not remove it).
- Replace `query()` with:
  ```ts
  query(opts: {
    accountId?: string; apiKeyId?: string; poolId?: string; providerSlug?: string;
    modelName?: string; status?: string; from?: number; to?: number;
    cursor?: string;            // opaque: `${created_at}:${id}`
    limit?: number;             // clamp 1..500, default 50
  }): { rows: RequestLogRecord[]; nextCursor: string | null }
  ```
  Keyset pagination: `WHERE (created_at, id) < (?, ?)` emulated as
  `AND (created_at < ? OR (created_at = ? AND id < ?))`, `ORDER BY created_at DESC, id DESC LIMIT ?+1`.
  Fetch `limit+1`, if you got `limit+1` rows pop the last and emit `nextCursor`. **Do not use OFFSET.**
- Add `findById(id): RequestLogRecord | null`.

**Files to write (tests):** `tests/unit/accountsKeysRepo.test.ts`
- create account → findByName returns it; duplicate name throws.
- insert key → findByLookup hits; markRevoked flips status; markRotated links both directions.
- `UsageRepository.record` twice with the same identity+hour ⇒ one row, `requests = 2`, sums added, `latency_max_ms` is the max.
- `record` with a `null` accountId ⇒ row stored with `account_id = ''` and is retrievable.
- `requestLogRepo.query` with 5 rows and `limit: 2` walks the full set in 3 pages with no duplicates and no gaps.

**Verify:** `npm run verify 2>&1 | tail -n 40`

**Definition of Done:** All five test cases pass. No route or service file was touched.

---

# PHASE 3 — Key Cryptography & AuthService

**Objective.** Generate, hash, and verify API keys. Resolve a bearer token to an `AuthContext`.

**Files to read:** `src/infra/security/vault.ts` (full), `src/infra/config.ts` (full), `src/api/server.ts` lines 39–45 and 70–90 only.

**Files to write:**

### 3A. `src/infra/security/apiKeyCrypto.ts`
```ts
export const KEY_PREFIX_LIVE = 'gr_live_';
export const LOOKUP_LEN = 16;          // includes the 'gr_live_' prefix

export function generateApiKey(): { plaintext: string; lookup: string; hint: string };
export function hashApiKey(plaintext: string): string;
export function verifyApiKeyHash(plaintext: string, storedHash: string): boolean;
export function extractLookup(plaintext: string): string | null;
```
Rules:
- `generateApiKey`: 32 bytes from `crypto.randomBytes(32)`, encoded **base64url** then stripped of any `=`. Final plaintext = `gr_live_` + that. `lookup = plaintext.slice(0, 16)`. `hint = plaintext.slice(0,12) + '…' + plaintext.slice(-4)`.
- `hashApiKey`: `crypto.createHmac('sha256', pepper).update(plaintext).digest('hex')` where
  `pepper = crypto.hkdfSync('sha256', Buffer.from(getConfig().ENCRYPTION_MASTER_KEY, 'hex'), Buffer.alloc(0), Buffer.from('goalroute-api-key-pepper-v1'), 32)`.
  Cache the derived pepper in a module-level `let` keyed off nothing — but expose `resetPepperForTest()` so `resetConfigForTest` scenarios work.
  > **Why HMAC and not bcrypt/argon2?** The key is 256 bits of CSPRNG entropy — it is not guessable by brute force, so a slow KDF buys nothing and would add ~100ms to every single gateway request. The pepper (derived from the master key, which is not in the DB) is what protects against an offline DB-only leak. **Write this rationale as a comment in the file.** Do not swap in bcrypt.
- `verifyApiKeyHash`: compute, then `crypto.timingSafeEqual` over equal-length buffers; return `false` (never throw) on length mismatch.
- `extractLookup`: returns `null` if the token doesn't start with `gr_live_` or is shorter than 24 chars.

### 3B. `src/domain/auth/types.ts`
```ts
export type AuthKind = 'admin' | 'account' | 'anonymous';
export interface AuthContext {
  kind: AuthKind;
  accountId: string | null;
  accountName: string | null;
  apiKeyId: string | null;
  pinnedPoolId: string | null;      // from api_keys.pool_id
  defaultPoolId: string | null;     // from accounts.default_pool_id
  scopes: string[];
  rateLimitRpm: number | null;
  rateLimitTpm: number | null;
}
export const ADMIN_CONTEXT: AuthContext = { kind:'admin', accountId:null, accountName:null,
  apiKeyId:null, pinnedPoolId:null, defaultPoolId:null, scopes:['*'],
  rateLimitRpm:null, rateLimitTpm:null };
```

### 3C. `src/services/authService.ts`
```ts
export class AuthService {
  constructor(private accountRepo: AccountRepository, private apiKeyRepo: ApiKeyRepository) {}
  public resolveBearer(token: string | undefined, adminToken: string): AuthContext;
  public touch(ctx: AuthContext): void;   // apiKeyRepo.touchUsage, no-op for admin
}
```
`resolveBearer` order of operations — **follow exactly**:
1. If `!token` → return `{ kind: 'anonymous', ... }`.
2. If `safeCompareTokens(token, adminToken)` → `ADMIN_CONTEXT`.
3. `lookup = extractLookup(token)`; if null → `anonymous`.
4. `rec = apiKeyRepo.findByLookup(lookup)`; if null → `anonymous`.
5. If `!verifyApiKeyHash(token, rec.key_hash)` → `anonymous`.
6. If `rec.status !== 'active'` → throw `AppError('API key has been revoked', 'KEY_REVOKED', 401)`.
   (Exception: `status === 'rotated'` **and** `rec.expires_at !== null` **and** `Date.now() < rec.expires_at` → allow, it is inside its grace window.)
7. If `rec.expires_at && Date.now() > rec.expires_at` → throw `AppError('API key expired','KEY_EXPIRED',401)`.
8. `acct = accountRepo.findById(rec.account_id)`; if missing or `status !== 'active'` → throw `AppError('Account is not active','ACCOUNT_INACTIVE',403)`.
9. Return the populated `account` context.

> Steps 1–5 return `anonymous` (indistinguishable failure) so a caller cannot probe which part of a
> forged key was wrong. Steps 6–8 return a *specific* error because the caller already proved key
> possession. **Preserve this distinction.**

Export `safeCompareTokens` from a new `src/infra/security/constantTime.ts` and have **both**
`server.ts` and `authService.ts` import it. Delete the local copy in `server.ts`.

**Files to write (tests):** `tests/unit/authService.test.ts`
- valid admin token → `kind: 'admin'`.
- valid account key → `kind:'account'` with correct `accountId`.
- one-character-mutated key → `anonymous`, and **does not** throw.
- revoked key → throws with code `KEY_REVOKED`.
- rotated key inside grace → resolves; same key after grace → throws.
- key on a `suspended` account → throws `ACCOUNT_INACTIVE`.
- `hashApiKey` is stable across calls and differs for two generated keys.

**Verify:** `npm run verify 2>&1 | tail -n 40`

**Definition of Done:** All auth tests pass. `server.ts` compiles against the shared `safeCompareTokens` with zero behavioural change to existing tests (`tests/unit/protocolAuth.test.ts` must still pass untouched).

---

# PHASE 4 — Account & Key Service Layer

**Objective.** Business rules for accounts and keys, including the one-time secret reveal.

**Files to read:** `src/services/poolService.ts` (full), `src/services/goalService.ts` lines 1–60, the interfaces you wrote in Phases 2 and 3.

**Files to write:**

### 4A. `src/services/accountService.ts`

```ts
export interface AccountDTO {
  id: string; name: string; description: string | null;
  status: 'active' | 'suspended' | 'deleted';
  defaultPoolId: string | null; defaultGoalId: string | null;
  monthlyBudgetUsd: number | null;
  rateLimitRpm: number | null; rateLimitTpm: number | null;
  maxKeys: number; activeKeyCount: number;
  createdAt: number; updatedAt: number;
}

export interface CreatedKeyDTO {
  id: string; accountId: string; name: string;
  plaintext: string;      // ⚠️ ONLY EVER POPULATED HERE, ONCE
  hint: string; scopes: string[]; poolId: string | null;
  expiresAt: number | null; createdAt: number;
}

export interface ApiKeyDTO {   // safe for listing — NO plaintext field at all
  id: string; accountId: string; name: string; hint: string;
  scopes: string[]; poolId: string | null; status: string;
  rotatedFromId: string | null; rotatedToId: string | null;
  lastUsedAt: number | null; requestCount: number;
  expiresAt: number | null; createdAt: number; revokedAt: number | null;
}
```

Class `AccountService`:

| Method | Rules |
|---|---|
| `createAccount(input)` | `name` trimmed, 1–64 chars, `^[A-Za-z0-9 ._-]+$`. Reject duplicates with `AppError(..., 'ACCOUNT_NAME_TAKEN', 409)`. |
| `listAccounts()` | Excludes `deleted`. Joins `activeKeyCount`. |
| `getAccount(id)` | Throws `NotFoundError` if missing or deleted. |
| `updateAccount(id, patch)` | Patchable: `description, status, defaultPoolId, defaultGoalId, monthlyBudgetUsd, rateLimitRpm, rateLimitTpm, maxKeys`. `name` is **immutable** after creation — reject it with 400. If `defaultPoolId` is given, verify the pool exists and (if it has an `account_id`) that it belongs to this account. |
| `deleteAccount(id)` | Soft delete + revoke every active key in **one transaction**. |
| `createKey(accountId, { name, scopes?, poolId?, expiresAt? })` | Enforce `activeKeyCount < account.max_keys` → else `AppError(..., 'KEY_LIMIT_REACHED', 409)`. Generate → hash → insert → return `CreatedKeyDTO` **with** `plaintext`. |
| `listKeys(accountId, includeRevoked)` | Returns `ApiKeyDTO[]`. |
| `rotateKey(keyId, { graceSeconds = 0 })` | **One transaction**: create a new key inheriting `name, scopes, pool_id, expires_at` from the old; `markRotated(oldId, newId)`; if `graceSeconds > 0` set old `expires_at = now + graceSeconds*1000` else set old `revoked_at = now`. Return the new `CreatedKeyDTO`. |
| `revokeKey(keyId)` | Idempotent — revoking an already-revoked key returns success, does not throw. |

**Absolute rule for this phase:** the string returned by `generateApiKey()` is written to exactly two
places — the `CreatedKeyDTO` returned to the caller, and (hashed) the DB. It is **never** passed to
`logger.*`, never stored in a variable that outlives the function, never echoed in an error message.
Add `// SECURITY: plaintext must not escape this scope` above each such line.

### 4B. `src/services/endpointDiscoveryService.ts`

```ts
export interface EndpointDescriptor {
  protocol: 'openai' | 'anthropic' | 'mcp' | 'native';
  enabled: boolean;
  baseUrl: string;        // e.g. http://127.0.0.1:8788
  path: string;           // e.g. /v1/chat/completions
  fullUrl: string;
  sdkBaseUrl: string;     // what you paste into an OpenAI SDK's baseURL, i.e. http://host:8788/v1
  exampleCurl: string;    // uses the literal placeholder <YOUR_API_KEY>
}
export function buildEndpointDescriptors(
  status: ReturnType<MultiPortServerService['getEndpointsStatus']>,
  opts: { host: string; poolId?: string | null }
): EndpointDescriptor[];
```
`exampleCurl` must contain `-H "Authorization: Bearer <YOUR_API_KEY>"` and, when `poolId` is set,
`-H "x-goalroute-pool: <poolId>"`. **Never interpolate a real key.**

**Files to write (tests):** `tests/unit/accountService.test.ts`
- create → list shows `activeKeyCount: 0`.
- createKey returns a plaintext matching `/^gr_live_[A-Za-z0-9_-]{20,}$/`; `listKeys` result objects have **no** `plaintext` property (`expect('plaintext' in dto).toBe(false)`).
- rotate: old key `status === 'rotated'`, `rotatedToId` set; new key `status === 'active'`, `rotatedFromId` set; the two plaintexts differ.
- rotate with `graceSeconds: 60` leaves the old key resolvable via `AuthService` for 60s.
- exceeding `maxKeys` throws `KEY_LIMIT_REACHED`.
- `deleteAccount` revokes all keys and subsequent `resolveBearer` on one of them throws.

**Verify:** `npm run verify 2>&1 | tail -n 40`

**Definition of Done:** Tests pass. Grep proves it: `grep -n "plaintext" src/services/accountService.ts` shows only the DTO field, the generate call, and the return.

---

# PHASE 5 — Admin REST Routes for Accounts, Keys & Endpoints

**Objective.** Expose Phase 4 over HTTP under the existing `ADMIN_API_TOKEN` guard.

**Files to read:** `src/api/server.ts` lines 120–200 (service wiring) and lines 380–430 (route style).

**Files to write:**

### 5A. `src/api/routes/accountRoutes.ts` *(new file — do not keep growing `server.ts`)*
Export `export function registerAccountRoutes(app: FastifyInstance, deps: { accountService: AccountService; poolService: PoolService; endpointsService: MultiPortServerService; config: Config }): void`.

Routes (all under the existing global admin auth hook — you add **no** new auth here):

| Method | Path | Body / Query | Returns |
|---|---|---|---|
| GET | `/api/v1/accounts` | — | `AccountDTO[]` |
| POST | `/api/v1/accounts` | `{ name, description?, defaultPoolId?, defaultGoalId?, monthlyBudgetUsd?, rateLimitRpm?, rateLimitTpm?, maxKeys? }` | `AccountDTO` |
| GET | `/api/v1/accounts/:id` | — | `AccountDTO` |
| PATCH | `/api/v1/accounts/:id` | patch object | `AccountDTO` |
| DELETE | `/api/v1/accounts/:id` | — | `{ ok: true }` |
| GET | `/api/v1/accounts/:id/keys` | `?includeRevoked=true` | `ApiKeyDTO[]` |
| POST | `/api/v1/accounts/:id/keys` | `{ name, scopes?, poolId?, expiresAt? }` | **`CreatedKeyDTO` (contains `plaintext`)** |
| POST | `/api/v1/accounts/:id/keys/:keyId/rotate` | `{ graceSeconds? }` | **`CreatedKeyDTO`** |
| DELETE | `/api/v1/accounts/:id/keys/:keyId` | — | `{ ok: true }` |
| GET | `/api/v1/accounts/:id/endpoints` | — | `{ endpoints: EndpointDescriptor[], defaultPoolId, pools: [{id,name}] }` |

Zod schemas for every body, declared at module top as `const createAccountSchema = z.object({...})`.

**Add to `src/infra/logger.ts`'s redaction list:** a regex for `gr_live_[A-Za-z0-9_-]{20,}`.
Do this *before* wiring the routes, and add a case to `tests/unit/...` proving a log line containing a
generated key comes out redacted.

Also: on the two routes that return `plaintext`, set `reply.header('Cache-Control', 'no-store')`.

### 5B. `src/api/server.ts` — wiring only
Instantiate `accountRepo`, `apiKeyRepo`, `usageRepo`, `authService`, `accountService` alongside the
existing repos/services, then call `registerAccountRoutes(fastify, {...})` after the existing
management routes. **Do not restructure anything else in this file in this phase.**

**Files to write (tests):** `tests/integration/accountsApi.test.ts`
- Full lifecycle over `app.inject()`: create account → create key (assert `body.plaintext` present) → list keys (assert no `plaintext`) → rotate (assert new plaintext ≠ old) → revoke → delete account.
- Every one of the 10 routes returns 401 without the admin token.
- `POST /api/v1/accounts` with `{ name: "" }` returns 400 with `code: 'VALIDATION_ERROR'`.
- `GET /api/v1/accounts/:id/endpoints` returns 4 descriptors and none of them contains a real key.

**Verify:** `npm run verify 2>&1 | tail -n 40`

**Definition of Done:** Integration test green. `server.ts` grew by under ~30 lines.

---

# PHASE 6 — Gateway Authentication & Pool Scoping

**Objective.** Make traffic ports accept account API keys, attribute every request, and enforce per-tenant limits. **This is the highest-risk phase. Change auth only where listed.**

**Files to read:** `src/api/server.ts` lines 70–90 (`buildProtocolAuthHook`), lines 206–270 (global `onRequest`), lines 150–170 (`resolveTargetPool`), and `src/domain/quota/slidingWindow.ts` (full).

**Files to write:**

### 6A. `src/api/authHooks.ts` *(new)*
```ts
declare module 'fastify' {
  interface FastifyRequest { auth?: AuthContext }
}
export function buildTrafficAuthHook(deps: { authService: AuthService; config: Config; rateLimiter: TenantRateLimiter }): onRequestHookHandler;
export function buildAdminAuthHook(deps: { config: Config }): onRequestHookHandler;
```
`buildTrafficAuthHook` behaviour:
1. `token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '').trim() || undefined`.
   Also accept the `x-api-key` header (Anthropic SDKs send that, not `Authorization`) — check `Authorization` first, fall back to `x-api-key`.
2. `ctx = authService.resolveBearer(token, config.ADMIN_API_TOKEN)`.
3. If `ctx.kind === 'anonymous'`: allow **only** when `config.NODE_ENV === 'development' && process.env.ALLOW_ANONYMOUS_DEV === 'true'` (preserve the existing escape hatch exactly); otherwise `401 { error: { message: 'Unauthorized', type: 'authentication_error' } }` — byte-identical to today's shape, because existing tests assert on it.
4. `req.auth = ctx`.
5. If `ctx.kind === 'account'`: `rateLimiter.checkOrThrow(ctx)` → on breach reply `429` with
   `{ error: { message, type: 'rate_limit_error', code: 'RATE_LIMIT_EXCEEDED' } }` and a
   `Retry-After` header in seconds.
6. `authService.touch(ctx)`.

`buildAdminAuthHook` is today's `/api/v1/*` logic, extracted verbatim — including the existing
exemptions for `/api/v1/health`, `/api/v1/mcp/settings`, localhost `/api/v1/system/token`,
the `!REMOTE_ACCESS_ENABLED` GET-endpoints exemption, and the `?token=` query form for
`/api/v1/request-logs/stream`. **Copy it; do not "improve" it.** Admin routes reject account keys.

### 6B. `src/domain/quota/tenantRateLimiter.ts` *(new)*
```ts
export class TenantRateLimiter {
  constructor(private db: Database.Database) {}
  checkOrThrow(ctx: AuthContext): void;          // RPM, pre-flight
  recordTokens(ctx: AuthContext, tokens: number): void;  // TPM, post-flight
}
```
60-second fixed windows in `tenant_rate_usage`, scope ids `account:<id>` and `key:<id>`.
Reuse `getWindowStart` from `src/domain/quota/slidingWindow.ts` if its signature fits; otherwise
floor to `60_000` inline. `checkOrThrow` is a no-op when the relevant limit is `null`.
Both methods do a single UPSERT / single SELECT. Prepare statements in the constructor.

### 6C. `src/api/server.ts` — surgical edits
1. Replace the body of the global `onRequest` hook's `/api/v1/` branch with a call into `buildAdminAuthHook`.
2. Replace the `/v1/chat/completions` branch with `buildTrafficAuthHook`.
3. In `buildProtocolApp`, swap `buildProtocolAuthHook(config)` for `buildTrafficAuthHook({...})` on the `openai`, `anthropic`, `mcp`, and `native` sub-apps. Delete `buildProtocolAuthHook`.
4. Rewrite `resolveTargetPool` as:
   ```ts
   const resolvePoolForAuth = (poolIdHeader: string | null, auth: AuthContext | undefined): string => {
     // precedence: explicit header > key pin > account default > first active pool
     const candidate = poolIdHeader ?? auth?.pinnedPoolId ?? auth?.defaultPoolId ?? null;
     if (candidate) {
       const pool = poolRepo.findPoolById(candidate);
       if (!pool || !pool.is_active) throw new AppError(`Pool '${candidate}' not found or inactive`, 'POOL_NOT_FOUND', 404);
       if (auth?.kind === 'account' && pool.account_id && pool.account_id !== auth.accountId) {
         throw new AppError('Pool does not belong to this account', 'POOL_FORBIDDEN', 403);
       }
       if (auth?.kind === 'account' && auth.pinnedPoolId && candidate !== auth.pinnedPoolId) {
         throw new AppError('This API key is pinned to a specific pool', 'POOL_PINNED', 403);
       }
       return candidate;
     }
     const pools = poolRepo.listPools().filter(p => p.is_active &&
       (auth?.kind !== 'account' || !p.account_id || p.account_id === auth.accountId));
     if (pools.length === 0) throw new AppError('No active pools available for this account.', 'NO_ACTIVE_POOLS', 400);
     return pools[0].id;
   };
   ```
   Update the 3 call sites (`chatCompletionsHandler`, `anthropicMessagesHandler`, and any MCP path) to pass `req.auth`.
5. Thread `req.auth` into the dispatch call — see Phase 7 for the signature.

### 6D. Account-scope goals & pools
- `PoolService.createPoolFromGoal(goalId, name, accountId?)` and `GoalService.createGoal(input)` accept and persist `account_id`.
- `listPools` / `listGoals` accept an optional `accountId` filter.
- `POST /api/v1/pools` and `POST /api/v1/goals` accept an optional `accountId` in the body.
- Rows with `account_id = NULL` are **shared/global** and visible to every account. Preserve that so existing single-tenant setups keep working.

**Files to write (tests):** `tests/integration/gatewayAuth.test.ts`
- Request with a valid account key on the OpenAI port → 200 (mock the provider client, mirror the pattern in `tests/integration/fullPipeline.test.ts`).
- Request with `ADMIN_API_TOKEN` → still 200 (regression).
- No auth header in production mode → 401 with exactly `{ error: { message: 'Unauthorized', type: 'authentication_error' } }`.
- Anthropic port with `x-api-key: gr_live_...` → 200.
- Key pinned to pool A, header asks for pool B → 403 `POOL_PINNED`.
- Account X key targeting a pool owned by account Y → 403 `POOL_FORBIDDEN`.
- `rateLimitRpm: 2` → third request inside the minute is 429 with a `Retry-After` header.
- Admin route `/api/v1/accounts` with an account key → 401.

**Verify:** `npm run verify 2>&1 | tail -n 40` — plus **specifically confirm** `tests/unit/protocolAuth.test.ts`, `tests/unit/remoteAccessGuard.test.ts`, `tests/unit/multiPortRemoteGuard.test.ts`, and `tests/unit/backend_routes_exclusion.test.ts` all still pass. They encode the security posture you must not regress.

**Definition of Done:** All of the above green. Zero existing tests deleted or weakened.

---

# PHASE 7 — Telemetry Capture, Cost Accounting & Rollups

**Objective.** Every dispatch produces one complete, attributed fact row plus two rollup UPSERTs.

**Files to read:** `src/services/gatewayService.ts` lines 1–60, 155–200, 420–470, 560–600, 830–880, 985–1025. **Bounded ranges only — this file is 1027 lines, do not read it whole.** Also `src/infra/db/repositories/modelRepo.ts` (full, 122 lines).

**Files to write:**

### 7A. `src/domain/pricing/costCalculator.ts` *(new)*
```ts
export function computeCostUsd(model: { cost_input_per_1k: number; cost_output_per_1k: number },
                               tokensIn: number, tokensOut: number): number {
  const cost = (tokensIn / 1000) * model.cost_input_per_1k
             + (tokensOut / 1000) * model.cost_output_per_1k;
  return Math.round(cost * 1e8) / 1e8;   // 8dp — free tiers are 0, paid tiers are fractions of a cent
}
```
Plus `export function estimateTokens(text: string): number { return Math.ceil(text.length / 4); }`
— used **only** as a last-resort fallback when a provider returns no `usage` block on a stream.
Any log row whose tokens were estimated must set `finish_reason` suffix `|estimated`. Do not silently
pass estimates off as measured values.

### 7B. `src/services/gatewayService.ts` — surgical edits only
1. Add an optional last parameter to both `dispatch` and `dispatchStream`:
   ```ts
   ctx?: { accountId: string | null; apiKeyId: string | null; protocol: 'openai'|'anthropic'|'mcp'|'native'; clientName?: string }
   ```
   Default `{ accountId: null, apiKeyId: null, protocol: 'openai' }` so every existing call site and test keeps compiling unchanged.
2. Introduce **one** private method and route all four existing `this.logRepo.log({...})` call sites (lines ~435, ~571, ~848, ~1000) through it:
   ```ts
   private recordOutcome(fact: {
     poolId: string; connectionId: string | null; modelId: string | null;
     providerSlug: string | null; modelName: string | null;
     status: 'success'|'failed'|'timeout';
     latencyMs: number; ttftMs: number | null;
     tokensIn: number; tokensOut: number; tokensCached: number; tokensReasoning: number;
     errorCode: string | null; finishReason: string | null;
     decisionTrace: DecisionTraceEntry[];
     attemptCount: number; fallbackUsed: boolean; isStream: boolean;
     traceId: string; clientName: string;
     ctx: DispatchCtx;
   }): void
   ```
   Inside, in a **single `db.transaction()`**: look up the model for pricing (`modelRepo.findById`),
   compute `costUsd` via `computeCostUsd`, call `logRepo.log(...)` with every column, then
   `usageRepo.record({...})`. Then `emitLogEvent` as today (keep the SSE payload shape — the UI
   depends on it; you may *add* fields, not rename existing ones).
   > `recordOutcome` must **never throw into the request path.** Wrap the whole body in a try/catch
   > that logs `logger.error({ err }, 'telemetry write failed')` and swallows. This is the one place
   > a catch-and-continue is correct, because dropping a metric must not fail a served request.
   > Add a comment saying exactly that.
3. Inject `UsageRepository` and `ModelRepository` (the latter is already a constructor arg) into `GatewayService`'s constructor. Update the single instantiation in `server.ts`.
4. **TTFT:** in `dispatchStream`, capture `Date.now()` at the first yielded chunk and carry it to `recordOutcome`. In non-streaming `dispatch`, `ttftMs = null`.
5. **Streaming usage:** the current `dispatchStream` logs before the stream drains, so `tokens_out` is 0. Fix it: wrap the returned `AsyncIterable` in a generator that tallies chunks, reads the final `usage` object if the provider emits one (OpenAI-compatible providers emit it when `stream_options.include_usage` is set — set that in `translateRequestToProvider` for openai-protocol providers), and calls `recordOutcome` in the generator's `finally` block. If no usage arrives, fall back to `estimateTokens` on the accumulated text and mark it estimated.
6. **attemptCount / fallbackUsed:** derive from the existing `decisionTrace` — `attemptCount = trace.filter(t => t.status !== 'skipped').length`, `fallbackUsed = trace.some(t => t.status === 'attempted_failed')`.
7. Replace all three `cost_usd: 0` literals. Grep to confirm: `grep -n "cost_usd: 0" src/services/gatewayService.ts` must return nothing.

**Files to write (tests):** `tests/integration/telemetry.test.ts`
- Non-stream success → `request_logs` row has `account_id`, `api_key_id`, `provider_slug`, `model_name`, `route_protocol`, non-zero `cost_usd` for a priced model, `attempt_count: 1`, `fallback_used: 0`.
- A `usage_rollups` row exists for both `hour` and `day` with `requests: 1`.
- Two requests in the same hour → one hour-rollup row with `requests: 2`.
- Streaming request → `tokens_out > 0` and `ttft_ms` non-null.
- First provider 500s, second succeeds → `fallback_used: 1`, `attempt_count: 2`, and `decision_trace` contains one `attempted_failed` plus one `selected`.
- A `recordOutcome` that throws internally (force it by stubbing usageRepo) still returns a 200 to the client.

**Verify:** `npm run verify 2>&1 | tail -n 40`

**Definition of Done:** All telemetry tests pass; `tests/unit/toolAndStream.test.ts` and `tests/integration/fullPipeline.test.ts` still pass unmodified.

---

# PHASE 8 — Stats & Log Query API

**Objective.** Read-only analytics endpoints backed by `usage_rollups` (never by scanning `request_logs`).

**Files to read:** your `usageRepo.ts` and `requestLogRepo.ts` from Phase 2. Nothing else.

**Files to write:**

### 8A. `src/services/statsService.ts`
```ts
export interface StatsWindow { from: number; to: number; granularity: 'hour'|'day' }
export interface UsageSummary {
  requests: number; requestsSuccess: number; requestsFailed: number; requestsTimeout: number;
  successRate: number;                 // 0..1, 0 when requests === 0 (never NaN)
  tokensIn: number; tokensOut: number; tokensTotal: number;
  tokensCached: number; tokensReasoning: number;
  costUsd: number;
  avgLatencyMs: number; maxLatencyMs: number; avgTtftMs: number | null;
  fallbackRate: number;
}
```
Methods: `summary(filters, window)`, `timeseries(filters, window)` (array of `{ bucketStart, ...UsageSummary }`, **zero-filled** for empty buckets so the chart has no gaps), `breakdown(filters, window, dimension: 'provider'|'model'|'key'|'pool'|'account')`, `topModels(...)`, `accountOverview(accountId)` (today / 7d / 30d summaries + budget consumed % + live rate-limit headroom).

Guard rails: clamp any requested window to a maximum of **366 days**; reject `from >= to` with 400;
default `granularity` to `hour` when the window is ≤ 48h, else `day`.

### 8B. `src/api/routes/statsRoutes.ts`
| Method | Path | Query |
|---|---|---|
| GET | `/api/v1/stats/summary` | `accountId?, apiKeyId?, poolId?, provider?, model?, from?, to?` |
| GET | `/api/v1/stats/timeseries` | same + `granularity?` |
| GET | `/api/v1/stats/breakdown` | same + `dimension` (required) |
| GET | `/api/v1/stats/accounts/:id/overview` | — |
| GET | `/api/v1/request-logs` | **replace existing** — `accountId?, apiKeyId?, poolId?, provider?, model?, status?, from?, to?, cursor?, limit?` → `{ rows, nextCursor }` |
| GET | `/api/v1/request-logs/:id` | — → full record with `decisionTrace` parsed from JSON into an object |

All admin-guarded. All queries Zod-validated with coercion (`z.coerce.number().optional()`).
Default window when `from`/`to` are absent: last 24 hours.

Keep `GET /api/v1/request-logs/stream` exactly as it is, but add `accountId`, `apiKeyId`, `costUsd`,
and `ttftMs` to the emitted SSE payload.

**Files to write (tests):** `tests/integration/statsApi.test.ts`
- Seed 3 rollup rows across 2 providers → `breakdown?dimension=provider` returns 2 rows with correct sums.
- `timeseries` over an empty 6-hour window returns 6 zero-filled buckets.
- `summary` on an account with zero traffic returns all zeros and `successRate: 0` (assert `Number.isNaN` is false).
- `request-logs` keyset pagination returns every row exactly once across pages.
- `from > to` → 400.
- A 400-day window → clamped, not an error.

**Verify:** `npm run verify 2>&1 | tail -n 40`

**Definition of Done:** Stats tests pass. `EXPLAIN QUERY PLAN` on the summary query shows it using `idx_rollups_acct_gran_bucket` — paste the output line into `docs/PROGRESS.md`.

---

# PHASE 9 — Web UI: Accounts, Keys, Usage & Routing Explorer

**Objective.** A new **Accounts** tab. Four components. **Zero new npm packages** — charts are hand-rolled SVG.

**Files to read:** `src/web/components/layout/AppShell.tsx` lines 1–40 and 200–240 and 320–340 (the tab switch), `src/web/components/cockpit/CockpitDashboard.tsx` lines 1–80 (fetch + auth-header pattern), `src/web/components/database/BenchmarkMatrixChart.tsx` lines 1–120 (the hand-rolled SVG chart pattern to copy).

**Files to write:**

### 9A. `src/web/components/accounts/AccountsManager.tsx`
Master/detail. Left: account list with name, status pill, 24h request count, 24h cost.
Right: the selected account's four sub-panels (below) as an inner tab strip.
Create-account modal: name, description, default pool (select, loaded from `/api/v1/pools`),
monthly budget, RPM, TPM, max keys.

### 9B. `src/web/components/accounts/ApiKeyManager.tsx`
- Table: name, hint (`gr_live_ab12…9xQz`), status pill, scopes, pinned pool, last used (relative), request count, created.
- Buttons per row: **Rotate** (confirm modal with an optional grace-period input, default 0) and **Revoke** (typed confirmation — user must type the key's name).
- **`RevealKeyModal`** — the critical UX. On create or rotate:
  - Renders the plaintext in a `font-mono` block with a **Copy** button.
  - A red banner: *"This is the only time this key will be shown. It is stored hashed and cannot be recovered. If you lose it, rotate the key."*
  - A checkbox **"I have saved this key"** that gates the only way to dismiss the modal. No backdrop-click dismissal, no Esc dismissal.
  - On dismiss, the plaintext is cleared from React state immediately (`setSecret(null)`).
  - **Never** put the plaintext into a URL, `localStorage`, `sessionStorage`, a `console.log`, or a `document.title`. Use `navigator.clipboard.writeText` and fall back to a hidden textarea + `execCommand('copy')` for non-secure-context installs.

### 9C. `src/web/components/accounts/AccountUsagePanel.tsx`
- Range selector: 24h / 7d / 30d / 90d.
- Six KPI tiles: Requests, Success rate, Tokens in, Tokens out, Cost, p-avg latency.
- **Stacked area/line chart** (hand-rolled `<svg>`) of requests over time, one series per provider, from `/api/v1/stats/timeseries`.
- **Breakdown table** with a dimension toggle (Provider / Model / Key / Pool): requests, success %, tokens in, tokens out, avg latency, avg TTFT, cost, fallback %. Sortable by clicking a header.
- Budget bar when `monthlyBudgetUsd` is set: consumed / limit with a colour change at 80% and 100%.
- Rate-limit headroom row: `current RPM / limit`, `current TPM / limit`.
- Refresh every 30s via `setInterval`; **clear the interval in the effect's cleanup** (this codebase's `.clinerules` calls out timer leaks explicitly).

### 9D. `src/web/components/accounts/RoutingLogExplorer.tsx`
- Filter bar: account, key, provider, model, status, time range, free-text trace id.
- Virtual-free simple table (page size 50) driven by the `nextCursor` keyset API with a **Load more** button. No offset pagination.
- Columns: time, status dot, provider/model, tokens in→out, latency, TTFT, fallback badge, cost.
- Row click → right-hand drawer showing the **decision trace as an ordered timeline**: each candidate step with its status (`selected` green / `skipped` grey / `attempted_failed` red), the `reason` string, the policy `scores` object rendered as a small bar row, and the error if present. Reuse `src/web/components/drawers/DecisionInspectorDrawer.tsx` if its props fit; otherwise write a sibling and say so.
- A live toggle that attaches to the existing `/api/v1/request-logs/stream` SSE and prepends rows.

### 9E. `src/web/components/settings/EndpointsManager.tsx` — extend, do not rewrite
Add an **"Connect an account"** section: an account picker, then per-protocol cards showing
`sdkBaseUrl`, the full URL, a copy button, and the `exampleCurl` from `/api/v1/accounts/:id/endpoints`
with `<YOUR_API_KEY>` left as a literal placeholder.

### 9F. `src/web/components/layout/AppShell.tsx` — surgical
Widen the `activeTab` union to include `'accounts'`, add the nav button (icon: `Users` from
`lucide-react`, already a dependency) between **Cockpit** and **Bridge**, add
`{activeTab === 'accounts' && <AccountsManager />}`. That is the whole change.

**Files to write (tests):** `tests/unit/accountsUi.test.ts` — mirror the existing style of
`tests/unit/endpoints_ui.test.ts` (which is a source-assertion test, not a DOM render test). Assert:
- `ApiKeyManager.tsx` source contains no `localStorage`, no `sessionStorage`, and no `console.log`.
- `AccountUsagePanel.tsx` contains a `clearInterval` (timer cleanup).
- `AppShell.tsx` contains `'accounts'` in the tab union and renders `<AccountsManager`.
- `package.json` dependency list is byte-identical to Phase 0 (no new deps).

**Verify:** `npm run verify && npm run build:web 2>&1 | tail -n 30`

**Definition of Done:** Web build succeeds, new tab renders, tests pass, `git diff --stat package.json` is empty.

---

# PHASE 10 — Production Hardening & Release

**Objective.** Make it shippable. No new features.

**Files to read:** `.env.example`, `README.md`, `Dockerfile`, `src/api/server.ts` lines 690–760 (the purge scheduler).

**Tasks:**

1. **Config.** Add to `src/infra/config.ts`'s Zod schema:
   - `ROLLUP_HOUR_RETENTION_DAYS` (default 90)
   - `API_KEY_DEFAULT_GRACE_SECONDS` (default 0)
   - `MAX_ACCOUNTS` (default 1000)
   Add each to `.env.example` with a comment.
2. **Retention.** In the existing 6-hourly purge interval, also call
   `usageRepo.purgeOlderThan(now - ROLLUP_HOUR_RETENTION_DAYS*86400000, 'hour')`.
   **Day rollups are never purged** — that is the permanent audit trail. Comment it.
3. **Rate limiting.** The global `@fastify/rate-limit` `keyGenerator` currently uses the raw
   `Authorization` header value as the bucket key, which puts a plaintext API key into the
   rate-limiter's in-memory map. Change it to `req.auth?.apiKeyId ?? 'ip:' + req.ip`, falling back to
   a sha256 of the header only if `req.auth` is unavailable at that point in the lifecycle.
4. **Startup guard.** In `assertConfigPolicy`, if `NODE_ENV === 'production'` and there are zero
   active accounts, log a `warn` (not a throw) telling the operator to create one. Add the check at
   boot in `startServer`, not in config parsing.
5. **`tenant_rate_usage` cleanup.** Delete windows older than 10 minutes in the same purge interval.
6. **Graceful shutdown.** Confirm the new `setInterval`s (if any) are `.unref()`'d, matching the existing pattern.
7. **Docs.** Update `README.md` with:
   - A new "Accounts & API Keys" section: create an account → generate a key → point your client at `http://host:8788/v1` with `Authorization: Bearer gr_live_…`.
   - A "Usage Analytics" section listing the `/api/v1/stats/*` endpoints.
   - A note that keys are HMAC-hashed and shown once.
   Create `docs/API.md` with the full route table (accounts, keys, stats, logs) — request/response shapes, one example each.
8. **Version.** `package.json` → `"version": "1.0.0"`.
9. **CI.** Add `npm run typecheck` is already there; add a step `npx tsc --noEmit -p tsconfig.json` for tests via a new `tsconfig.test.json` that includes `tests/` — optional, only if it passes cleanly. If it produces pre-existing errors, skip it and note that in `docs/DEVIATIONS.md`.
10. **Smoke script.** `scripts/smoke.ts`: boots the app in-process, creates an account, creates a key, calls `/v1/chat/completions` against a stubbed provider, asserts a rollup row exists, prints `SMOKE OK`. Wire as `"smoke": "tsx scripts/smoke.ts"`.

**Verify:** `npm run verify && npm run smoke 2>&1 | tail -n 20`

**Definition of Done:** Verify green, smoke prints `SMOKE OK`, README and `docs/API.md` describe every new route, version is 1.0.0.

---

## Appendix A — Security Checklist (review before declaring Phase 10 done)

- [ ] `grep -rn "plaintext" src/ --include=*.ts` shows plaintext only in `apiKeyCrypto.ts`, `accountService.ts`, and `accountRoutes.ts` — never in a repo, never in a logger call.
- [ ] `src/infra/logger.ts` redacts `gr_live_[A-Za-z0-9_-]{20,}`, and there is a test proving it.
- [ ] Key hash comparison uses `crypto.timingSafeEqual`, not `===`.
- [ ] Forged/unknown keys yield `anonymous` → generic 401, not a distinguishing error.
- [ ] Account keys cannot reach any `/api/v1/*` route.
- [ ] An account key cannot dispatch to another account's pool (test exists).
- [ ] Key create/rotate responses carry `Cache-Control: no-store`.
- [ ] `REMOTE_ACCESS_ENABLED=true` still requires a non-default `ADMIN_API_TOKEN` (existing guard untouched).
- [ ] No `SELECT ... ${userInput}` anywhere — `groupBy`/`dimension`/`orderBy` are whitelist-mapped, everything else is a bound parameter.
- [ ] Deleting an account cascades key revocation.

## Appendix B — Performance Checklist

- [ ] Every prepared statement in the hot path (`findByLookup`, `touchUsage`, rollup UPSERTs, `logRepo.log`) is prepared **once** in a constructor, not per call.
- [ ] Auth adds exactly 2 SQLite round trips per request (`findByLookup`, `touchUsage`); account lookup is a third only for account keys.
- [ ] `recordOutcome` is a single transaction: 1 INSERT + 2 UPSERTs.
- [ ] Stats endpoints never touch `request_logs`.
- [ ] `request-logs` list is keyset-paginated; no `OFFSET` anywhere.
- [ ] No unbounded arrays accumulate in `dispatchStream` — the accumulated text buffer for token estimation is capped (e.g. 256KB) and then stops growing.

## Appendix C — Phase Dependency Graph

```
0 ──▶ 1 ──▶ 2 ──▶ 3 ──▶ 4 ──▶ 5 ──┐
                         │        ├──▶ 9 ──▶ 10
                         └──▶ 6 ──┴──▶ 7 ──▶ 8 ──┘
```
Phases 5 and 6 both depend on 4. Phase 8 depends on 7. Phase 9 depends on 5 and 8.
**Do not parallelise.** Run them 0 → 10 in order, one agent task each.
