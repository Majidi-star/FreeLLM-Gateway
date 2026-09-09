# RC1 Production Release Audit — FreeLLM-Gateway (GoalRoute)

**Scope:** full repository read; `tsc --noEmit` executed (clean, 0 errors); `vitest run` executed (19 files / 89 tests, all pass). No codebase files were modified. Read-only audit performed prior to public deployment.

**Verified clean before findings:** no secrets in git-tracked files (`git ls-files` confirms `.env` and `data/` are untracked); logger redaction (`src/infra/logger.ts`) is layered and circular-safe; migrations use transactions + checksum pinning (`migrationRunner.ts:55`); the SSE generator reports usage in `finally` (no quota leak on client abort); `parseRetryAfter`, `sanitizeErrorMessage`, theme import (strict color regex + forbidden-key guard in `ThemeContext.tsx`), and the clipboard bidi sanitizer are all solid; the vault cipher itself is sound (AES-256-GCM, 96-bit `randomBytes` IV, auth tag enforced).

---

## 1. Critical & High Findings

### C1. No React ErrorBoundary — any render panic whitescreens the workstation
- **Files:** `src/web/main.tsx:8`, `src/web/App.tsx`
- **Mechanism:** zero `ErrorBoundary` exists anywhere in `src/web/` (verified by search). A single malformed property — e.g. a trace where `tokens` is `null` from a nullable DB column rendered as `{tr.tokens.total}` at `CockpitDashboard.tsx:441` — throws during render, unmounts the entire tree, and leaves a permanent blank screen. The nullable `latency_ms | null` / `tokens_in | null` columns in `requestLogRepo.ts` make this reachable.
- **Fix:** add a class-based `ErrorBoundary` (see full snippet in Appendix A) wrapping `<AppShell />` inside `ThemeProvider`, rendering a degraded shell with a "Reload surface" action instead of a blank screen.

### C2. Admin token hardcoded into the frontend bundle
- **Files:** `src/web/components/cockpit/CockpitDashboard.tsx:107`, `src/web/components/vault/CredentialVault.tsx:106,119`
- **Mechanism:** `authorization: 'Bearer dev-admin-secret-token'` is compiled into the production JS bundle. Two failure modes: (a) **security** — the dev token leaks via any shipped bundle artifact; (b) **contract drift** — in production `ADMIN_API_TOKEN` differs (enforced at `src/infra/config.ts:34`), so *every* dashboard fetch returns 401 and the entire UI silently fails (the `.catch(() => {})` at `CockpitDashboard.tsx:134` masks it completely).
- **Fix:** never ship a literal admin secret. Inject a scoped token at build time:
```ts
const ADMIN_TOKEN = import.meta.env.VITE_ADMIN_TOKEN ?? '';
const authHeaders = ADMIN_TOKEN ? { authorization: `Bearer ${ADMIN_TOKEN}` } : {};
```

### C3. SSE log stream can never authenticate → infinite reconnect storm
- **Files:** `src/web/components/cockpit/CockpitDashboard.tsx:137` vs `src/api/server.ts:71-82`
- **Mechanism:** `EventSource` cannot set `Authorization` headers, but `/api/v1/request-logs/stream` sits under the authenticated `/api/v1/` prefix (`server.ts:71-82`). Every connection gets 401, `EventSource` auto-reconnects forever (no `onerror`, no retry cap), spamming the daemon with failed requests and retry loops — the "Live Traffic" feature is dead-on-arrival in any authenticated deployment.
- **Fix (full snippet in Appendix B):** accept a short-lived `?token=` query param for the SSE route (validated against `ADMIN_API_TOKEN` in the auth hook), or replace `EventSource` with `fetch` + `ReadableStream`; add an `onerror` handler with a retry cap (`if (retries > 5) es.close()`).

### C4. CORS origin check bypass via substring match
- **File:** `src/api/server.ts:59`
- **Mechanism:** `origin.includes('localhost')` matches attacker-controlled hosts such as `https://localhost.evil.io` or `https://phishing-localhost.com`, returning `cb(null, true)` → arbitrary remote origins receive CORS approval.
- **Fix:**
```ts
origin: (origin, cb) => {
  if (!origin) return cb(null, true);
  try {
    const { hostname } = new URL(origin);
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname.endsWith('.localhost')) {
      return cb(null, true);
    }
  } catch { /* fallthrough */ }
  return cb(null, false);
}
```

### C5. Unhandled stream write errors can crash the daemon (ERR_STREAM_DESTROYED)
- **Files:** `src/api/server.ts:187-191` (no `reply.raw.on('error')` handler exists anywhere; also no `unhandledRejection`/`uncaughtException` guards in `src/cli/index.ts` — verified by search)
- **Mechanism:** when a client aborts mid-stream, `abortController.abort()` fails the upstream stream; the catch block then calls `reply.raw.write(...)` three times **without checking `writableEnded`/`destroyed`**. Writing to a destroyed socket emits an asynchronous `'error'` event; with no error listener, Node throws an uncaught exception → process exit, killing all in-flight requests.
- **Fix:**
```ts
// before streaming starts:
reply.raw.on('error', () => { /* client gone; abort already propagates upstream */ });

// in catch:
} catch (err: any) {
  if (reply.raw.headersSent && !reply.raw.writableEnded && !reply.raw.destroyed) {
    reply.raw.write('data: {"id":"chatcmpl-err",...finish_reason:"stop"...}\n\n');
    reply.raw.write('event: error\ndata: {"error":"Upstream provider stream disconnected"}\n\n');
    reply.raw.write('data: [DONE]\n\n');
  } else if (!reply.raw.headersSent) {
    throw err;
  }
}
```

### C6. `once(reply.raw, 'drain')` can hang the request forever
- **File:** `src/api/server.ts:183`
- **Mechanism:** if the socket closes while backpressured, neither `'drain'` nor any listened event fires — the awaited promise never resolves, stranding the SSE generator, the upstream fetch socket, and the quota pre-reservation for the connection.
- **Fix:**
```ts
if (!canWriteMore) {
  await Promise.race([once(reply.raw, 'drain'), once(reply.raw, 'close')]);
  if (reply.raw.destroyed) break; // client gone; abort already fired
}
```

### C7. Circuit-breaker half-open permanent lockout (probe flag never released)
- **Files:** `src/domain/resilience/circuitBreaker.ts:90-97` + `src/services/gatewayService.ts:240-293` (same pattern at `:614-665`)
- **Mechanism:** `allowRequest()` consumes the half-open probe by setting `halfOpenProbeActive = true`. But in the dispatch loop the breaker gate runs **before** the cooldown gate (`:253`) and quota gate (`:265`); if a probe is granted and the request is then skipped by a `continue` in those gates, neither `recordSuccess()` nor `recordFailure()` runs. `getState()` only transitions `open → half_open` and never resets a stuck `half_open`, so the connection is **permanently blocked** until process restart.
- **Fix (minimal):** move the `allowRequest()` call to immediately precede the dispatch attempt (after all skip gates), or add an explicit release on every post-gate skip:
```ts
// circuitBreaker.ts
public releaseProbe(): void {
  if (this.state === 'half_open') this.halfOpenProbeActive = false;
}

// gatewayService.ts — on every `continue` after the breaker gate:
if (quotaExceeded) { cb.releaseProbe(); /* ...existing trace push + continue */ }
```

### C8. Quota admission TOCTOU — unbounded overdraft under concurrent dispatch
- **Files:** `src/services/gatewayService.ts:265-304` / `:638-676`, `src/infra/db/repositories/quotaRepo.ts:64-72`
- **Mechanism:** `wouldQuotaExceed` reads `used_value`, then pre-reservation blind-increments (`recordUsage` has no ceiling check and no conditional update). N concurrent dispatches all pass the gate on the same read and each reserves `max_tokens || 1000`; total recorded usage overshoots the limit by ≈ (N−1) × estimate. No transaction spans read+reserve (and none can span the upstream fetch).
- **Fix (full snippet in Appendix C):** make reservation the single atomic admission point via a conditional `INSERT ... ON CONFLICT ... DO UPDATE ... WHERE used_value + excluded.used_value <= limit`, checking `res.changes > 0`; treat `false` as quota-exceeded. Refund/settle deltas afterward exactly as today (`gatewayService.ts:411-417`, `:766-769`).

### C9. `/api/v1/request-logs?limit=` → NaN bind → SQLite RangeError → 500
- **Files:** `src/api/server.ts:231`, `src/infra/db/repositories/requestLogRepo.ts:50-58`
- **Mechanism:** `Number("abc")` → `NaN`; `better-sqlite3` throws `RangeError: Invalid value` on NaN bind → unhandled 500. Negative limits and `limit=999999999` (unbounded dump of the log table) also pass straight through.
- **Fix:**
```ts
const limit = Math.min(Math.max(1, Math.floor(Number(q?.limit)) || 50), 500);
```

---

## 2. Medium & Low Findings

| # | Severity | Location | Defect & Mechanism | Clean Fix |
|---|---|---|---|---|
| M1 | Medium | `src/api/server.ts:71-74` | `/api/v1/health` is auth-exempt yet returns connection labels, provider slugs, and circuit-breaker states — information disclosure to anonymous callers. | Return `{ status: 'ok', timestamp }` only, or require auth. |
| M2 | Medium | `src/services/goalService.ts:70` | Unguarded `JSON.parse(model.task_fitness)` — a corrupt row throws → 500 on `/api/v1/goals/:id/solve`. Inconsistent with `safeParseTaskFitness` (`gatewayService.ts:104`). | `const taskFitnessMap = safeParseTaskFitness(model.task_fitness);` (import from gatewayService or move to a shared util). |
| M3 | Medium | `src/api/server.ts:204` | Non-stream `dispatch()` passes **no AbortSignal** to `callProviderEndpoint` — client disconnect during a 30s non-stream call keeps the upstream socket open and quota reserved for the full timeout. | Thread `req.raw` close → `AbortController` → `callProviderEndpoint({ signal })` exactly as the stream path does (`:160-171`). |
| M4 | Medium | `src/web/components/cockpit/CockpitDashboard.tsx:104-134` | Preload fetch has no `AbortController`; the `.then` chain can `setTraces` after unmount (memory retention). Also `res.json()` on a 401/error body throws into the empty `.catch(() => {})`, silently masking C2. | `const ac = new AbortController(); fetch(url, { signal: ac.signal, ... })` and `return () => { es.close(); ac.abort(); }`; check `res.ok` before `res.json()`. |
| M5 | Medium | `CredentialVault.tsx:87`, `DecisionInspectorDrawer.tsx:49`, `GoalStudioModal.tsx:42`, `SettingsAppearanceStudio.tsx:34,42` | `setTimeout` callbacks call `setState` with no cleanup handle — timer leaks and state updates after unmount. | Store timer IDs in a ref and clear in `useEffect` cleanup, or guard with an `isMountedRef`. |
| M6 | Medium | `src/infra/db/client.ts:26` | Corrupt/read-only `goalroute.db` throws a raw `SqliteError` from the constructor with no try/catch or actionable diagnostic ("check file permissions / disk space"). `journal_mode = WAL` result is not verified (WAL can silently fail on network filesystems). | Wrap `new Database(dbPath)` + pragmas in try/catch and rethrow a `ConfigError` with an actionable message. |
| L1 | Low | `src/services/gatewayService.ts:39,53` | `breakerRegistry` Map is never pruned on connection delete/revoke — unbounded growth over long uptimes (small, per-connection). | `breakerRegistry.delete(connId)` in `revokeConnection` / on delete. |
| L2 | Low | `src/infra/db/repositories/requestLogRepo.ts:38-40` | `entry.latency_ms \|\| null` collapses a legitimate `0` latency (instant failure) into `NULL`; same for `tokens_in/tokens_out: 0 → NULL` — frontend contract drift (masked by `\|\| 0` in `CockpitDashboard.tsx:121-122`). | Use `?? null` instead of `\|\| null`. |
| L3 | Low | `src/domain/quota/slidingWindow.ts:8-10` | `window_seconds = 0` → division by zero → `NaN` window start bound to SQLite (caught by the fail-open gate, but silently disables quota for that policy). | Validate `window_seconds >= 1` in `QuotaRepository.setPolicy`. |
| L4 | Low | `src/services/gatewayService.ts:267,639` | `estimatedTokens = request.max_tokens \|\| 1000` — a client sending `max_tokens: 1e12` self-reserves an enormous quota, blocking the connection until window rollover (self-DoS via the reservation ledger). | Clamp: `Math.min(request.max_tokens ?? 1000, dailyPolicy?.limit_value ?? 1_000_000)`. |
| L5 | Low | `CockpitDashboard.tsx:11-66,179-196` + `CredentialVault.tsx:16-77` | Dev mock artifacts ship in production UI: `SAMPLE_TRACES`, hardcoded metrics ("14,280 req/m", "99.8%", "6/6 connections"), `INITIAL_KEYS` not backed by `GET /api/v1/providers` — the Vault shows six fake keys and revoke/test operate on mock IDs. | Wire Vault to `GET /api/v1/providers` and Cockpit metrics to real aggregates; remove mock constants. |
| L6 | Low | `package.json:23` | `@tanstack/react-query` is declared but never imported (dead dependency; bloats lockfile). | Remove it, or actually adopt it for the fetch lifecycle fixes in M4. |
| L7 | Low | `src/infra/security/vault.ts` | No key-ID/versioning or rotation path (cipher itself has no findings). `decryptCredential` error messages embed raw crypto error text (harmless, internal-only). | Prefix payloads with a 1-byte key version for future rotation. |
| L8 | Low | `src/api/server.ts:189-191` | Error-path SSE chunk order is malformed (`data:` finish chunk before `event: error`) and the fabricated chunk carries a mismatched `chatcmpl-err` id — cosmetic contract drift for strict OpenAI-SDK clients. | Emit `event: error` first, then a finish chunk reusing the live `streamId`, then `data: [DONE]`. |

---

## 3. Execution Evidence

- `npx tsc --noEmit` → **0 errors** (strict mode, `tsconfig.json`).
- `npx vitest run` → **19 test files, 89 tests, all passed** (1.61s). No test mocks or dev artifacts leak into `src/` production paths.
- `git ls-files` confirms `.env`, `data/goalroute.db`, and `graphify-out/` are untracked (no credential or internal-data leakage via the repository).

## 4. Deployment Gate Recommendation

**Not RC1-ready.** Blockers before public deployment, in priority order: C5 (daemon crash), C2 (token in bundle), C3 (SSE auth/reconnect storm), C1 (ErrorBoundary), C4 (CORS bypass), C7 (breaker lockout), C8 (quota overdraft), C9 (500 on malformed query). Medium findings M1–M6 should land in the same release train; Low findings can follow.


---

## Appendix A — C1 Fix: ErrorBoundary component

```tsx
// src/web/components/common/ErrorBoundary.tsx
import React from 'react';

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Workstation render panic', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="p-10 text-center">
          <h1 className="text-white font-bold">Workstation fault</h1>
          <p className="text-xs text-[var(--text-muted)]">{this.state.error.message}</p>
          <button
            className="mt-4 px-4 py-2 rounded-xl bg-[var(--accent-primary)]/10 text-[var(--accent-primary)]"
            onClick={() => this.setState({ error: null })}
          >
            Reload surface
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// src/web/App.tsx
<ThemeProvider>
  <ErrorBoundary>
    <AppShell />
  </ErrorBoundary>
</ThemeProvider>
```

## Appendix B — C3 Fix: SSE authentication + reconnect cap

```ts
// server.ts auth hook — allow token query param for the SSE route only
if (url.startsWith('/api/v1/request-logs/stream')) {
  const token = (req.query as any)?.token;
  if (token === config.ADMIN_API_TOKEN) return; // authenticated
  // else fall through to header check / 401
}

// CockpitDashboard.tsx
const es = new EventSource(`/api/v1/request-logs/stream?token=${encodeURIComponent(ADMIN_TOKEN)}`);
let retries = 0;
es.onerror = () => {
  retries += 1;
  if (retries > 5) es.close(); // stop the reconnect storm
};
```

## Appendix C — C8 Fix: atomic quota reservation

```ts
// quotaRepo.ts
public reserve(
  connectionId: string, dimension: string,
  windowStart: number, amount: number, limitValue: number
): boolean {
  const stmt = this.db.prepare(`
    INSERT INTO quota_usage (connection_id, dimension, window_start, used_value)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(connection_id, dimension, window_start) DO UPDATE SET
      used_value = used_value + excluded.used_value
    WHERE used_value + excluded.used_value <= ?
  `);
  const res = stmt.run(connectionId, dimension, windowStart, amount, limitValue);
  return res.changes > 0; // false ⇒ would exceed limit ⇒ skip this connection
}
```
For the insert path the ceiling must also be enforced (`amount <= limitValue` checked by the caller before calling `reserve`). Refund/settle deltas afterward exactly as today.

