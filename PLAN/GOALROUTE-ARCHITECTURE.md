# GoalRoute — System Architecture & Build Specification

> **Purpose of this document**: this is a complete, implementation-ready architecture spec for an AI coding agent (Google Antigravity) to build GoalRoute's backend from scratch. It defines domain boundaries, data model, algorithms, APIs, CLI surface, testing strategy, and a phased build plan with explicit acceptance criteria. No UI work is in scope for this phase — everything must be operable and verifiable via CLI and HTTP calls first.
>
> **Product one-liner**: GoalRoute is a multi-provider LLM gateway that takes a plain-language *goal* ("4,000 requests/day, 10M tokens/day, don't exhaust providers, keep latency low, stay free") and produces a working, monitored, self-healing routing pool — instead of making the user learn routing strategies, scoring weights, and provider quotas by hand.
>
> **Working name**: `GoalRoute`. Rename freely; it appears only as a string constant and package name, never baked into logic.

---

## 0. Non-Negotiable Engineering Principles

These apply to every phase below. Antigravity should treat violations of these as bugs, not style preferences.

1. **Domain logic is pure and I/O-free.** The goal solver, scoring engine, and routing-decision logic must be plain functions/classes with no database, network, or filesystem calls. This is what makes them unit-testable with fixtures and safe to iterate on without spinning up infrastructure.
2. **Fail-safe over fail-silent, but never fail-opaque.** Every failure path must resolve deterministically (block, degrade, or fallback) and log *why* in structured form. No swallowed exceptions, no silent no-ops.
3. **No raw secrets, ever.** API keys and OAuth tokens are encrypted at rest (AES-256-GCM), decrypted only in memory at dispatch time, and never appear in logs, error messages, or exception stack traces. A dedicated redaction layer sits in front of the logger.
4. **Every external I/O boundary is validated.** All inbound HTTP bodies and CLI arguments pass through schema validation (Zod) before touching business logic. No raw `any` crossing a module boundary.
5. **Migrations are additive and idempotent.** Never edit a shipped migration. Every schema change is a new numbered migration, safe to re-run.
6. **Everything the system decides is explainable.** Every routing decision, every solver recommendation, every circuit-breaker trip must produce a machine-readable trace explaining *why*, retrievable by ID. This is the foundation the future UI (and the embedded agent) will narrate to users in plain language.
7. **CLI and HTTP API are two thin adapters over one service layer.** Nothing is CLI-only or API-only. If the CLI can do it, the HTTP API can do it, and vice versa, because they both call the same service functions.
8. **Test the unhappy paths harder than the happy path.** Provider timeouts, malformed responses, expired credentials, and quota exhaustion mid-stream are first-class test scenarios, not afterthoughts.

---

## 1. High-Level Architecture

```
                              ┌────────────────────────────┐
                              │        CLI  (thin)         │
                              │  goalroute <command>       │
                              └─────────────┬──────────────┘
                                            │
                              ┌─────────────▼──────────────┐
                              │     HTTP API (thin)        │
                              │  /api/v1/*  +  /v1/* (OAI) │
                              └─────────────┬──────────────┘
                                            │
        ┌───────────────────────────────────────────────────────────────┐
        │                        SERVICE LAYER                          │
        │  (orchestrates domain + infra; the only place both meet)      │
        │                                                                │
        │  ProviderService · GoalService · PoolService · GatewayService │
        │  HealthService · QuotaService · CatalogService                │
        └───────┬───────────────────────────────┬────────────────────────┘
                │                               │
   ┌────────────▼────────────┐     ┌────────────▼─────────────────┐
   │      DOMAIN LAYER        │     │        INFRA LAYER            │
   │  (pure, no I/O)          │     │  (all I/O lives here)         │
   │                          │     │                                │
   │ - GoalSolver             │     │ - SQLite (better-sqlite3, WAL) │
   │ - ScoringEngine          │     │ - CredentialVault (AES-256-GCM)│
   │ - RoutingPolicy          │     │ - ProviderHttpClient           │
   │ - CircuitBreaker (FSM)   │     │ - Logger (pino, redacting)     │
   │ - QuotaWindowMath        │     │ - Clock (injectable, testable) │
   │ - RequestTranslator      │     │ - Config loader (env + Zod)    │
   └──────────────────────────┘     └────────────────────────────────┘
```

**Key architectural decision: strict layering.** The domain layer never imports from infra. The service layer is the only thing allowed to import both. This is what lets the solver and scoring engine be tested with in-memory fixtures in milliseconds, and it's what keeps the codebase navigable as it grows — anyone can answer "where does X live" from the layer alone.

---

## 2. Technology Stack (with rationale)

| Layer | Choice | Why |
|---|---|---|
| Language/runtime | TypeScript on Node.js ≥ 22 | Best ecosystem for SSE streaming, OpenAI-compatible proxying, and the eventual coding-agent integrations. Matches the domain (proxy gateway) better than Python here. |
| HTTP framework | Fastify | Faster and lighter than Express for high-throughput streaming proxies; first-class schema validation hooks. |
| Validation | Zod | Single source of truth for types + runtime validation; matches TS types via inference. |
| Database | SQLite (`better-sqlite3`), WAL mode | Single-node, zero-ops, fully sufficient for a self-hosted single-tenant gateway; synchronous API removes a whole class of race conditions in the hot path. Design the data access layer behind an interface so Postgres can be swapped in later without touching services. |
| Migrations | Custom lightweight migration runner (numbered `.sql` + checksum table) | No heavy ORM; keeps schema changes auditable and reviewable in PRs. |
| Logging | `pino` with a custom redaction serializer | Structured JSON logs, fast, and secrets are redacted at the serializer level so no call site can leak them by accident. |
| Testing | `vitest` | Fast, native ESM/TS support, good mocking ergonomics. |
| CLI framework | `commander` | Minimal, well-understood, keeps CLI as a thin adapter. |
| Encryption | Node `crypto` (AES-256-GCM) | No external dependency needed for this. |
| Scheduling (health checks, quota reset sweeps) | `node-cron` or a minimal internal scheduler | Simple recurring jobs; no need for a job queue at this scale. |

Everything above is a default recommendation, not a hard constraint — but Antigravity should not deviate without a documented reason in an ADR (see §11).

---

## 3. Repository Structure

```
goalroute/
├── src/
│   ├── domain/                  # PURE. No imports from infra/. No I/O.
│   │   ├── goal/
│   │   │   ├── types.ts             # Goal, TaskProfile, GoalConstraints
│   │   │   ├── solver.ts            # GoalSolver — the recommendation engine
│   │   │   └── solver.test.ts
│   │   ├── scoring/
│   │   │   ├── types.ts             # Candidate, ScoreFactors, ScoreResult
│   │   │   ├── scoringEngine.ts     # weighted multi-factor scorer
│   │   │   └── scoringEngine.test.ts
│   │   ├── routing/
│   │   │   ├── types.ts             # PoolPlan, PoolStep, RoutingDecision
│   │   │   ├── policies/            # one file per routing policy (§6)
│   │   │   │   ├── fillFirst.ts
│   │   │   │   ├── balanced.ts
│   │   │   │   ├── fastest.ts
│   │   │   │   ├── cheapest.ts
│   │   │   │   └── autoScore.ts
│   │   │   └── policySelector.ts    # maps Goal preferences -> policy
│   │   ├── resilience/
│   │   │   ├── circuitBreaker.ts    # pure FSM, injected clock
│   │   │   ├── circuitBreaker.test.ts
│   │   │   ├── cooldown.ts          # backoff math, pure
│   │   │   └── cooldown.test.ts
│   │   ├── quota/
│   │   │   ├── slidingWindow.ts     # pure counter math, injected clock
│   │   │   ├── slidingWindow.test.ts
│   │   │   └── fairShare.ts
│   │   └── translation/
│   │       ├── openaiToProvider.ts
│   │       ├── providerToOpenai.ts
│   │       └── translation.test.ts
│   │
│   ├── infra/                    # ALL I/O lives here
│   │   ├── db/
│   │   │   ├── client.ts            # better-sqlite3 wrapper, WAL config
│   │   │   ├── migrations/           # 0001_init.sql, 0002_..., etc.
│   │   │   ├── migrationRunner.ts
│   │   │   └── repositories/        # one repo per aggregate, thin SQL
│   │   │       ├── providerRepo.ts
│   │   │       ├── connectionRepo.ts
│   │   │       ├── modelRepo.ts
│   │   │       ├── goalRepo.ts
│   │   │       ├── poolRepo.ts
│   │   │       ├── quotaRepo.ts
│   │   │       ├── healthRepo.ts
│   │   │       └── requestLogRepo.ts
│   │   ├── security/
│   │   │   ├── vault.ts             # encrypt/decrypt credentials
│   │   │   └── redaction.ts         # log serializer
│   │   ├── http/
│   │   │   ├── providerClient.ts    # outbound fetch w/ timeout, retry hooks
│   │   │   └── streamProxy.ts       # SSE passthrough helpers
│   │   ├── logger.ts
│   │   ├── clock.ts                 # SystemClock + TestClock
│   │   └── config.ts                # env loading + Zod schema, fail-fast on boot
│   │
│   ├── catalog/                  # static + refreshable provider/model data
│   │   ├── providers.seed.json      # curated provider registry (start small, real data)
│   │   ├── models.seed.json         # curated model registry w/ benchmarks
│   │   ├── catalogTypes.ts
│   │   └── catalogService.ts        # load, validate, merge overrides
│   │
│   ├── services/                 # orchestration layer (domain + infra)
│   │   ├── providerService.ts
│   │   ├── goalService.ts
│   │   ├── poolService.ts
│   │   ├── gatewayService.ts        # the hot-path request pipeline
│   │   ├── healthService.ts
│   │   ├── quotaService.ts
│   │   └── catalogService.ts
│   │
│   ├── api/
│   │   ├── server.ts                 # Fastify bootstrap
│   │   ├── plugins/                  # auth, error handler, request-id, cors
│   │   ├── routes/
│   │   │   ├── v1/
│   │   │   │   ├── providers.ts
│   │   │   │   ├── goals.ts
│   │   │   │   ├── pools.ts
│   │   │   │   ├── health.ts
│   │   │   │   └── simulate.ts
│   │   │   └── gateway/
│   │   │       └── chatCompletions.ts   # OpenAI-compatible /v1/chat/completions
│   │   └── schemas/                  # Zod request/response schemas per route
│   │
│   ├── cli/
│   │   ├── index.ts
│   │   └── commands/
│   │       ├── provider.ts
│   │       ├── goal.ts
│   │       ├── pool.ts
│   │       ├── route.ts
│   │       ├── status.ts
│   │       └── simulate.ts
│   │
│   └── shared/
│       ├── errors.ts                 # AppError hierarchy, error codes
│       ├── types.ts                  # cross-cutting shared types
│       └── ids.ts                    # ULID generation
│
├── tests/
│   ├── unit/            # mirrors src/domain, fast, no I/O
│   ├── integration/     # real SQLite (temp file), mocked HTTP providers
│   ├── chaos/           # fault-injection: timeouts, 429s, malformed JSON
│   └── fixtures/        # sample provider payloads, seed data snapshots
│
├── docs/
│   ├── adr/              # Architecture Decision Records, one file per decision
│   ├── glossary.md
│   └── runbook.md
│
├── .env.example
├── package.json
├── tsconfig.json
└── README.md
```

---

## 4. Data Model

All tables live in SQLite, WAL mode, `better-sqlite3`. IDs are ULIDs (sortable, unique, no coordination needed). Timestamps are Unix epoch milliseconds, stored as integers.

```sql
-- ============================================================
-- 0001_init.sql
-- ============================================================

CREATE TABLE providers (
    id              TEXT PRIMARY KEY,      -- ULID
    slug            TEXT NOT NULL UNIQUE,  -- e.g. 'groq', 'openrouter'
    display_name    TEXT NOT NULL,
    base_url        TEXT NOT NULL,
    auth_type       TEXT NOT NULL CHECK (auth_type IN ('api_key','oauth','keyless')),
    protocol        TEXT NOT NULL CHECK (protocol IN ('openai','anthropic','gemini','custom')),
    docs_url        TEXT,
    capabilities    TEXT NOT NULL DEFAULT '{}',   -- JSON: {"vision":true,"tools":true,...}
    is_active       INTEGER NOT NULL DEFAULT 1,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL
);

CREATE TABLE provider_connections (
    id                  TEXT PRIMARY KEY,
    provider_id         TEXT NOT NULL REFERENCES providers(id),
    label               TEXT NOT NULL,             -- user-facing name, e.g. "My Groq (free)"
    credential_enc      BLOB NOT NULL,              -- AES-256-GCM ciphertext
    credential_iv       BLOB NOT NULL,
    credential_tag      BLOB NOT NULL,
    tier                TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free','paid','subscription')),
    status              TEXT NOT NULL DEFAULT 'untested'
                            CHECK (status IN ('untested','healthy','unavailable','expired','banned')),
    last_tested_at      INTEGER,
    last_error          TEXT,
    created_at          INTEGER NOT NULL,
    updated_at          INTEGER NOT NULL
);

CREATE TABLE models (
    id                  TEXT PRIMARY KEY,
    provider_id         TEXT NOT NULL REFERENCES providers(id),
    model_name          TEXT NOT NULL,              -- provider's own model id string
    display_name        TEXT NOT NULL,
    context_window      INTEGER NOT NULL,
    supports_tools      INTEGER NOT NULL DEFAULT 0,
    supports_vision     INTEGER NOT NULL DEFAULT 0,
    cost_input_per_1k   REAL NOT NULL DEFAULT 0,     -- USD; 0 for free-tier models
    cost_output_per_1k  REAL NOT NULL DEFAULT 0,
    bench_tps           REAL,                        -- tokens/sec, from catalog benchmarks
    bench_ttft_ms       REAL,                        -- time-to-first-token, p50
    bench_p95_latency_ms REAL,
    task_fitness        TEXT NOT NULL DEFAULT '{}',  -- JSON: {"coding":0.9,"reasoning":0.7,...}
    is_active           INTEGER NOT NULL DEFAULT 1,
    UNIQUE(provider_id, model_name)
);

CREATE TABLE quota_policies (
    id                  TEXT PRIMARY KEY,
    connection_id       TEXT NOT NULL REFERENCES provider_connections(id) ON DELETE CASCADE,
    dimension           TEXT NOT NULL,              -- 'daily_tokens' | 'daily_requests' | 'rpm' | 'tpm'
    window_seconds      INTEGER NOT NULL,           -- e.g. 86400 for daily, 60 for per-minute
    limit_value         REAL NOT NULL,
    reset_anchor        TEXT NOT NULL DEFAULT 'rolling' CHECK (reset_anchor IN ('rolling','fixed_utc_midnight')),
    UNIQUE(connection_id, dimension)
);

CREATE TABLE quota_usage (
    connection_id       TEXT NOT NULL REFERENCES provider_connections(id) ON DELETE CASCADE,
    dimension           TEXT NOT NULL,
    window_start        INTEGER NOT NULL,           -- floor(now / window_seconds) * window_seconds
    used_value          REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (connection_id, dimension, window_start)
);

CREATE TABLE health_state (
    connection_id       TEXT PRIMARY KEY REFERENCES provider_connections(id) ON DELETE CASCADE,
    state               TEXT NOT NULL DEFAULT 'closed' CHECK (state IN ('closed','open','half_open')),
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    opened_at           INTEGER,
    cooldown_until      INTEGER,
    updated_at          INTEGER NOT NULL
);

CREATE TABLE goals (
    id                      TEXT PRIMARY KEY,
    name                    TEXT NOT NULL,
    task_type               TEXT NOT NULL CHECK (task_type IN ('coding_agent','chatbot','batch','research','general')),
    target_requests_per_day INTEGER,
    target_tokens_per_day   INTEGER,
    latency_pref            TEXT NOT NULL DEFAULT 'relaxed' CHECK (latency_pref IN ('instant','relaxed')),
    budget_pref             TEXT NOT NULL DEFAULT 'free' CHECK (budget_pref IN ('free','capped','unlimited')),
    budget_cap_usd_monthly  REAL,
    exhaustion_pref         TEXT NOT NULL DEFAULT 'preserve_backup'
                                CHECK (exhaustion_pref IN ('fill_first','preserve_backup')),
    reliability_pref        TEXT NOT NULL DEFAULT 'standard' CHECK (reliability_pref IN ('standard','maximum')),
    safety_margin_pct       REAL NOT NULL DEFAULT 20.0,
    created_at              INTEGER NOT NULL,
    updated_at              INTEGER NOT NULL
);

CREATE TABLE pools (
    id              TEXT PRIMARY KEY,
    goal_id         TEXT REFERENCES goals(id),     -- nullable: pools can be created manually too
    name            TEXT NOT NULL,
    policy          TEXT NOT NULL,                  -- 'fill_first'|'balanced'|'fastest'|'cheapest'|'auto_score'
    is_active       INTEGER NOT NULL DEFAULT 1,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL
);

CREATE TABLE pool_steps (
    id              TEXT PRIMARY KEY,
    pool_id         TEXT NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
    order_index     INTEGER NOT NULL,
    connection_id   TEXT NOT NULL REFERENCES provider_connections(id),
    model_id        TEXT NOT NULL REFERENCES models(id),
    role            TEXT NOT NULL DEFAULT 'primary' CHECK (role IN ('primary','backup','overflow')),
    weight          REAL NOT NULL DEFAULT 1.0,
    UNIQUE(pool_id, order_index)
);

CREATE TABLE request_logs (
    id              TEXT PRIMARY KEY,
    pool_id         TEXT REFERENCES pools(id),
    connection_id   TEXT REFERENCES provider_connections(id),
    model_id        TEXT REFERENCES models(id),
    status          TEXT NOT NULL CHECK (status IN ('success','failed','timeout')),
    latency_ms      INTEGER,
    tokens_in       INTEGER,
    tokens_out      INTEGER,
    cost_usd        REAL,
    error_code      TEXT,
    decision_trace  TEXT,                 -- JSON: why this target was chosen, factor scores
    created_at      INTEGER NOT NULL
);

CREATE INDEX idx_request_logs_pool_created ON request_logs(pool_id, created_at);
CREATE INDEX idx_quota_usage_lookup ON quota_usage(connection_id, dimension, window_start);
```

**Design notes:**
- `quota_usage` uses a compound key of `(connection_id, dimension, window_start)` so the sliding-window math (§7) never needs a background sweep — old rows are simply irrelevant and can be garbage-collected lazily.
- `decision_trace` on `request_logs` is what makes the system explainable (Principle 6). It's a JSON blob, not normalized — it's write-once, read-rarely, and normalizing it would only slow down the hot path for no benefit.
- Credentials are three separate BLOB columns (ciphertext, IV, auth tag) rather than one concatenated blob — this is a deliberate defensive choice so a future migration can rotate encryption schemes without ambiguous parsing.

---

## 5. Core Domain Concept: The Goal Solver

This is the product's brain and must be the most heavily tested piece of code in the system.

### 5.1 Inputs

```typescript
interface Goal {
  taskType: 'coding_agent' | 'chatbot' | 'batch' | 'research' | 'general';
  targetRequestsPerDay?: number;
  targetTokensPerDay?: number;
  latencyPref: 'instant' | 'relaxed';
  budgetPref: 'free' | 'capped' | 'unlimited';
  budgetCapUsdMonthly?: number;
  exhaustionPref: 'fill_first' | 'preserve_backup';
  reliabilityPref: 'standard' | 'maximum';
  safetyMarginPct: number; // default 20
}

interface CandidateSource {
  connectionId: string;
  providerId: string;
  modelId: string;
  tier: 'free' | 'paid' | 'subscription';
  dailyTokenCapacity: number;     // derived from quota_policies, 0 = unknown/unbounded
  dailyRequestCapacity: number;
  costPerRequestUsd: number;      // blended estimate for an average request size
  benchTps: number;
  benchTtftMs: number;
  taskFitness: number;            // 0..1 for the goal's taskType
  currentHealthState: 'closed' | 'open' | 'half_open';
}
```

### 5.2 Algorithm (greedy set-cover with fitness ordering)

This is intentionally **not** a black-box optimizer — it must be a legible, steppable algorithm that can produce a `decisionTrace` explaining every choice, because that trace is what the future UI/agent will narrate to the user.

```
function solveGoal(goal: Goal, candidates: CandidateSource[]): PoolPlan {

  // 1. Filter phase
  eligible = candidates.filter(c =>
       c.taskFitness >= MIN_TASK_FITNESS_THRESHOLD (default 0.4)
    && c.currentHealthState != 'open'
    && (goal.budgetPref != 'free' || c.tier == 'free')
  )

  if (eligible.length == 0) {
    return infeasiblePlan(reason: "no eligible providers for this task type/budget")
  }

  // 2. Fitness-order candidates
  //    Weighted composite of taskFitness, latency-fit, and (if paid) cost-efficiency.
  //    Weights depend on goal.latencyPref:
  //      instant  -> latency weighted higher
  //      relaxed  -> taskFitness weighted higher
  ordered = sortByCompositeScore(eligible, goal.latencyPref)

  // 3. Greedy set-cover to meet capacity targets
  targetTokens   = goal.targetTokensPerDay ?? 0
  targetRequests = goal.targetRequestsPerDay ?? 0
  marginMultiplier = 1 + (goal.safetyMarginPct / 100)

  selected = []
  coveredTokens = 0
  coveredRequests = 0

  for candidate in ordered:
    if coveredTokens >= targetTokens * marginMultiplier
       AND coveredRequests >= targetRequests * marginMultiplier:
      break

    selected.push({ candidate, role: 'primary' })
    coveredTokens += candidate.dailyTokenCapacity
    coveredRequests += candidate.dailyRequestCapacity

  // 4. Reliability pass — add backup capacity if requested
  if goal.reliabilityPref == 'maximum':
    // Add 1-2 more candidates beyond the minimum cover, marked as 'backup',
    // preferring different providers (not just different models on the same
    // provider) to avoid correlated failure.
    backups = ordered
      .filter(c => not already selected AND providerDiversityCheck(c, selected))
      .take(2)
    selected.push(...backups.map(c => ({ candidate: c, role: 'backup' })))

  // 5. Feasibility verdict
  confidence = min(coveredTokens / max(targetTokens,1), coveredRequests / max(targetRequests,1))
  feasible = confidence >= 1.0

  if !feasible AND goal.budgetPref == 'free':
    // 6. Gap-closing suggestion: find the CHEAPEST paid candidate that closes
    //    exactly the remaining gap, computed but NOT auto-added.
    gapSuggestion = findCheapestGapCloser(candidates, remainingTokenGap, remainingRequestGap)

  // 7. Determine internal routing policy from goal preferences (see §6)
  policy = selectPolicy(goal)

  return {
    steps: selected,
    policy,
    projectedDailyTokenCapacity: coveredTokens,
    projectedDailyRequestCapacity: coveredRequests,
    confidenceScore: confidence,
    feasible,
    estimatedMonthlyCostUsd: sum(selected paid candidates' cost),
    gapSuggestion,
    decisionTrace: [ ...per-step reasoning strings... ],
    warnings: [ ...e.g. "only 1 provider covers your task type; reliability risk" ... ]
  }
}
```

### 5.3 Testing requirements for the solver

- Fixture-based unit tests covering: (a) trivially feasible goal with abundant free capacity, (b) infeasible free goal requiring a gap suggestion, (c) `reliabilityPref: maximum` correctly adds diverse backups rather than duplicate-provider backups, (d) `exhaustionPref: fill_first` vs `preserve_backup` produce different `policy` outputs, (e) empty candidate pool returns a clean infeasible result (no throw), (f) budget cap correctly excludes paid candidates once cumulative cost would exceed `budgetCapUsdMonthly`.
- Property-based test: for any randomly generated candidate set and goal, the solver must never select a candidate with `currentHealthState == 'open'`, and `confidenceScore` must always be in `[0, +inf)`.
- Golden-set test: 5–10 hand-curated realistic scenarios (e.g. exactly the "4,000 requests/day, 10M tokens/day, coding agent, free, preserve backup" example from product discovery) with an expected provider set, reviewed and locked as regression fixtures.

---

## 6. Routing Policies (collapsed from the competitor's 19 strategies to 5)

Users never pick a strategy name. `selectPolicy(goal)` maps goal preferences to one of these five internal policies. Each policy is a pure function: `(steps: PoolStep[], liveState: LiveState) => PoolStep[]` producing an ordered dispatch list for a single request.

| Policy | Selected when | Behavior |
|---|---|---|
| `fill_first` | `exhaustionPref: fill_first` | Saturate step 1 until its quota/health signals unavailability, then move to step 2, etc. |
| `balanced` | `exhaustionPref: preserve_backup`, `reliabilityPref: standard` | Weighted round-robin across primary steps, proportional to remaining daily capacity, to avoid any single provider being burned down before the day's end. |
| `fastest` | `latencyPref: instant` | Order live-eligible steps by `benchTtftMs` ascending; still respects health/quota gating. |
| `cheapest` | `budgetPref: capped` and cost is the binding constraint | Order by `costPerRequestUsd` ascending among eligible steps. |
| `auto_score` | `reliabilityPref: maximum` OR mixed/conflicting preferences | 6-factor weighted scorer (below) — the only policy that runs the full `ScoringEngine`. |

### 6.1 `auto_score` — the 6-factor scorer

Deliberately smaller than the competitor's 16 factors. Every factor must be justifiable to a user in one sentence if they click "why."

| Factor | Weight (default) | Signal | User-facing explanation |
|---|---|---|---|
| `quotaHeadroom` | 0.25 | Remaining capacity / limit, this window | "This provider has plenty of room left today." |
| `health` | 0.25 | Circuit breaker state (closed=1, half_open=0.5, open=0) | "This provider has been reliable in the last few minutes." |
| `latencyFit` | 0.20 | Inverse normalized p95 latency vs pool | "This provider responds quickly." |
| `taskFit` | 0.15 | Task-type fitness score from catalog | "This model is well-suited for coding tasks." |
| `costEfficiency` | 0.10 | Inverse normalized blended cost | "This is a cost-efficient option." |
| `stability` | 0.05 | Inverse latency variance | "This provider's response time is consistent." |

Weights are stored as config, renormalized to sum to 1.0 if any factor is disabled (e.g., cost factor is meaningless for an all-free pool and should be redistributed, not silently left at 0.10 unused weight).

**Explicitly deferred to v2 (do not build now):** bandit exploration, Arena ELO sync, prompt-cache affinity, quota-share DRR across multiple API keys on one connection. These are real ideas from competitive research but add complexity disproportionate to current value — see §11 ADR template for how to propose adding them later.

---

## 7. Resilience Stack

### 7.1 Circuit Breaker (per `provider_connection`)

Pure finite state machine, injected clock for testability.

```
States: CLOSED -> OPEN -> HALF_OPEN -> (CLOSED | OPEN)

CLOSED:
  - requests flow normally
  - each failure increments consecutive_failures
  - consecutive_failures >= threshold (default 5) -> transition to OPEN, record opened_at

OPEN:
  - requests to this connection are skipped at the routing layer (not attempted)
  - if now >= opened_at + cooldownMs -> transition to HALF_OPEN (lazy, checked on read — no background timer)

HALF_OPEN:
  - exactly one probe request is allowed through
  - probe succeeds -> CLOSED, consecutive_failures = 0
  - probe fails -> OPEN again, cooldown doubles (exponential, capped at maxCooldownMs)
```

Only these HTTP outcomes count as breaker-tripping failures: `408, 429 (only if no Retry-After and repeated), 500, 502, 503, 504`, and connect/read timeouts. Authentication failures (`401`, `403`) and terminal states (credential revoked) do **not** trip the breaker — they mark the connection `expired`/`banned` in `provider_connections.status` directly, because retrying a dead credential is never useful.

### 7.2 Cooldown (finer-grained than the breaker — per attempt)

Independent of the breaker, every failed dispatch attempt sets a short cooldown on that specific connection so back-to-back requests in the same pool don't hammer a momentarily-rate-limited provider while the breaker is still counting toward its threshold.

```
cooldownMs = baseCooldownMs * 2^failureIndex   (capped at maxCooldownMs, default 30s)
baseCooldownMs: 3000 for API-key connections, 5000 for OAuth connections
Reset: any successful request against the connection clears failureIndex to 0.
Respect upstream Retry-After header when present — it overrides the computed value.
```

### 7.3 Fallback Dispatch Loop (in `gatewayService`)

```
function dispatch(pool, request):
  orderedSteps = policy(pool.steps, liveState)   // §6

  for step in orderedSteps:
     if breaker(step.connection).state == OPEN: continue
     if cooldown(step.connection).active: continue
     if quota(step.connection).wouldExceed(request): continue

     try:
        response = await callProvider(step, request, timeout=configuredTimeout)
        recordSuccess(step.connection)
        recordQuotaUsage(step.connection, response.usage)
        return { response, decisionTrace }
     catch (err):
        recordFailure(step.connection, err)
        decisionTrace.push({ step, err, skippedReason: null })
        continue  // fall through to next step

  throw AllTargetsExhaustedError(decisionTrace)  // surfaced as HTTP 503 with a clear body
```

This loop, the breaker, and the cooldown module must have a **chaos test suite** (see §9) that simulates: all providers down, one flaky provider (intermittent 500s), a provider that times out but never errors, and a provider whose credential is revoked mid-session.

---

## 8. Quota Tracking

Sliding-window counter, computed on read, no background sweep required for correctness (background cleanup is only for disk hygiene).

```typescript
function computeWindowUsage(dimension: QuotaDimension, now: number): number {
  const windowStart = Math.floor(now / dimension.windowSeconds) * dimension.windowSeconds;
  const prevWindowStart = windowStart - dimension.windowSeconds;

  const current = getUsage(connectionId, dimension, windowStart);
  const previous = getUsage(connectionId, dimension, prevWindowStart);

  // Blended sliding window: weight the previous window by how much of it
  // still "overlaps" conceptually with a trailing N-second view, to avoid
  // the hard-reset cliff at window boundaries.
  const elapsedIntoWindow = now - windowStart;
  const weight = 1 - (elapsedIntoWindow / dimension.windowSeconds);
  return current + previous * weight;
}

function wouldExceed(dimension, now, incomingAmount): boolean {
  return computeWindowUsage(dimension, now) + incomingAmount > dimension.limitValue;
}
```

- `daily_tokens` and `daily_requests` dimensions use `reset_anchor: fixed_utc_midnight` when the provider's own quota resets at a fixed time (common case); `rpm`/`tpm` dimensions use `rolling`.
- Quota consumption is recorded **after** a successful response (fire-and-forget from the hot path's perspective, but must not be lost — write synchronously to SQLite since `better-sqlite3` writes are fast enough at this scale; do not add an async queue that can lose writes on crash).
- **Fail-open policy**: if the quota store throws on read (corrupted row, disk issue), treat as "unknown, allow" and log a warning — never let quota-tracking failure take down the gateway. This mirrors a deliberate, documented choice, not an oversight.

Multi-key fair-share (splitting one provider's quota fairly across multiple GoalRoute-issued API keys) is **out of scope for v1** — GoalRoute v1 is single-tenant per deployment. Document this as a known limitation in `docs/glossary.md`, not a silent gap.

---

## 9. The Request Pipeline (hot path)

```
POST /v1/chat/completions
  -> Fastify schema validation (Zod) — reject malformed bodies with 400 before touching services
  -> auth: resolve GoalRoute API key -> pool binding
  -> gatewayService.dispatch(pool, request):
       -> resolve ordered targets via routing policy (§6)
       -> for each target: breaker check -> cooldown check -> quota check -> translate request format (§9.1) -> call provider -> translate response format
       -> on all-exhausted: return structured 503 with decisionTrace summary (not raw provider errors)
  -> stream response back (SSE passthrough) or return JSON
  -> after completion (success or failure): write request_logs row (async-safe, but synchronous write to SQLite)
```

### 9.1 Format Translation

v1 supports **OpenAI-compatible request/response** as the canonical internal shape (since that's what coding agents speak), with per-provider adapters translating to/from:
- OpenAI-shaped providers: passthrough with model-id substitution only.
- Anthropic-shaped providers: adapter maps `messages[]` + `system` + tool schema differences.
- Gemini-shaped providers: adapter maps `contents[]` + role naming differences.

Each adapter lives in `src/domain/translation/` as a pure function pair (`toProviderFormat`, `fromProviderResponse`) with contract tests against real captured sample payloads (stored in `tests/fixtures/provider-samples/`, redacted of any real keys).

---

## 10. CLI Specification (this is your primary interface for Phase 1–2 testing)

```bash
# Provider & connection management
goalroute provider list
goalroute provider add <provider-slug> --label "My Groq" --key <API_KEY> [--tier free|paid]
goalroute provider test <connection-id>          # live credential check, updates status
goalroute provider remove <connection-id>

# Catalog
goalroute catalog sync                           # reload providers.seed.json / models.seed.json
goalroute catalog show <provider-slug>

# Goals
goalroute goal create \
    --task coding_agent \
    --requests-per-day 4000 \
    --tokens-per-day 10000000 \
    --latency instant \
    --budget free \
    --exhaustion preserve_backup \
    --reliability maximum
goalroute goal solve <goal-id>                   # dry run — prints PoolPlan, does NOT persist a pool
goalroute goal list

# Pools
goalroute pool create --from-goal <goal-id>       # persists the solved plan as an active pool
goalroute pool list
goalroute pool show <pool-id>                     # steps, policy, projected capacity
goalroute pool test <pool-id> --count 10          # fires N synthetic requests, prints per-request routing decision + latency
goalroute pool deactivate <pool-id>

# Live gateway testing
goalroute route --pool <pool-id> --prompt "Write a hello world in Rust"
                                                   # sends one real request, prints: chosen provider/model,
                                                   # latency, tokens, decisionTrace, and full response

# Observability
goalroute status                                  # health state + quota headroom for every connection
goalroute simulate --pool <pool-id> --day         # projects a full day of the goal's target load against
                                                   # current quota state; reports whether it would exhaust
                                                   # and at what time

# Server
goalroute serve --port 8787                        # boots the Fastify HTTP API + gateway endpoint
```

Every CLI command must have a corresponding `--json` output flag for scriptability, since this is explicitly meant to be tested and iterated on programmatically before any UI exists.

---

## 11. HTTP API Surface

```
# Gateway (OpenAI-compatible — this is what coding agents point at)
POST   /v1/chat/completions

# Management API
GET    /api/v1/providers
POST   /api/v1/providers
POST   /api/v1/providers/:id/test
DELETE /api/v1/providers/:id

GET    /api/v1/catalog/providers
GET    /api/v1/catalog/models

POST   /api/v1/goals
GET    /api/v1/goals
GET    /api/v1/goals/:id
POST   /api/v1/goals/:id/solve          # dry run, returns PoolPlan

POST   /api/v1/pools                    # create from a solved plan or manually
GET    /api/v1/pools
GET    /api/v1/pools/:id
POST   /api/v1/pools/:id/test
POST   /api/v1/pools/:id/simulate

GET    /api/v1/health                   # per-connection health + quota headroom
GET    /api/v1/request-logs?poolId=&limit=
```

All management endpoints require an admin bearer token (separate from the per-pool gateway API keys used against `/v1/chat/completions`). Define this in `config.ts` and fail boot if unset in non-dev environments.

### 11.1 Architecture Decision Records (ADRs)

Every non-trivial deviation from this spec, or every deferred feature that later gets built, must get a short ADR in `docs/adr/NNNN-title.md`:

```markdown
# ADR 0001: <decision title>
Status: Accepted | Superseded | Deferred
Context: <what problem forced this decision>
Decision: <what was chosen>
Consequences: <tradeoffs accepted>
```

This is what keeps the codebase maintainable as it grows past the point where any one person (or one Antigravity session) holds the whole design in their head.

---

## 12. Configuration & Secrets

```
# .env.example
NODE_ENV=development
PORT=8787
DATABASE_PATH=./data/goalroute.db
ENCRYPTION_MASTER_KEY=          # required, 32-byte hex, fail boot if missing/wrong length
ADMIN_API_TOKEN=                # required, fail boot if missing in production
LOG_LEVEL=info
DEFAULT_PROVIDER_TIMEOUT_MS=30000
CIRCUIT_BREAKER_FAILURE_THRESHOLD=5
CIRCUIT_BREAKER_BASE_COOLDOWN_MS=30000
```

`config.ts` loads and validates all of this with Zod **at process boot**, before the HTTP server starts listening — an invalid or missing required config value must crash the process immediately with a clear message, never fail lazily on first request.

---

## 13. Observability

- Structured JSON logs (`pino`) with a `requestId` (ULID) attached to every log line within a single dispatch, so a full request's journey through breaker checks, quota checks, provider calls, and fallbacks can be reconstructed by grepping one ID.
- `GET /api/v1/health` doubles as both a human-readable status endpoint and the liveness/readiness probe target for future deployment (Docker healthcheck).
- `decisionTrace` (§4) is the core explainability artifact — store it, don't just log it, so `pool show` / `request-logs` can replay *why* a routing decision happened days later.

---

## 14. Testing Strategy Summary

| Layer | What's tested | Tooling |
|---|---|---|
| `domain/*` | Pure logic: solver, scorer, breaker FSM, quota math, translation adapters | `vitest`, fixture-based, property-based where noted (§5.3) |
| `infra/*` | Repositories against a real temp-file SQLite; vault encrypt/decrypt round-trip | `vitest` + temp DB per test file |
| `services/*` | Orchestration correctness with mocked infra (fake provider HTTP client) | `vitest` + hand-written fakes (avoid heavy mocking frameworks) |
| Chaos suite | All-providers-down, flaky provider, silent timeout, credential revoked mid-session, quota exhausted mid-request | Dedicated `tests/chaos/` harness with a fake provider server that can be told to misbehave on command |
| Contract tests | Real captured provider request/response payloads translate correctly in both directions | `tests/fixtures/provider-samples/` |
| Golden-set | Locked realistic goal → expected pool plan scenarios | `tests/unit/domain/goal/solver.golden.test.ts` |

**Acceptance bar for "production grade":** the domain layer should be at or near 100% branch coverage (it's pure, there's no excuse). Infra/services should be tested at the level of "every failure mode a provider can realistically produce has an explicit test."

---

## 15. Phased Build Plan (for Antigravity to execute sequentially)

Each phase has a **Definition of Done**. Do not proceed to the next phase until the current one's DoD is fully met and its tests pass. Commit after each phase.

### Phase 0 — Scaffold
- Repo structure per §3, `package.json`, `tsconfig.json`, lint/format config, `vitest` config, `.env.example`.
- `config.ts` with Zod validation and fail-fast boot behavior.
- `logger.ts` with redaction serializer (write a test that proves a fake secret string never appears in log output even when passed as a nested object field).
- Migration runner + `0001_init.sql` (full schema from §4).
- **DoD**: `npm run build` succeeds; `npm test` runs (even with zero tests) against a clean checkout; booting with a missing required env var crashes with a readable error.

### Phase 1 — Provider & Credential Management
- `vault.ts` (AES-256-GCM encrypt/decrypt) with round-trip tests.
- `providerRepo`, `connectionRepo`.
- `providerService`: add/list/test/remove connection.
- CLI: `provider add|list|test|remove`.
- **DoD**: can add a real provider connection via CLI, key is stored encrypted (verify by inspecting the raw DB file — it must not be plaintext), `provider test` makes a real lightweight call (e.g. a models-list endpoint) and updates status.

### Phase 2 — Catalog
- `providers.seed.json`, `models.seed.json` with a small but real curated set (start with 5–8 well-known free-tier-friendly providers, not 356 — quality over quantity at this stage).
- `catalogService`: load, validate against Zod schema, upsert into `providers`/`models` tables.
- CLI: `catalog sync|show`.
- **DoD**: `catalog sync` populates the DB from seed files idempotently (running twice produces no duplicates).

### Phase 3 — Resilience Core
- `circuitBreaker.ts` (pure FSM, injectable clock) + full unit test suite covering every transition in §7.1.
- `cooldown.ts` + tests.
- `slidingWindow.ts` (quota math, §8) + tests including boundary-crossing scenarios.
- `healthRepo`, `quotaRepo` wiring these to persistence.
- **DoD**: a scripted test proves that after N configured consecutive failures the breaker opens, requests are skipped while open, and it transitions to half-open after the cooldown elapses — all driven by a `TestClock`, no real `sleep()` calls in tests.

### Phase 4 — Routing & Dispatch
- `translation/*` adapters for OpenAI + Anthropic formats first (Gemini can follow in a later pass), with contract tests against real sample payloads.
- All 5 routing policies (§6) as pure functions + tests.
- `gatewayService.dispatch()` implementing the fallback loop (§7.3).
- `providerClient.ts` (real outbound HTTP with timeout).
- CLI: `route --pool <id> --prompt "..."` for manual live testing.
- **DoD**: `goalroute route` against a pool with 2+ real connections successfully completes a request, and manually killing/misconfiguring the first connection's key causes visible fallback to the second (verify via `decisionTrace` printed to stdout).

### Phase 5 — Goal Solver
- Full `GoalSolver` implementation per §5.
- `ScoringEngine` (6-factor) per §6.1.
- Exhaustive unit + property + golden-set tests per §5.3.
- CLI: `goal create|solve|list`.
- **DoD**: the exact worked example from product discovery ("coding agent, 4000 req/day, 10M tokens/day, free, preserve backup, max reliability") run through `goal solve` produces a sensible, explainable `PoolPlan` referencing real seeded providers, with a `decisionTrace` that reads coherently.

### Phase 6 — Pools
- `poolService`: create from solved goal, or manually; activate/deactivate.
- `poolRepo`, `pool_steps` persistence.
- CLI: `pool create|list|show|test|deactivate`.
- **DoD**: `pool create --from-goal` persists a working pool that `goalroute route` can immediately dispatch against.

### Phase 7 — HTTP API
- Fastify server bootstrap, all routes from §11, request-id middleware, centralized error handler (never leak stack traces to clients).
- `/v1/chat/completions` as the OpenAI-compatible gateway endpoint, backed by the same `gatewayService.dispatch()` used by the CLI.
- **DoD**: pointing a real OpenAI-SDK client (or `curl`) at `POST /v1/chat/completions` with a pool-bound API key produces a correct streaming response, and the same request replayed via `goalroute route` produces an equivalent result — proving CLI and API are true peers over one service layer.

### Phase 8 — Observability & Simulation
- `request_logs` writes wired into the dispatch loop.
- `GET /api/v1/health`, `goalroute status`.
- `simulate` command/endpoint (§10) — project a day of goal-target load against current live quota state.
- **DoD**: `goalroute simulate --pool <id> --day` gives a believable projection and correctly flags a pool that would exhaust before end-of-day given seeded quota limits.

### Phase 9 — Hardening Pass
- Full chaos test suite (§9/§14).
- Security review pass: confirm no secret ever appears in logs, error responses, or `decisionTrace` output; confirm SQL injection is impossible (parameterized queries only, no string concatenation — grep for it).
- Load smoke test: sustained request rate against a pool with a deliberately flaky fake provider to confirm the breaker/cooldown/fallback stack behaves under real concurrency, not just single-threaded test scenarios.
- Write `docs/runbook.md`: how to add a new provider, how to rotate the encryption master key, how to read a `decisionTrace`, how to interpret circuit breaker state in production.
- **DoD**: every item in §0 (Non-Negotiable Engineering Principles) has a corresponding passing test or documented verification step.

---

## 16. Explicit Non-Goals for v1

State these clearly so scope doesn't creep mid-build:

- No multi-tenancy / user accounts / billing.
- No OAuth-based provider connections (API-key only for v1; OAuth is a well-scoped Phase 10+ addition).
- No compression/prompt-optimization layer.
- No MCP server, no agent protocols (A2A/ACP), no embedded service sidecars.
- No web-session/browser-impersonation provider transports.
- No horizontal scaling / multi-node deployment (single SQLite file, single process).
- No UI. This entire document is backend-only, verified through CLI and raw HTTP calls.

---

## 17. Glossary (seed content for `docs/glossary.md`)

- **Goal**: a user's plain-language target (volume, latency, budget, reliability preferences) that the solver turns into a pool.
- **Pool**: a named, ordered set of provider+model targets (`pool_steps`) with an assigned routing policy — the thing that actually serves traffic.
- **Connection**: one authenticated credential against one provider (a user can have multiple connections to the same provider, e.g. two Groq accounts).
- **Policy**: the algorithm used to pick which pool step handles a given request (§6).
- **Decision trace**: the recorded, human-readable reasoning behind a solver recommendation or a live routing decision.
- **Breaker state**: whether a connection is currently trusted (`closed`), untrusted (`open`), or being cautiously re-tested (`half_open`).

---

*End of specification. This document is the source of truth for Phase 0–9. Any deviation during implementation should be captured as an ADR (§11.1) rather than silently diverging from this spec.*
