# GoalRoute Ironclad Adversarial Audit Report

> Method: isolated stress harness `tests/ironclad_stress.test.ts` (24 probes, all 7 vectors), real code imports, real in-memory SQLite + migrations + Groq catalog seed, external network mocked via stubbed global `fetch`. Harness executed (`npx vitest run`), results captured, harness **deleted** after the run. No `src/` files modified.
> Final harness run: `Test Files 1 passed (1) | Tests 24 passed (24) | ~800ms`.

## 1. Executive Verdict

- **Overall Status: DEFECTS FOUND** (no fatal data-corruption / unit-collision class bugs, but multiple production-impacting defects)
- **Vector Pass Rate: 2 / 7 clean PASS** (Vectors 4 and 6). Vectors 1, 2, 3, 5, 7 contain confirmed defects or wire-protocol risks.
- **Immediate Showstoppers:**
  1. **Transient Cloudflare/edge 403 permanently kills credentials** — `gatewayService.ts:268-271` marks any 401/403 connection `expired` without inspecting the response body (HTML WAF challenge → account death).
  2. **Expired connections keep receiving traffic** — neither `getPoolSteps` nor the dispatch snapshot filters `connection.status === 'expired'` (`gatewayService.ts:55-60`, `poolRepo.ts:66-69`). Proven: dead provider was hit again by every subsequent request and by all 5 concurrent requests.
  3. **Secret redaction leaks** — Groq `gsk_…` and HuggingFace `hf_…` keys pass through the logger unredacted; URL-encoded `api_key%3D…` leaks; circular error objects crash the log serializer with `RangeError` (`src/infra/logger.ts:23-71`).

## 2. Forensic Vector Analysis

### Vector 1: Gemini Wire Protocol
- **Status: FAIL (2 wire-killer defects) / WARN (1)**
- **Findings:**
  - **1.1 First-Turn-Must-Be-User Trap — FAIL.** `openaiToProvider.ts:69-86` maps `assistant` → `model` and pushes it as `contents[0]`. No synthetic user turn is prepended and no sanitization occurs. Native Gemini rejects `contents[0].role != 'user'` with an opaque HTTP 400. *Reproduction:* input `[{role:'assistant',content:'Sure, I will help with that.'},{role:'user',content:'Continue.'}]` → output `contents[0] = {"role":"model","parts":[{"text":"Sure, I will help with that."}]}` — sent verbatim to `:generateContent`.
  - **1.2 System Sandwich Merge — PASS (semantic WARN).** For `[user, system, user]` the system turn is hoisted to `system_instruction` and the role-merging loop (`openaiToProvider.ts:77-84`) folds the two user turns into ONE turn with two parts: `{"role":"user","parts":[{"text":"Q1"},{"text":"Q2"}]}`. Wire-valid, but turn boundaries are silently destroyed — the model sees Q1+Q2 as a single prompt.
  - **1.3 Empty/Whitespace Parts — FAIL.** `content: ""` and `"   "` pass straight through as `parts:[{"text":""},{"text":"   "}]`. No validation, no dropping. Gemini 400 (`parts` with empty text) risk confirmed by payload inspection.
  - **1.4 Non-String Content — PASS.** Array (vision-style) content is `JSON.stringify`-ed (`openaiToProvider.ts:74`): no `content.slice is not a function`, no `[object Object]`. Semantically lossy for images (URL data serialized as JSON text, no `inline_data` mapping), but never crashes.

### Vector 2: Cooldown, Date Math & Unit Collisions
- **Status: FAIL (Retry-After cap override) / PASS (units, NaN)**
- **Findings:**
  - **2.1 Seconds-vs-Milliseconds Apocalypse — PASS.** `cooldown_until` is written in `gatewayService.ts:290` as `Date.now() + cooldownDuration` (ms) and compared with `Date.now()` (`gatewayService.ts:70,139`). No sec/ms collision exists anywhere in the write or read path. `CooldownTracker.recordFailure(now, 5)` yields `until - now === 5000` exactly.
  - **2.2 NaN Poisoning — PASS.** `parseRetryAfter` (`providerClient.ts:21-38`): `'invalid-date'` → `undefined`; `'-1'` → `Date.parse('-1')` is `NaN` → clamped by `Math.max(0, diffSec)` → `0` (falsy, harmless — `calculateCooldownMs` requires `> 0`). No `NaN` can reach SQLite.
  - **2.3 Cooldown Cap vs Upstream Mandate — FAIL.** `cooldown.ts:17-18`: `Math.min(retryAfterSeconds * 1000, maxCooldownMs)`. An explicit `Retry-After: 120` is silently truncated to 30000 ms. Proven end-to-end: provider returns 429 + `Retry-After: 120` → `health_state.cooldown_until` stored at `now + 29999ms` (captured delta). GoalRoute re-slams the provider ~90s before the upstream mandate expires.

### Vector 3: Terminal Errors (401/403) & False Positives
- **Status: FAIL (2 showstopper defects)**
- **Findings:**
  - **3.1 Cloudflare WAF 403 Trap — FAIL.** `gatewayService.ts:268-271`: `if (statusCode === 401 || statusCode === 403) → connectionRepo.updateStatus(conn.id, 'expired', …)`. No body/content-type inspection. A mocked Cloudflare challenge (`403`, `text/html`, `<html>…Attention Required! | Cloudflare…`) flipped the connection to `expired` in the DB. The user's credential is permanently bricked by a transient edge block.
  - **3.2 In-Memory Cache vs DB State — FAIL.** (a) The pool step snapshot (`gatewayService.ts:55-109`) never checks `conn.status`; after expiry the connection is re-dispatched on the very next request (upstream fetch to the dead provider observed again). (b) Concurrency: 5 simultaneous `dispatch()` calls against a 401-ing provider produced **exactly 5 upstream calls** — no in-flight dedup, no abort-signal propagation, no first-401-wins short-circuit. All N concurrent requests hammer the dead provider.
  - Mitigating note: repos read from SQLite on every dispatch, so there is no *stale* in-memory cache problem — the problem is the complete absence of a status check, not staleness.

### Vector 4: Quota Engine Bucketing Math & Lockups
- **Status: PASS (both sub-vectors)**
- **Findings:**
  - **4.1 `getWindowStart` units — PASS.** `slidingWindow.ts:8-11` computes `Math.floor(nowMs / (windowSeconds * 1000)) * (windowSeconds * 1000)`. Verified: `getWindowStart(1741000000123, 86400)` aligns to a multiple of 86,400,000 ms with `0 <= now - ws < 86,400,000`. No 1000× bucket drift.
  - **4.2 Fail-Open on Write vs Read — PASS.** Quota gate read is try/catch'd (`gatewayService.ts:151-167`) — a `SQLITE_BUSY` on `getPolicy` logged "Quota gate database call failed; failing open" and the dispatch **succeeded**. `recordUsage()` after success is separately guarded (`gatewayService.ts:223-231`) — a thrown `SQLITE_BUSY` produced a "Failed to record quota usage" warn and the client still received the LLM response. No 500-on-success path exists.

### Vector 5: Secret Redaction Escapes
- **Status: FAIL (3 leak/crash defects)**
- **Findings (`src/infra/logger.ts:23-48`):**
  - **5.1 Provider-specific prefixes — FAIL.** The scrubber only knows `sk-…` and `AIza…`. A raw Groq key `gsk_A1b2…` and HuggingFace token `hf_aaa…` survive redaction verbatim (captured: `gsk leaked? true | hf leaked? true`). `sk-ant-api03-…` *is* caught, but only incidentally because the `sk-` regex swallows the remainder — fragile, not intentional coverage.
  - **5.2 URL-encoded leaks — FAIL.** `https://api.x.com/v1?api_key%3Dgsk_secret12345&foo=bar` returned untouched: the query scrubber (`logger.ts:43-44`) requires a literal `=`; `%3D` bypasses it entirely.
  - **5.3 Circular / deep cause objects — FAIL.** `redactSensitiveData` has no cycle guard. A self-referencing error object (typical of `AxiosError`/undici `cause` chains) throws `RangeError: Maximum call stack size exceeded` inside the pino `formatters.log` hook — i.e., **a logging call can crash the request path**.
  - Positive: `Bearer …` strings and sensitive object keys (`headers.authorization` etc.) are correctly censored.

### Vector 6: Upstream Error Sanitization Escapes
- **Status: PASS (message layer) / WARN (memory layer)**
- **Findings:**
  - **6.1 Massive payload DOS — PASS at message layer, WARN at memory layer.** A 5MB HTML dump is tag-stripped, whitespace-collapsed, and sliced to a 106-char snippet (`providerClient.ts:46-47`) — no message blowup, no HTML tags reach `decisionTrace`. **WARN:** `providerClient.ts:92-96` reads the entire body via `response.json()`/`response.text()` with no size cap; a hostile provider can push arbitrarily large bodies into process memory before sanitization runs. Same applies to *successful* 2xx multi-GB JSON payloads — `data` is returned unbounded.
  - **6.2 JSON-wrapped HTML — PASS.** `sanitizeErrorMessage(502, {error:'<html>…Bad Gateway…'}, 'application/json')` → `[PROVIDER_ERROR] status=502 type=JSON snippet=" Bad Gateway "` — tags stripped, safe for `decisionTrace` and logs.

### Vector 7: Anthropic Protocol Parity
- **Status: WARN**
- **Findings:**
  - **7.1 System prompt concatenation — WARN.** `['A','','B'].join('\n\n')` produces `"A\n\n\n\nB"` (captured). A single empty system string yields `system: ""` (truthy via `systemTexts.length > 0`), sending an empty `system` field. Pollutes prompts and cache breakpoints.
  - **7.2 "Proceed." fallback — PASS.** A system-only request produces `messages: [{role:'user', content:'Proceed.'}]` and the response translator (`providerToOpenai.ts:17-46`) maps Anthropic content blocks back cleanly — no structural corruption, though callers should be aware a synthetic turn was injected into conversation context.
  - **7.3 Gemini response translation — PASS.** `candidates[0].content.parts[0].text`, `usageMetadata` token mapping, and `finishReason === 'STOP' → 'stop'` all map cleanly.

## 3. Latent Bugs & High-Consequence Edge Cases

| # | Severity | Location | Failure Sequence |
|---|----------|----------|------------------|
| L1 | **Critical** | `src/services/gatewayService.ts:268-271` | Provider behind Cloudflare → transient 403 challenge → `updateStatus('expired')` → credential permanently dead. Under a WAF rate-limit storm, an entire pool can be sequentially bricked in seconds. |
| L2 | **Critical** | `src/services/gatewayService.ts:55-60`, `src/infra/db/repositories/poolRepo.ts:66` | Dispatch snapshot ignores `conn.status`. Expired/banned connections are selected and dispatched forever. Combined with L1, every "dead" connection burns a full HTTP round-trip (up to 30s timeout) per request per step — latency amplifier + request waster under load. |
| L3 | **High** | `src/domain/resilience/cooldown.ts:17-18` | Explicit `Retry-After` capped at 30s. Under rate-limit storms GoalRoute re-attacks every 30s, converting soft bans into hard IP bans. One-line fix. |
| L4 | **High** | `src/infra/logger.ts:23-71` | (a) `gsk_`/`hf_` keys leak to logs on any upstream error echo; (b) URL-encoded `%3D` params leak; (c) circular error objects crash the pino formatter with `RangeError` — one weird upstream error can take down the request that received it. |
| L5 | **Medium** | `src/services/gatewayService.ts:263-311` (concurrency) | No per-connection in-flight mutex/abort: N concurrent requests each independently attempt, fail, and upsert `health_state` — last-writer-wins on `consecutive_failures`, breaking breaker increment math under races. |
| L6 | **Medium** | `src/infra/http/providerClient.ts:90-96` | Unbounded `response.json()/text()` on all responses (incl. 2xx). A rogue provider can OOM the gateway with a single multi-GB body. |
| L7 | **Low** | `src/domain/translation/openaiToProvider.ts:69-86` | (a) Assistant-first conversations ship `contents[0].role='model'` → guaranteed Gemini 400; (b) empty-text parts forwarded → Gemini 400; (c) system-sandwich merging silently destroys turn boundaries (semantic drift). |
| L8 | **Low** | `src/domain/translation/openaiToProvider.ts:46` | Empty-string system messages produce `"\n\n\n\n"` separator pollution in Anthropic `system`. |

## 4. Remediation Checklist

**R1 — Cloudflare 403 triage (`gatewayService.ts:268`):** Only treat 401/403 as terminal when the response is a provider JSON auth error. `sanitizeErrorMessage` already tags HTML — use it:
```ts
const isWafChallenge = /type=HTML/i.test(err.message);
if ((statusCode === 401 || statusCode === 403) && !isWafChallenge) {
  // existing expired logic
} else if (statusCode === 403 && isWafChallenge) {
  // transient: fall through to breaker-eligible path (add 403 to isBreakerEligible for HTML case)
}
```

**R2 — Honor connection status (`gatewayService.ts`, step snapshot loop, after `if (!conn || !mdl || !prov) continue;`):**
```ts
if (conn.status === 'expired' || conn.status === 'banned') continue;
```
Also re-check status in the dispatch loop after re-fetching the connection.

**R3 — Respect explicit Retry-After (`cooldown.ts:17-19`):**
```ts
if (retryAfterSeconds && retryAfterSeconds > 0) {
  // explicit upstream mandate overrides the local cap
  return Math.max(retryAfterSeconds * 1000, Math.min(retryAfterSeconds * 1000, maxCooldownMs)) ;
}
```

**R4 — Logger hardening (`logger.ts`):**
- Extend string scrub regexes: `gsk_[A-Za-z0-9]{20,}`, `hf_[A-Za-z0-9]{20,}` (keep the existing `sk-` rule, which already covers `sk-ant-…`).
- Encoding-aware query scrub: add a second rule `/([?&](?:api_key|key|token)%3D)[^&\s]+/gi`.
- Cycle guard: `const seen = new WeakSet();` — at object entry `if (seen.has(obj)) return '[CIRCULAR]'; seen.add(obj);` and thread `seen` through recursion.

**R5 — Concurrency dedup:** Add a module-level `Map<connectionId, Promise>` (or shared `AbortController`) so concurrent dispatches to the same connection share/short-circuit the in-flight attempt; on 401/403 confirmation, remaining waiters skip immediately.

**R6 — Body size cap (`providerClient.ts`):** Check `content-length` before reading; stream `response.body` and abort past ~1MB for error bodies; reject oversized 2xx bodies with an `AppError` instead of buffering.

**R7 — Gemini request sanitizer (`openaiToProvider.ts:69-86`):** (a) if the first non-system turn is `assistant`, prepend a synthetic `{role:'user', parts:[{text:'(context)'}]}` turn; (b) drop messages whose trimmed string content is empty; (c) when merging adjacent turns, join parts with `\n\n` to reduce boundary loss.

**R8 — Anthropic system join (`openaiToProvider.ts:46`):** `systemTexts.filter(s => s.trim().length > 0).join('\n\n')`.

---
*Harness `tests/ironclad_stress.test.ts` was deleted after the audit run; only this report remains.*


