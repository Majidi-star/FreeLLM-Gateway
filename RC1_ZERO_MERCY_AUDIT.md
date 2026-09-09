# RC1 Zero-Mercy Production Audit — FreeLLM-Gateway (GoalRoute)

**Auditor:** Principal Staff Systems & Offensive Security review (static read-only audit)
**Scope:** entire repo — `src/` backend, `src/web/` frontend, infra, build artifacts.
**Mode:** read-and-analyze only. No codebase files were modified. This markdown is the sole file created.
**Prior art consulted:** `RC1_PRODUCTION_AUDIT_REPORT.md`, `HYPERPARANOID_AUDIT_REPORT.md` — findings already remediated there (atomic `reserveQuota`, `?token=` SSE auth, SSE retry cap, CORS hardening) are confirmed fixed in current code and are **not** re-reported.

---

## VERDICT: **NOT RC1-READY — 3 Critical / High, 6 Medium, 7 Low**

The vault cipher, quota atomic-reservation primitive, migration runner, and React error boundary are sound. The remaining defects are concentrated in **quota settlement arithmetic**, **secret exposure via the SPA bundle**, and **stream lifecycle accounting**.

---

# 1. CRITICAL & HIGH FINDINGS

## H1. Quota double-settlement on aborted/errored streams → negative `used_value` (quota underflow / data corruption)
- **Files:** `src/services/gatewayService.ts:704-779` (callbacks wired at `:712`, `:762`), `src/domain/translation/sseStream.ts:315-322`, `src/infra/db/repositories/quotaRepo.ts:64-72`
- **Mechanism:** In `dispatchStream`, two independent settlement paths exist:
  1. `onUsage` (line 708-712) records the **real delta** `usage.totalTokens - estimatedTokens`.
  2. `onError` (line 760-763) refunds the **full estimate**: `recordUsage(conn.id, 'daily_tokens', currentWindowStart, -estimatedTokens)`.

  In `transformToOpenAISSEStream`, the generator's `catch` block (line 317-319, calls `onError`) runs **before** the `finally` block (line 320-322, calls `reportUsage` → `onUsage`). So any stream that delivers partial usage and then throws (client disconnect → upstream fetch `AbortError`, upstream mid-stream reset, 1MB buffer overflow at `sseStream.ts:69-71`) triggers **both** callbacks:

  ```
  net = (actual - estimated)  +  (-estimated)  = actual - 2*estimated
  ```

  With the common case of a client dropping at ~0 delivered tokens and `estimatedTokens = max_tokens || 1000`, the row is driven to **−2000**, permanently inflating headroom in `quotaRemainingPct` (`gatewayService.ts:560`). Repeated abuse (open stream, kill connection) drives per-connection recorded usage arbitrarily negative → **quota ceiling permanently defeated** for that connection.
- **Additional trigger:** in the non-stream path (`gatewayService.ts:285-287, 411`) the quota gate **fails open** when `getPolicy` throws (reserve never executed), but the catch at `:410-414` still refunds `-estimatedTokens` unconditionally → inserts a fresh `quota_usage` row with negative `used_value` (`recordUsage` INSERT branch has no floor guard).
- **Fix:** make settlement idempotent and single-path. Track settlement state per dispatch and clamp refunds:
  ```ts
  // gatewayService.ts — dispatchStream
  let settled = false;
  const settleDelta = (delta: number) => {
    if (settled) return;
    settled = true;
    this.quotaRepo.recordUsage(conn.id, 'daily_tokens', currentWindowStart, delta);
  };
  // onUsage:   settleDelta(usage.totalTokens - estimatedTokens)
  // onError:   settleDelta(-estimatedTokens)   // whichever fires first wins; never both
  ```
  Additionally guard the refund sites (`:411`, `:762`, `:789`) with a boolean set **only when `reserveQuota` actually returned true**, and add a floor to `recordUsage`:
  ```ts
  // quotaRepo.ts
  ON CONFLICT(connection_id, dimension, window_start) DO UPDATE SET
    used_value = MAX(0, used_value + excluded.used_value)
  ```

## H2. Admin API token is compiled into the shipped SPA bundle
- **Files:** `src/web/components/cockpit/CockpitDashboard.tsx:105`, `src/web/components/vault/CredentialVault.tsx:84`, `src/vite-env.d.ts:4`
- **Mechanism:** Both components read `import.meta.env.VITE_ADMIN_TOKEN`. Vite statically inlines every `VITE_*` variable into the production JS at build time. The production bundle in `dist/assets/index-*.js` therefore **contains the full admin credential** (or, if unset, the workstation silently degrades to unauthenticated 401s — see M1). Anyone who can load the page (or fetch the static asset) extracts the token via DevTools and gains full control of `/api/v1/providers` (delete connections), `/api/v1/pools`, and log streams.
- **Fix:** Do not ship the raw admin token. Either (a) issue a short-lived, scope-limited browser session token via a login endpoint, or (b) reverse-proxy the dashboard and strip auth client-side. Minimum interim mitigation: expose only a hashed/derived dashboard token and validate server-side against a separate `DASHBOARD_TOKEN` — never `VITE_`-prefix the admin secret.

## H3. Streamed upstream responses have no post-headers idle timeout → permanent socket/thread hang
- **Files:** `src/infra/http/providerClient.ts:223-244` (`callProviderEndpointStream`), `src/api/server.ts:186-204`
- **Mechanism:** The 30s `setTimeout(() => controller.abort())` is cleared at line 244 **as soon as response headers arrive**. The returned `response.body` stream is then pumped in `server.ts:197-203` with no watchdog. A provider that accepts the request, sends headers, then stalls mid-body (free-tier providers do this routinely under quota exhaustion) leaves the client SSE socket open **indefinitely** — no `requestTimeout` applies to the response phase. Under repeated stalls this strands sockets, `AbortController`s, and the client's `for await` loop, and the quota reservation for those tokens is never settled (see H1).
- **Fix:** implement an idle-chunk watchdog instead of a total-time timer:
  ```ts
  let idleTimer: NodeJS.Timeout;
  const resetIdle = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => controller.abort(), IDLE_TIMEOUT_MS /* e.g. 30_000 */);
  };
  resetIdle();
  const guarded = async function* () {
    for await (const chunk of response.body!) { resetIdle(); yield chunk; }
    clearTimeout(idleTimer);
  }();
  ```
  (and clear the timer in the existing `catch`/abort paths).
---

# 2. MEDIUM & LOW FINDINGS

## M1. Dashboard silently dead without `VITE_ADMIN_TOKEN`; SSE reconnect cap gives no user feedback
- **Files:** `src/web/components/cockpit/CockpitDashboard.tsx:105-146, 161-166`
- `adminToken = ''` → fetch without `authorization` → 401 → `.catch(() => {})` swallows it; SSE connects to an authenticated route without a token → server 401s → `EventSource` auto-reconnects; `reconnectCount >= 5` closes it **silently**. The operator sees a cockpit that claims "Streaming Real-time" (line 424-426 hard-coded label) while receiving nothing. Add connection state (`'live' | 'error' | 'closed'`) rendered honestly in the badge.

## M2. Timing-unsafe token comparison on every authenticated request
- **Files:** `src/api/server.ts:87, 94, 138`
- `token !== config.ADMIN_API_TOKEN` is a plain string compare — theoretically timing-attackable over many requests. Use `crypto.timingSafeEqual` on equal-length Buffers (hash both sides first to normalize length):
  ```ts
  const a = crypto.createHash('sha256').update(token).digest();
  const b = crypto.createHash('sha256').update(config.ADMIN_API_TOKEN).digest();
  if (!crypto.timingSafeEqual(a, b)) return reply.status(401).send(...);
  ```

## M3. `CircuitBreaker` half-open probe can be stranded by client disconnect mid-stream
- **Files:** `src/domain/resilience/circuitBreaker.ts:85-105`, `src/services/gatewayService.ts:749-759`
- `allowRequest()` flips `halfOpenProbeActive = true`. In the streaming path, `recordSuccess()` fires only in `onDone`. If the client aborts the stream after the provider already returned a healthy response, the generator throws (client abort), `onError` records a **provider failure** (breaker penalty + refund for a request the provider served) and `recordSuccess` never runs. A healthy provider is punished for client behavior. Fix: distinguish `AbortError` caused by the *downstream* signal in the `onError` callback — skip `cb.recordFailure()` and skip the refund when `signal?.aborted`.

## M4. `sanitizeErrorMessage`/`readBoundedBody` compare chars to bytes; snippet may still carry secrets
- **Files:** `src/infra/http/providerClient.ts:53-57` (`text.length > maxBytes` — JS string length is UTF-16 units, not bytes), `:48` (60-char snippet of provider error text is propagated into `AppError.message`, surfaced to gateway callers and persisted in `decision_trace`). A misbehaving provider echoing the request (including `Authorization`-adjacent context) leaks it downstream. Mitigation exists (logger redaction) but the `decision_trace` JSON in `request_logs` bypasses the logger. Fix: cap bytes via `Buffer.byteLength`, and run `redactSensitiveData()` over `err.message` before persisting traces (`requestLogRepo.log` callers).

## M5. `startServer`/CLI leave DB boot failures as unhandled rejections with raw stack traces
- **Files:** `src/api/server.ts:300-313`, `src/cli/index.ts:396-404`
- `const app = await buildApp()` sits **outside** the `try` block; a read-only/corrupt DB (well-mapped by `client.ts:37-47`) rejects out of `startServer`, and the `serve` command's `action` has no `.catch`. Node ≥15 prints the raw stack and exits code 1 without the curated diagnostic. Fix:
  ```ts
  let app; try { app = await buildApp(); } catch (err) { logger.fatal({ err }, 'Boot failure'); process.exit(1); }
  ```
  plus `program.parseAsync(...).catch(...)` in the CLI.

## M6. CredentialVault is a hard-coded mock that performs destructive fetches against real IDs
- **Files:** `src/web/components/vault/CredentialVault.tsx:16-77, 119-140`
- `INITIAL_KEYS` uses fake IDs (`key-1`…) and fake quota percentages; `handleRevoke` optimistically removes the card then issues `DELETE /api/v1/providers/key-1`. Server-side this is a no-op (row not found), so UI and backend diverge until reload — "0 keys connected"/"100% quota" states the UI shows are fiction. Wire the component to `GET /api/v1/providers` with real masked keys, add an empty state, and only optimistically remove after a 2xx.

## L1. Token passed as `?token=` query param lands in proxy/browser logs
- **Files:** `src/api/server.ts:79`, `CockpitDashboard.tsx:144-146`. `EventSource` cannot send headers, so the workaround is a query string, which intermediaries log. The pino string redactor (`logger.ts:55-57`) scrubs `token=` in the daemon's own logs, but reverse proxies won't. Acceptable short-term; long-term switch to `fetch`+`ReadableStream` SSE consumer (cleanup via `AbortController`, which the component already has).

## L2. Breaker registry and expired-connection map are never pruned on connection deletion
- **Files:** `src/services/gatewayService.ts:39, 58`. `breakerRegistry` (and its `currentCooldownMs` backoff, lost on restart since `getSharedCircuitBreaker` seeds only state/failures/openedAt) grows unboundedly; `providerService.revokeConnection` never calls `breakerRegistry.delete(id)` / `locallyExpiredConnectionIds.delete(id)`. Add cleanup in `revokeConnection`.
## L3. `migrationRunner` resolves migrations relative to `process.cwd()`
- **Files:** `src/infra/db/migrationRunner.ts:12-16`. Launching the daemon from any directory other than the project root falls back to `distDir` — which is correct post-build but silently **skips** migrations (warn only, line 27-30) if the dist layout changes. Prefer resolving solely from `import.meta.url` roots.

## L4. `reserveQuota` fresh-INSERT branch skips the ceiling check
- **Files:** `src/infra/db/repositories/quotaRepo.ts:81-89`. The conditional `WHERE used_value + excluded.used_value <= ?` only applies to the ON CONFLICT branch; a **fresh INSERT** succeeds regardless of `amount > limitValue` (e.g., `max_tokens` 10_000 with a 5_000 limit on a brand-new window). Validate `amount <= limitValue` before calling `reserveQuota`, or add `CHECK`/guard `if (amount > limitValue) return false;`.

## L5. `max_tokens` accepted unvalidated (`0`, negative, non-numeric)
- **Files:** `src/services/gatewayService.ts:268, 638` — `request.max_tokens || 1000`: `0` → 1000 (surprising), negative → `reserveQuota` passes (negative amount always ≤ limit) then is refunded as a positive delta elsewhere → accounting drift. No Fastify JSON schemas exist on **any** route (`server.ts:246-259` use `req.body as any`). Add `max_tokens = Math.max(1, Math.floor(Number(...)))` and schema-validate the chat completions body.

## L6. Error handler swallows post-header failures without ending the socket
- **Files:** `src/api/server.ts:108-110`. `if (reply.raw.headersSent) return;` leaves the socket open with no `reply.raw.end()` → client hangs until its own timeout. Call `reply.raw.end()` before returning.

## L7. Cosmetic/visual edge cases
- `CockpitDashboard.tsx:203-224`: Throughput/latency/success are hard-coded fiction (14,280 req/m, 99.8%) — remove or wire to real aggregates.
- `CockpitDashboard.tsx:118`: empty `request-logs` list → panel renders with zero rows and no empty-state message.
- `AppShell.tsx:14`: "Monitoring 6 free enclave keys" hard-coded regardless of actual connection count.
- Root `ErrorBoundary` (`App.tsx:10`) is the only boundary; a render panic in the drawer or modal blanks the entire workstation. Wrap `DecisionInspectorDrawer` / `GoalStudioModal` contents in their own boundaries.
- `data/goalroute.db` ships in the working tree (untracked per prior audit, but present) — ensure it never reaches a published artifact; it contains encrypted credentials keyed by the dev master key.

---

# 3. CONFIRMED-CLEAN SURFACES (verified, no action)

- **Vault cipher** (`vault.ts`): AES-256-GCM, 96-bit `randomBytes` IV, auth-tag enforced on decrypt, strict 32-byte key check. Sound.
- **Atomic reservation primitive** (`quotaRepo.reserveQuota:74-90`): single-statement conditional upsert, `changes > 0` as admission decision — the correct pattern (residual bugs are in the *settlement*, H1, not the reservation).
- **Migrations** (`migrationRunner.ts:55-58`): per-migration transaction + SHA-256 checksum immutability. `poolRepo.createPool:35` wraps pool+steps in a transaction.
- **SSE log stream lifecycle** (`server.ts:267-295`): listener removed on close, idempotent end, `once=true` handled.
- **Frontend effect hygiene**: `CockpitDashboard` and `CredentialVault` both have correct abort/timer cleanup; no state-after-unmount paths found.
- **Log redaction** (`logger.ts`): layered key-based + pattern-based scrubbing, circular-reference-safe.
- **Config fail-fast** (`config.ts:34-36`): production refuses default admin token; master key format enforced.
- **Non-stream dispatch abort wiring** (`server.ts:222-242`): close-listener removed in `finally`, abort reaches upstream fetch.

---

# 4. PRIORITIZED REMEDIATION ORDER

1. **H1** — quota settlement idempotency + `MAX(0, …)` floor (data corruption; ships today).
2. **H2** — remove admin token from the SPA bundle (credential exposure).
3. **H3** — post-header idle watchdog on upstream streams (availability).
4. **M3** — don't penalize breaker/refund on downstream-abort.
5. **M5, L5** — boot diagnostics + request schema validation.
6. **M1, M6** — dashboard honesty (real data, real empty states).
7. Remaining low findings at leisure before GA.