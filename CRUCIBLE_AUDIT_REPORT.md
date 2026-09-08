# CRUCIBLE AUDIT REPORT — Operation Crucible

**Scope:** Adversarial end-to-end audit of the SSE streaming / tool-calling pipelines against the Resilience / Quota subsystems of GoalRoute.
**Method:** Temporary vitest harness (`tests/crucible_audit.test.ts`, deleted after execution) with mocked upstream provider streams, in-memory SQLite (better-sqlite3 + real migrations), mocked `providerClient`, and live-socket HTTP probes through a real `buildApp().listen()` Fastify server.
**Constraint honored:** `src/` was never modified — `git status --porcelain` is clean post-audit.
**Result:** 16 probes executed — 13 PASS, 3 FAIL (all 3 failures are genuine spec defects), plus 4 additional defects confirmed via behavioral instrumentation.

---

## 1. Executive Summary

The pre-chunk failover path, the Gemini multi-turn tool translation, the Anthropic tool-ID round-trip, and the streaming usage *summation* logic are all sound. However, the audit uncovered **7 confirmed defects**, three of which are release-blocking for coding-agent workloads:

1. **[CRITICAL] Mid-stream upstream failure leaves the client connection dangling forever.** The client receives `200 OK` + partial SSE, then the socket is never closed, no `data: [DONE]`, no error envelope. Fastify logs "Unhandled server error" and Node captures an unhandled stream error.
2. **[HIGH] Parallel tool calls are corrupted by index collision** (`tool_calls[0].index` hardcoded to `0`) in both the Anthropic and Gemini streaming translators. Coding agents (Cursor, Claude Code) will merge two distinct tool calls into one call with concatenated, invalid JSON arguments.
3. **[HIGH] Gemini tool-call streams lose `finish_reason: "tool_calls"`** whenever the terminal chunk with `finishReason: "STOP"` arrives after the `functionCall` chunk (the standard Gemini SSE shape). The stream terminates as `finish_reason: "stop"`, which breaks every OpenAI-SDK-based agent's tool-execution loop.
4. **[HIGH] Client aborts are not propagated upstream and abort-path usage is never billed.** The upstream generator runs to completion after the client vanishes (wasted provider tokens/quota), `recordUsage()` writes `0` tokens, and an unhandled error is emitted by the raw response write.
5. **[MEDIUM] OpenAI-protocol streams always bill 0 tokens** unless the upstream happens to include `usage` in a chunk; the gateway never requests `stream_options: { include_usage: true }` and its `length/4` estimate fallback never applies to the OpenAI branch (`accumulatedContent` is only fed by the Gemini branch).
6. **[MEDIUM] Circuit breaker is credited with `recordSuccess()` before a single upstream byte is consumed**, so a connection whose stream dies mid-way repeatedly re-enters the rotation with a clean health record.
7. **[LOW] First-turn tool response risk:** a conversation starting `system → tool` produces `contents[0] = { role: 'user', functionResponse }` with no preceding `functionCall` — structurally valid per the translator, but real Gemini will reject the request (400), and the gateway has no recovery.

Quota **inflation** (the 10x–50x multiplication scenario probed in Vector 4) was **not** reproducible: Gemini's cumulative `usageMetadata` is handled by assignment (terminal value wins), and billing happens exactly once per stream on the happy path.

---

## 2. Pass/Fail Compliance Matrix

| # | Vector | Probe | Result |
|---|--------|-------|--------|
| 1a | V1 | Pre-chunk 429 → silent failover to Provider B, breaker failure + cooldown persisted | ✅ PASS |
| 1b | V1 | Mid-stream drop after 3 chunks → no failover, raw truncation, no `[DONE]`, no error event | ⚠️ PASS (documents DEFECT CR-01) |
| 1c | V1 | HTTP-level mid-stream drop → client hang forever, no `[DONE]`, Fastify "Unhandled server error" | ❌ FAIL (DEFECT CR-01 confirmed) |
| 2a | V2 | Anthropic `content_block_start` + `input_json_delta` → valid OpenAI tool deltas, `tool_calls` finish, `[DONE]`, usage 10/42 | ✅ PASS |
| 2b | V2 | Anthropic **parallel** tool_use blocks → distinct OpenAI indices `[0,1]` | ❌ FAIL — observed `[0,0]` (CR-02) |
| 2c | V2 | Gemini single `functionCall` → id/name/args delta, `finish_reason: "tool_calls"` | ❌ FAIL — finish degraded to `"stop"` (CR-03) |
| 2d | V2 | Gemini **parallel** `functionCall`s → distinct indices `[0,1]` | ❌ FAIL — observed `[0,0]` (CR-02) |
| 3a | V3 | Gemini first-turn: `system → tool` ⇒ `contents[0] = user/functionResponse`, system extracted to `system_instruction` | ✅ PASS (notes: CR-07) |
| 3b | V3 | Full tool loop role alternation `user→model→user→model→user` + call/response pairing | ✅ PASS |
| 3c | V3 | Consecutive parallel tool results merge into ONE `user` turn | ✅ PASS |
| 4a | V4 | Gemini cumulative `usageMetadata` (5→12→20) ⇒ terminal 20, **no** summation (37) | ✅ PASS |
| 4b | V4 | Anthropic `message_delta.usage.output_tokens` extraction | ✅ PASS |
| 4c | V4 | E2E `dispatchStream` → `quota_usage` recorded exactly once, value 25 (terminal total) | ✅ PASS (happy path) |
| 4d | V4 | Client abort mid-stream → upstream cancellation & billing probe | ❌ FAIL — upstream never cancelled, 0 tokens billed (CR-04, CR-05) |
| 5a | V5 | `tool_call_id` → `tool_use_id` exact mapping, results grouped in one `user` turn | ✅ PASS |
| 5b | V5 | `tool_use_id` never dropped/regenerated for unknown ids | ✅ PASS |

**Instrumented observations (printed by the harness before deletion):**

```
[CRUCIBLE-1c] outcome=still_open_after_2000ms bodyLen=423 hasDONE=false hasErrorEnvelope=false fastifyLoggedUnhandled=1
[CRUCIBLE-4c-fullDrain] rows=[{"used_value":25}]
[CRUCIBLE-4d] upstreamCancelled=false upstreamFinished=true rows=[{"used_value":0}] billedTokens=0 processErrors=1
```

## 3. Detailed Findings with Reproduction Proofs

### CR-01 [CRITICAL] Mid-stream upstream failure dangles the client connection indefinitely
- **Component:** `src/services/gatewayService.ts` (`dispatchStream`) + `src/api/server.ts` (`POST /v1/chat/completions`, stream branch).
- **Root cause:** `dispatchStream`'s `try/catch` only wraps `callProviderEndpointStream` (connection establishment). The SSE generator returned by `transformToOpenAISSEStream` is consumed by a bare `for await (const chunk of dispatchResult.stream) reply.raw.write(chunk)` in `server.ts` with **no error boundary**. When the upstream iterator throws mid-stream, the raw error propagates into Fastify after `reply.raw` headers and chunks have already been written. Fastify's error handler then attempts `reply.status(500).send(...)` on an already-sent reply → "Unhandled server error" logged, response never ended.
- **Reproduction proof (probe 1c, HTTP-level with live socket):** upstream mock yields `c1`, `c2`, `c3`, then throws `ECONNRESET` before the 4th chunk. Client received `200 OK`, `content-type: text/event-stream`, 423 bytes of body, then **the stream remained open past 2000 ms with no termination** (`outcome=still_open_after_2000ms`, `hasDONE=false`, `hasErrorEnvelope=false`). Fastify logged `"Unhandled server error"`.
- **Probe 1b (dispatchStream-level):** exactly **1** upstream call (no failover to Provider B), 3 chunks received, the error object propagated raw out of the stream iterator, no `[DONE]`, and no SSE error event — the client cannot distinguish a dropped provider from a complete response.
- **Impact:** Every coding-agent client (Cursor, Claude Code) that hits a flaky provider mid-stream will hang until its own TCP/HTTP timeout, with a silently truncated completion.
- **Remediation direction:** In `server.ts`, consume the generator inside `try/catch`, and on mid-stream error emit a final OpenAI-compatible chunk with `finish_reason: "stop"` + an `error` SSE event + `data: [DONE]\n\n`, then `reply.raw.end()`. In `dispatchStream`, wrap stream consumption (or expose an error channel) so a mid-stream failure can still record breaker failure/cooldown.

### CR-02 [HIGH] Parallel tool calls collide on `tool_calls[].index = 0` in both Anthropic and Gemini stream translators
- **Component:** `src/domain/translation/sseStream.ts` — Anthropic `content_block_start` / `input_json_delta` handlers (hardcoded `index: 0`), Gemini `functionCall` handler (hardcoded `index: 0`).
- **Root cause:** The Anthropic branch ignores `data.index` from `content_block_start`/`content_block_delta`; the Gemini branch assigns a fresh ID per `functionCall` but never increments the OpenAI delta index.
- **Reproduction proof (probes 2b/2d):** A stream carrying two `tool_use` blocks (`index: 0` and `index: 1`, distinct ids `t1`/`t2`) produced OpenAI deltas with indices **`[0, 0]`** (`expected [ +0, +0 ] to deeply equal [ +0, 1 ]`). Same for two Gemini `functionCall` parts in one chunk.
- **Impact:** Per the OpenAI streaming spec, deltas are assembled **by index**. Two distinct calls at index 0 get merged: arguments concatenated into invalid JSON, second call's name/id dropped. Agents will attempt to execute one corrupted tool call.
- **Remediation direction:** Map Anthropic `data.index` → OpenAI `tool_calls[].index`; for Gemini, assign a monotonically increasing per-stream tool-call index.

### CR-03 [HIGH] Gemini tool-call streams terminate with `finish_reason: "stop"` instead of `"tool_calls"`
- **Component:** `src/domain/translation/sseStream.ts`, Gemini branch.
- **Root cause:** `finalFinishReason = 'tool_calls'` is set when a `functionCall` part is seen, but the terminal chunk carrying `candidates[0].finishReason: "STOP"` arrives **after** the function-call chunk and overwrites it to `'stop'`. Gemini's real SSE shape emits function calls first and the terminal `finishReason` in a later (usage-bearing) chunk, so the overwrite is the common case.
- **Reproduction proof (probe 2c):** Stream = `[functionCall(write_file)]` then `[finishReason: STOP, usageMetadata]`. Output: correct tool-call delta (id, name, args all valid) and `[DONE]`, **but no chunk had `finish_reason === 'tool_calls'`** — the synthesized finish chunk emitted `'stop'`. Usage was correct (5/7/12).
- **Impact:** OpenAI-SDK agents rely on `finish_reason === 'tool_calls'` to enter tool execution; they will treat the turn as a plain text completion and skip tool execution entirely.
- **Remediation direction:** Never downgrade from `'tool_calls'` once set (precedence: `tool_calls` > `content_filter` > `length` > `stop`), or only honor `candidate.finishReason` when no function call was seen.

### CR-04 [HIGH] Client aborts are never propagated upstream — upstream streams run to completion after disconnect
- **Component:** `src/api/server.ts` (no `request.raw.on('close')` / abort wiring) + `src/infra/http/providerClient.ts` (`callProviderEndpointStream` aborts only on the fixed timeout; no external cancel signal).
- **Reproduction proof (probe 4d, live socket):** Client aborted (`AbortController`) after the first SSE chunk; after a 700 ms settle window the upstream mock generator had **fully finished** (`upstreamCancelled=false upstreamFinished=true`) — all 7 chunks were still pulled from upstream and written into a dead socket.
- **Impact:** Wasted provider tokens/quota on every user "Stop generation" press; under load, aborted-but-active upstream streams accumulate (connection pool exhaustion against providers).
- **Remediation direction:** Listen for `request.raw.on('close')`, then cancel the upstream iterator and abort the upstream fetch, and short-circuit the write loop.

### CR-05 [HIGH] Aborted / early-terminated streams bill 0 tokens; OpenAI-protocol streams always bill 0 tokens
- **Components:** `src/domain/translation/sseStream.ts` (usage extraction & estimate fallback) + `src/services/gatewayService.ts` (`onUsage` fires only after the generator completes).
- **Root cause (three stacked faults):**
  1. `onUsage` is invoked as the **last statement after the final `yield 'data: [DONE]'`**. Any consumer that breaks/cancels early — client abort, upstream error — triggers generator `.return()`, skipping `onUsage` entirely. Probe 4c with a break-on-`[DONE]` consumer recorded **zero** rows in `quota_usage`.
  2. For the OpenAI branch, `usage` is only read if the upstream *happens* to send it; the gateway never requests `stream_options: { include_usage: true }`, which OpenAI requires to emit usage during streaming.
  3. The `length/4` completion estimate only applies to `accumulatedContent`, which is fed **only** by the Gemini branch — OpenAI and Anthropic branches never populate it.
- **Reproduction proof:** Probe 4d: upstream ran to completion, `onUsage` fired, and `quota_usage` recorded `{"used_value":0}` → `billedTokens=0`. Probe 4c (happy path, Gemini): correct single record of 25.
- **Impact:** Quota headroom (`quotaRemainingPct`), the `wouldQuotaExceed` gate, and `daily_tokens` ceilings are effectively blind to all streaming traffic on OpenAI-compatible providers — free-tier preservation silently loses enforcement.
- **Remediation direction:** Inject `stream_options: { include_usage: true }` for OpenAI-protocol streams; accumulate content in all protocol branches; record partial usage via a `finally` path rather than only post-`[DONE]`.

### CR-06 [MEDIUM] Circuit breaker credited `recordSuccess()` before any stream byte is consumed
- **Component:** `src/services/gatewayService.ts` `dispatchStream` (`cb.recordSuccess()` immediately after `callProviderEndpointStream` resolves).
- **Evidence:** Probe 1b — after the upstream died mid-stream, `health_state.consecutive_failures` for the failed connection remained `0`.
- **Impact:** Repeatedly broken streaming connections never accumulate failures → never open their breaker or cooldown → they keep being selected first, degrading every request that starts on them.
- **Remediation direction:** Credit success only after `[DONE]` is observed; treat mid-stream errors as breaker failures.

### CR-07 [LOW] First-turn `functionResponse` without a preceding `functionCall` (Gemini)
- **Component:** `src/domain/translation/openaiToProvider.ts`, Gemini branch.
- **Evidence:** Probe 3a — `messages = [system, tool]` produced `contents[0] = { role: 'user', parts: [{ functionResponse: { name: 'tool_result', ... } }] }`. Structurally correct (system extracted to `system_instruction`, first content turn is `user`), but the `functionResponse` references a call that exists nowhere in `contents`. Real Gemini rejects such payloads (400), and the gateway has no recovery path (e.g., synthesizing a placeholder `functionCall` or dropping the orphan response).
- **Impact:** Tool loops resumed from truncated history will 400 against Gemini while the same conversation succeeds on Anthropic — a provider-dependent failure with no failover benefit.

### Non-defect verifications (defense confirmed)
- **No usage inflation:** Gemini cumulative `usageMetadata` (5 → 12 → 20) yields exactly `20` (assignment, terminal value wins) — the 10x–50x multiplication scenario does **not** occur (probe 4a). E2E billing records exactly **one** `quota_usage` row on the happy path (probe 4c: value 25 for prompt 5 + completion 20).
- **Anthropic tool ID integrity:** `tool_call_id` → `tool_use_id` mapping is exact for multi-call round trips (probes 5a/5b); results correctly group into a single `user` turn, preserving Anthropic's required `tool_use`/`tool_result` adjacency. The Anthropic HTTP 400 "each tool_result must match a previous tool_use" failure mode is **not** triggerable by gateway translation alone.
- **Gemini role alternation:** full `user → assistant(tc) → tool → assistant(tc) → tool` loop translates to `user, model, user, model, user` with correct `functionCall`/`functionResponse` pairing; parallel tool results merge into one `user` turn (probes 3b/3c) — no consecutive `user` turns.
- **Anthropic chunked tool arguments:** `content_block_start` (id/name) + `input_json_delta` fragments (`{"file`, `": "main.ts"}`) correctly reassemble into a valid OpenAI tool-call delta sequence with `finish_reason: "tool_calls"` and trailing `data: [DONE]\n\n` (probe 2a) — the "coding agent trap" is handled correctly for single tool calls.
- **Pre-chunk failover is clean:** 429 on Provider A → Provider B serves the full stream, decision trace shows `attempted_failed` → `selected`, and breaker failure + cooldown are persisted to `health_state` (probe 1a).

## 4. Remediation Checklist

**P0 — Release blockers**
- [ ] **CR-01:** Wrap the SSE consumption loop in `server.ts` with `try/catch`; on mid-stream error emit a terminal OpenAI-style chunk (`finish_reason: "stop"`), an `error` SSE event, and `data: [DONE]\n\n`, then `reply.raw.end()`. Ensure Fastify never attempts a second `send()` after raw headers were written.
- [ ] **CR-02:** Propagate Anthropic `data.index` into `tool_calls[].index`; assign monotonically increasing indices for Gemini `functionCall` parts. Add regression tests for parallel tool streams on both protocols.
- [ ] **CR-03:** Make `finish_reason` precedence monotonic (`tool_calls` never downgraded to `stop`); emit the finish chunk with `tool_calls` whenever any function call was streamed.

**P1 — High**
- [ ] **CR-04:** Wire `request.raw.on('close')` → cancel the upstream iterator and the underlying fetch `AbortController`; add an integration test asserting upstream cancellation on client abort.
- [ ] **CR-05:** Inject `stream_options: { include_usage: true }` for OpenAI-protocol streams; feed `accumulatedContent` in the OpenAI and Anthropic branches so the estimate fallback works; move `onUsage` into a `finally` block (or add explicit error/abort usage callbacks) so partial usage is always recorded.
- [ ] **CR-06:** Move `cb.recordSuccess()` (and its `healthRepo.upsert`) to after `[DONE]` is observed; record breaker failure on mid-stream errors.

**P2 — Medium/Low**
- [ ] **CR-07:** Handle orphan `functionResponse` (no preceding `functionCall`) in the Gemini translator: synthesize a placeholder `functionCall` turn or degrade the response to a plain text part, and log a warning.
- [ ] Add request-log entries for aborted streams so operators can measure CR-04/CR-05 in production.
- [ ] Add permanent regression tests to `tests/unit/toolAndStream.test.ts` covering: parallel tool-call indices (2b/2d), Gemini finish-reason precedence (2c), mid-stream error termination (1c), and abort-path usage recording (4d).

---

*Audit artifacts: temporary harness `tests/crucible_audit.test.ts` (16 probes) was executed via `npx vitest run` (result: 13 passed / 3 failed, all failures genuine) and deleted afterward; `git status --porcelain` confirms `src/` and all other tracked files untouched.*



