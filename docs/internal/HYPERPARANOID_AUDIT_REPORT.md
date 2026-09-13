# GoalRoute Hyper-Paranoid Adversarial Audit Report

**Payload:** Full read-only adversarial audit of the GoalRoute multi-provider LLM gateway.
**Audit class:** Hyper-paranoid — assumes hostile callers, hostile upstreams, hostile payloads, and adversarial concurrency.
**Scope:** `d:\FreeLLM-Gateway` (Fastify 5 + better-sqlite3 + zod; TypeScript ESM).
**Baseline verified:** commit `68d4c8102cf394be48fcfb5fee8ad8c7373c30f0` (branch `main`).
**Code-change policy:** This audit is strictly read-only. Zero code modifications were made. Confirmed via `git status --porcelain` → clean, and full test suite execution.

---

## Table of Contents

1. [Executive Verdict](#1-executive-verdict)
2. [Scope & Evidence Base](#2-scope--evidence-base)
3. [Forensic Probe Analysis — Vector 1: Concurrency Storm & Quota Race](#3-forensic-probe-analysis--vector-1-concurrency-storm--quota-race)
4. [Forensic Probe Analysis — Vector 2: Slow-Loris & Memory Leak Torture](#4-forensic-probe-analysis--vector-2-slow-loris--memory-leak-torture)
5. [Forensic Probe Analysis — Vector 3: Parser Crash & Error-Hygiene Torture](#5-forensic-probe-analysis--vector-3-parser-crash--error-hygiene-torture)
6. [Forensic Probe Analysis — Vector 4: Security & Credential Torture](#6-forensic-probe-analysis--vector-4-security--credential-torture)
7. [Forensic Probe Analysis — Vector 5: Data Integrity & Persistence Torture](#7-forensic-probe-analysis--vector-5-data-integrity--persistence-torture)
8. [Latent Concurrency & Security Vulnerabilities (Deep-Dive)](#8-latent-concurrency--security-vulnerabilities-deep-dive)
9. [Complete File-by-File Anatomy & Findings Register](#9-complete-file-by-file-anatomy--findings-register)
10. [Remediation Checklist](#10-remediation-checklist)
11. [Test-Suite Validation](#11-test-suite-validation)

---

## 1. Executive Verdict

| Metric | Result |
|---|---|
| **Final Status** | **DEFECTS FOUND** |
| Probes Executed | 5 |
| Probes Passed | 1 |
| Probes Failed | 3 |
| Probes Warned | 1 |
| Test Files | 16 / 16 passed |
| Tests | 74 / 74 passed |
| Runtime | 1.20 s |

### High-Consequence Vulnerabilities

1. **Unauthenticated Management Plane** — `ADMIN_API_TOKEN` is validated at boot but never enforced. Any caller can exfiltrate request logs, write provider credentials, and burn upstream quota for free.
2. **Quota Check-Then-Act Race (TOCTOU)** — the gate/dispatch/record sequence is non-atomic and spans a network `fetch`, enabling unlimited concurrent overdraft of every quota dimension.
3. **Half-Open Circuit-Breaker Thundering Herd** — per-request reconstruction of the breaker destroys the single-probe invariant; concurrent requests all probe at once.
4. **Three Unbounded Memory Vectors** — uncapped chunked upstream reads, unbounded SSE line-buffer, and ignored socket write backpressure combine into a reliable OOM path.

### What Is Rock-Solid (credit where due)

- **Credential cryptography:** AES-256-GCM, 96-bit random IV, hard-key-length enforcement (32 bytes), encrypted at-rest credentials.
- **Boot-time configuration enforcement:** 64-hex master-key validation; production refuses the default admin token.
- **Defense-in-depth log redaction:** key-name + pattern (bearer / `sk-*` / `sk-ant-*` / `AIza*` / `gsk_*` / `hf_*` / query-param) scrubbing with circular-reference protection.
- **Migration integrity:** immutable checksummed migrations executed in transactions.
- **SSE parser resilience:** all parser branches are exception-guarded with graceful fallbacks.
- **Error-surface hygiene:** upstream errors are sanitized, size-capped, and type-tagged before propagation.

---

## 2. Scope & Evidence Base

### Files Forensically Reviewed

| File | Role |
|---|---|
| `src/api/server.ts` | HTTP entrypoint, routing, SSE relay, error handler |
| `src/services/gatewayService.ts` | Dispatch engine (sync + stream), fallback, tracing, quotas |
| `src/infra/http/providerClient.ts` | Upstream HTTP + streaming client |
| `src/domain/translation/sseStream.ts` | SSE transform, usage accounting, finish-reason merging |
| `src/domain/quota/slidingWindow.ts` | Sliding-window arithmetic |
| `src/infra/db/client.ts` | SQLite bootstrap, pragmas |
| `src/infra/db/migrationRunner.ts` | Migration application |
| `src/infra/db/repositories/*` | Persistence repositories (providers, connections, models, pools, health, quota, logs) |
| `src/infra/security/vault.ts` | AES-256-GCM credential envelope |
| `src/infra/config.ts` | Env schema / boot validation |
| `src/infra/logger.ts` | Redacting logger |
| `src/domain/resilience/circuitBreaker.ts` | Circuit-breaker state machine |
---

## 3. Forensic Probe Analysis — Vector 1: Concurrency Storm & Quota Race

**Status: FAIL**

### Exact Mechanical Description

The non-streaming dispatch path in `src/services/gatewayService.ts` executes this read → think → act → write sequence:

```
gatewayService.ts:178   getPolicy('daily_tokens')
gatewayService.ts:182   getUsage(conn, window)
gatewayService.ts:183   getUsage(conn, previousWindow)
gatewayService.ts:185   wouldQuotaExceed(limit, usage, estimatedTokens)
gatewayService.ts:215   await callProviderEndpoint(...)   ← network await
gatewayService.ts:241   tokensUsed = oaiResponse.usage?.total_tokens ?? 0
gatewayService.ts:251   recordUsage('daily_tokens', tokensUsed)
gatewayService.ts:252   recordUsage('daily_requests', 1)
```

The streaming path (`dispatchStream`, `:478-549`) repeats the identical pattern, shifting the record step into the `onUsage` SSE callback.

Each `better-sqlite3` statement is individually atomic, but the full sequence is **not** wrapped in `db.transaction()` and *cannot* be — it spans an `await fetch()`. Under concurrency the invariant "total recorded ≤ limit" is therefore unenforceable.

**Concurrent execution arithmetic.** If `N` requests arrive inside the gate window with identical usage, every one of them reads the same uncommitted `used_value` and every one passes `wouldQuotaExceed`. After the network round-trip, each writes its own `tokensUsed`. Total recorded usage overshoots the limit by roughly $(N-1) \times \text{max\_tokens}$. With `max_tokens` defaulting toward 1000+ and `N` large, the overshoot is arbitrarily large — this is not a "slight drift," it is an unbounded overdraft.

### Secondary Defects in the Same Vector

1. **Gate-estimate / record divergence.** The gate estimates `request.max_tokens || 1000` (`:180`, `:482`), but the record step honours the provider's reported `usage`. If a provider omits `usage`, the code logs a warning and records **0 tokens** (`:244`, comment explicitly states this). Attackers or buggy providers that suppress `usage` evade the token quota entirely while still consuming upstream credits.
2. **Global credential-poisoning set.** `locallyExpiredConnectionIds` (`gatewayService.ts:37`) is a process-global `Set<string>`:
   - **Unbounded growth:** entries are only ever added (`:296`, `:611`), never pruned → slow memory leak.
   - **Cross-pool contamination:** a 401 observed from pool A removes the connection from pool B's candidate set silently, even if it is healthy for B's models.
   - **Redundancy:** the DB status is already updated to `expired` at the same site (`:297`, `:612`), so the in-memory Set is functionally redundant *except* as an in-flight short-circuit for concurrent requests (which `tests/unit/ironclad_fixes.test.ts:130-141` depends on).
3. **Half-open circuit-breaker thundering herd.** The breaker is instantiated fresh on every request (`:77-81`, `:144-148`, `:448-452`) hydrated from the DB snapshot. The single-probe invariant lives in the instance-level flag `halfOpenProbeActive` (circuitBreaker.ts:92-96). Because each request builds a *new* instance with `halfOpenProbeActive = false`, `allowRequest()` returns `true` for **every** concurrent request during `half_open`. The result: `K` simultaneous upstream probes instead of exactly one. Blocking/cooldown still works via `cooldown_until`, but the breaker's defining behavioural guarantee does not survive concurrency.

### Reproduction Proof

- Deterministic by code trace (see the interleaving above); no mock is required to prove the ordering.
- Test suite gap: `tests/chaos/resilienceChaos.test.ts` and `tests/unit/quotaAndSecurity.test.ts` exercise **serialized** dispatch only. There is **no parallel-dispatch test**, so none of the three defects above is observable in CI. All 74 tests pass against code that is provably racy.

---

## 4. Forensic Probe Analysis — Vector 2: Slow-Loris & Memory Leak Torture

**Status: FAIL**

### Exact Mechanical Description

**Slow-loris (the standard mitigation is absent):** `Fastify()` is constructed at `server.ts:48-51` with only `logger: false` and `genReqId`. Fastify 5's default `requestTimeout` is `0` (disabled) and no `connectionTimeout` is set. A client that sends HTTP headers byte-by-byte and stalls mid-headers holds a socket indefinitely — a textbook Slowloris. (`bodyLimit` defaults to 1 MB, which is adequate for request bodies, but header drip is not bounded by it.)

**Uncapped upstream read (non-stream path):** `providerClient.ts:91-105`:

```
if (contentLengthHeader) {
  if (contentLength > 15MB) throw ...   ← guard fires ONLY when header present
}
data = contentType.includes('application/json')
  ? await response.json()
  : await response.text();              ← chunked responses skip the guard entirely
```

A malicious or compromised upstream that omits `content-length` (or uses `Transfer-Encoding: chunked`) streams an unbounded body that is buffered whole into memory by `.json()`/`.text()`. This is a remote, triggerable OOM.

**SSE line-buffer bomb:** in `sseStream.ts:64-69`:

```
for await (const chunk of upstreamStream) {
  textChunk = ...
  buffer += textChunk;
  const lines = buffer.split(/\r?\n/);
  buffer = lines.pop() ?? '';   ← the trailing partial line is retained
```

An upstream that emits a never-newline-terminated payload grows `buffer` without bound. Additionally, `new TextDecoder()` is allocated **per chunk** (`:65`) instead of being instantiated once per stream — a needless allocation hot-spot under high throughput.

**Slow-client backpressure:** in `server.ts:141-143` the SSE relay does `reply.raw.write(chunk)` and discards the return value, never awaiting `drain`. A client that reads at ~1 B/s while the upstream pushes tens of MB/s causes the Node socket write queue to buffer without bound → OOM.

---

## 5. Forensic Probe Analysis — Vector 3: Parser Crash & Error-Hygiene Torture

**Status: WARN**

### Exact Mechanical Description

**The one unguarded parser crash:** `gatewayService.ts:100` and `:405`:

```
const taskFitnessMap = JSON.parse(mdl.task_fitness || '{}');
```

`mdl.task_fitness` is a DB column read via `ModelRepository.findById` with **no** try/catch around the parse. A single corrupted row (e.g., the string `"null"`, a partial `{`, or arbitrary non-JSON) throws synchronously *inside* the step-snapshot loop, before any per-step try/catch. Consequence: **every** dispatch to any pool containing that model dies with an opaque 500 — a single upstream/data-integrity fault becomes a whole-pool denial of service.

### What Passes In This Vector

- `sseStream.ts` — every `JSON.parse` is wrapped; the openai branch re-emits the raw line rather than crashing (`:263-265`); the gemini tail, anthropic branch, and openai branch all have guarded fallbacks.
- `parseRetryAfter` (`providerClient.ts:22-39`) — null-safe, validates `\d+`, and tolerates garbage (returns `undefined`).
- `sanitizeErrorMessage` (`providerClient.ts:41-51`) — HTML/JSON type discrimination, tag-stripping, whitespace collapsing, and a 60-char snippet cap.
- Centralized error handler (`server.ts:61-86`) — correctly short-circuits when headers are already sent, maps `AppError` (status/code/details) and falls back to an opaque 500 for anything else, logging at `error` level. Sound.
- Migration runner — throws on checksum mismatch (immutability), runs each migration in a transaction with a recorded checksum. Sound.

---

## 6. Forensic Probe Analysis — Vector 4: Security & Credential Torture

**Status: FAIL**

### Exact Mechanical Description

**Authentication is validated, then abandoned.** `config.ts:34-35` *enforces* that production refuses the default `ADMIN_API_TOKEN`, yet **no route or hook ever reads that token**. There is no `preHandler`/`onRequest` authorization anywhere in `server.ts`. The blast radius:

- `POST /api/v1/providers` (`server.ts:173`) — unauthenticated write of upstream connections. An attacker can add arbitrary provider endpoints, pointing the gateway's outbound calls at their own server to harvest decrypted keys or impersonate the gateway's identity.
- `GET /api/v1/request-logs` (`server.ts:186-189`) — unauthenticated read of the full decision-trace history, including prompt metadata and per-request latency/identity.
- `POST /v1/chat/completions` (`server.ts:106`) — unauthenticated, so the gateway is a free quota-burning proxy; combined with the quota TOCTOU (Vector 1), an attacker can exhaust every pool and drive providers into hard rate-limits.
- **No per-pool authorization** — any caller may target any pool by `X-GoalRoute-Pool`.
- **CORS over-permissive** — `server.ts:53` registers `@fastify/cors` with defaults, reflecting arbitrary origins on the management endpoints → browser-based CSRF/abuse surface.

### What Passes In This Vector

- **Encryption & key handling.** `vault.ts`: AES-256-GCM, 96-bit random IV per encryption, key length strictly enforced (throws `VaultError` unless exactly 32 bytes), tamper-evident via `setAuthTag`.
- **Config boot validation.** `config.ts:11-14` requires a 64-hex master key; `:34-35` hard-fails production on the default admin token.
- **Redacting logger.** `logger.ts`: (a) Pino `redact.paths` censor list, and (b) a formatter-level `redactSensitiveData` custom walker that strips key-name fields plus regex patterns for `Bearer`, `sk-`, `sk-ant-`, `AIza`, `gsk_`, `hf_`, and URL query tokens, with a `WeakSet` for circular references and `[CIRCULAR]`/`[REDACTED]` markers.
- **Error hygiene.** Upstream error text is sanitized and truncated (60-char snippet / 64 KB bound) before logging/storage; no credential echo was found in any trace.

---

## 7. Forensic Probe Analysis — Vector 5: Data Integrity & Persistence Torture

**Status: PASS (with advisory notes)**

### Exact Mechanical Description

- `client.ts:29-33`: `journal_mode = WAL`, `synchronous = NORMAL`, `foreign_keys = ON`. Correct durability/consistency profile for a gateway.
- `migrationRunner.ts:39-59`: migrations applied in sorted order, each inside a transaction, checksum recorded, and *immutability* enforced via a mismatch throw.
- `quotaRepo.ts:64-71`: UPSERT-based counter (`used_value = used_value + excluded.used_value`) is atomic per statement — the *only* safe part of the quota pipeline (see Vector 1 for the surrounding race).
- **Advisory notes:**
  1. No `busy_timeout` pragma — a second process/thread that collides on a write will surface a raw `SQLITE_BUSY` throw (failing open via the quota catch, but elsewhere it is an unhandled 500 surface).
  2. `request_logs` grows unboundedly — every record carries a JSON decision trace; without retention this becomes a disk-growth vector.

---

## 8. Latent Concurrency & Security Vulnerabilities (Deep-Dive)

### 8.1 Quota TOCTOU Overdraft (severity: high)

A `db.transaction()` **cannot** span the upstream `fetch`, so a naive wrap does not fix this. The default production pattern is a **reservation ledger**: synchronously reserve `min(estimatedTokens, remainingSlack)` in a row *before* dispatch, then settle/refund with actual usage after the response. Only that serializes the admission decision at a single atomic point per connection. Without it, concurrency converts a "limit" into a "target to overshoot by (N−1)×estimate."

**Trace:** all `N` concurrent requests read `used_value` (unchanged), all pass `wouldQuotaExceed`, all `await fetch` in parallel, then each writes its own increment. The DB ends at `used + Σ(N × token)` instead of `used + actualTokens`.

### 8.2 Half-Open Thundering Herd (severity: high)

Because the breaker is reconstructed from DB per request, `halfOpenProbeActive` is never shared. Fix options:
- Keep a long-lived in-process `Map<connectionId, CircuitBreaker>` rehydrated once from DB, or
- Persist the probe flag in the `health` table and gate admission on it.

Either restores the "exactly one probe" guarantee.

### 8.3 Global Credential Poisoning (severity: medium)

`locallyExpiredConnectionIds` is process-global and append-only. A 401 in one pool silently disables a connection in all pools until process restart, and the set grows monotonically. Fix: scope expiry per-pool, add a TTL, and rely on the authoritative DB status (already written at `:297`/`:612`).

### 8.4 OOM Triad (severity: high)

1. **Uncapped chunked upstream reads** (non-stream path) — remote OOM via `content-length` omission.
2. **Unbounded SSE line buffer** — remote OOM via a never-newline stream.
3. **Ignored `write()` backpressure** — slow-client + fast-upstream OOM.

Any single vector is sufficient to exhaust the process heap; all three are currently open.

---

## 9. Complete File-by-File Anatomy & Findings Register

### `src/services/gatewayService.ts`
- Builds per-step snapshot; quota headroom estimate is **fail-open** (correctly caught) at `:87-98` / `:391-403`.
- **Unguarded `JSON.parse(mdl.task_fitness)`** at `:100`, `:405` → **DEFECT**.
- Quota gate + record **non-atomic** at `:178-251` / `:478-549` → **DEFECT** (TOCTOU).
- **Per-request circuit breaker** at `:144-148` / `:448-452` → **DEFECT** (half-open herd).
- Terminal-auth (401 / non-WAF 403) → sets expired + mutates global set at `:295-297` / `:610-612` → **DEFECT** (global poisoning + unbounded set).
- `.html`-WAF vs real-403 discrimination at `:292-293` / `:607-608` → sound heuristic.
- Breaker-eligibility status set at `:626` — clean.
- Streaming path: success recorded only in `onDone`; failure in `onError` — but **no `[DONE]` / SSE error envelope is synthesized** for a mid-stream upstream throw (see `server.ts` relay below) → **DEFECT** (dangling stream).

### `src/infra/http/providerClient.ts`
- **Uncapped chunked response** via `.json()`/`.text()` when `content-length` absent → **DEFECT** (OOM).
- 15 MB guard reactive to `content-length` while parsing: acceptable in presence of the header, insufficient otherwise → **WARN**.
- `callProviderEndpointStream`: external `AbortSignal` bridged to internal controller with proper cleanup (`:163-169`, `:183-185`, `:213-215`) → **PASS**. Timeout → `PROVIDER_TIMEOUT` 408 on abort → **PASS**.

### `src/api/server.ts`
- No `requestTimeout` / `connectionTimeout` on Fastify → **DEFECT** (Slowloris).
- **No auth hook; CORS defaults** → **DEFECT** (critical).
- Stream relay `for await` writes with **no backpressure handling** and no mid-stream error envelope synthesis (`:141-158`) → **DEFECT** (dangling/lossy stream, OOM queue).
- Error handler `headersSent` guard + `AppError` mapping → **PASS**.

### `src/domain/translation/sseStream.ts`
- All `JSON.parse` guarded (`:86`, `:243`) with graceful fallbacks → **PASS**.
- Unbounded line-buffer accumulation (`:66-69`) + per-chunk `TextDecoder` (`:65`) → **DEFECT** (OOM + alloc churn).
- Finish-reason precedence table, token estimation on missing usage, exactly-once `reportUsage` → **PASS**.
- Note: `accumulatedContent` for tool_calls concatenates `JSON.stringify(delta.tool_calls)` into a token estimate — imprecise but bounded → **WARN**.

### `src/domain/quota/slidingWindow.ts`
- Pure, deterministic, bounds-checked arithmetic → **PASS** (the model itself is fine; the defect is entirely in how the service drives it).

### `src/domain/resilience/circuitBreaker.ts`
- State machine correct in isolation → **PASS**.
- Half-open single-probe invariant is instance-local → **DEFECT** in a service that re-instantiates per request (see Vector 1).

### `src/infra/security/vault.ts`
- AES-256-GCM with strict key-length and tamper-evident auth tag → **PASS**.

### `src/infra/db/client.ts`
- WAL + synchronous NORMAL + foreign_keys ON → **PASS**.
- Missing `busy_timeout` → **WARN**.

### `src/infra/db/migrationRunner.ts`
- Checksummed, transactional, immutable migrations → **PASS**.

### `src/infra/db/repositories/requestLogRepo.ts`
- No retention; unbounded growth → **WARN**.

### `src/infra/config.ts`
- 64-hex key + production default-token guard → **PASS**; but the admin token is **never consumed by any handler** → **DEFECT** (critical amplifier).

### `src/infra/logger.ts`
- Layered redaction (paths + custom walker + patterns + circular guard) → **PASS**.

---

## 10. Remediation Checklist

> This audit is read-only; nothing below has been applied to the codebase.

### P0 — Security (do first)
1. **Enforce authentication.** Add a `preHandler` hook that requires `Authorization: Bearer ${ADMIN_API_TOKEN}` on all `/api/v1/*` management routes; define and enforce a gateway auth policy for `/v1/chat/completions` (recommend a `GATEWAY_AUTH_REQUIRED` env toggle).
2. **Bind CORS.** Replace default `@fastify/cors` with an explicit `origin` allow-list; add `@fastify/helmet`.
3. **Cap all upstream reads.** Replace `.json()`/`.text()` with a bounded reader that counts streamed bytes (default 15 MB) regardless of `content-length`.

### P1 — Concurrency
4. **Single shared breaker per connection** (in-process `Map`) or persist the half-open probe flag in `health`, to restore the one-probe invariant.
5. **Quota reservation ledger:** reserve synchronously pre-dispatch, settle/refund post-response; record estimated tokens when the provider omits `usage`.
### P2 — Robustness
7. **Guard `JSON.parse(mdl.task_fitness)`** with try/catch + `{}` fallback at the two sites.
8. **Set `requestTimeout` / `connectionTimeout`** on Fastify (e.g., 30 s).
9. **Harden the SSE relay:** cap the line buffer (e.g., 1 MB → abort), hoist `TextDecoder` per stream, honor `write()` backpressure via `drain`, and synthesize `[DONE]`/SSE error envelope for mid-stream upstream failures (closes the dangling-stream defect).
10. **Persistence:** add `db.pragma('busy_timeout = 5000')`; add `request_logs` retention.

### Test additions (make the regressions visible)
11. Add a **concurrency-storm test**: N parallel `dispatch()` calls against a counting mock; assert recorded usage never exceeds the limit.
12. Add a **half-open parallel-probe test**: thrash `dispatch()` during `half_open`; assert exactly one upstream call.
13. Add a **chunked-upstream OOM test**: feed a no-`content-length` stream > cap; assert `PAYLOAD_TOO_LARGE` not heap exhaustion.
14. Add a **slow-client backpressure test** on the SSE relay.

---

## 11. Test-Suite Validation

Full suite executed at audit time against the untouched baseline:

```
 Test Files  16 passed (16)
      Tests  74 passed (74)
   Start at  23:16:04
   Duration  1.20s (transform 940ms, setup 0ms, collect 4.15s, tests 508ms, ...)
```

Suites run include `tests/chaos/resilienceChaos.test.ts`, `tests/integration/fullPipeline.test.ts`, `tests/unit/*` (protocol auth, quota & security, resilience/error hygiene, tools & streams, ironclad fixes), plus unit suites for vault, circuit breaker, cooldown, logger, sliding window, catalog, solver, and DB.

**Important caveat:** a green suite is **not** evidence of concurrency safety. The passing tests serialize every dispatch; the race conditions in Vectors 1 and 2 are structurally invisible to them until the regression tests in §10 are added.

---

*Report end. Strictly read-only — no source file was modified; working tree verified clean at commit `68d4c8102cf394be48fcfb5fee8ad8c7373c30f0`.*

### Evidence Collection Method

- Static source trace of every request path from socket to storage.
- Live execution of the full test suite (see §11).
- Threat-model-driven probes (the five vectors below), each with an exact mechanical description, an exploit/reproduction path, and a PASS / FAIL / WARN status.