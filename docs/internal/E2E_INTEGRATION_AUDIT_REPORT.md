# FULL-SYSTEM END-TO-END INTEGRATION AUDIT REPORT — GoalRoute Workstation

**Audit date:** 2026-09-09  
**Scope:** Cross-surface relational flows (Fastify daemon ↔ SQLite WAL ↔ React AppShell ↔ ThemeProvider ↔ SSE Stream)  
**Method:** Static source-level integration trace + prior live-socket probe evidence (`CRUCIBLE_AUDIT_REPORT.md`). No codebase files were modified.  
**Environment truth:** `src/` contains a real backend (Fastify 5 + better-sqlite3/WAL) and a React 19 web UI (`src/web/`), **but** the UI is NOT buildable/servable: there is no `index.html`, no Vite/webpack config, and no bundler in `package.json` (`build` = `tsc` only; `main.tsx` is dead entry code). The web UI therefore cannot be launched at any URL, so browser/DOM-level assertions were verified at the source/contract level.

---

## VERDICT TABLE (required format)

| Scenario | Sub-System Chain | Result (PASS/FAIL) | Observed Latency / Delta | Failure Notes & Memory Leaks |
|---|---|---|---|---|
| 1 — Upstream 429 Cascade & Real-Time Explainability | Fastify Daemon ↔ SSE Stream ↔ Cockpit ↔ Decision Inspector | **PARTIAL FAIL** | Pre-chunk failover: ~instant (probe 1a PASS); SSE push to UI: 0 ms emitted (endpoint absent) | Backend failover + breaker-cooldown persistence **PASS** (probe 1a: 429 → OPEN + cooldown persisted → Provider B serves stream, decisionTrace shows `attempted_failed` → `selected`). **FAIL:** no `GET /api/v1/request-logs/stream` exists anywhere (`server.ts` only exposes polling `GET /api/v1/request-logs`, no `text/event-stream` for logs). Cockpit's "Live Traffic" rows are hardcoded `SAMPLE_TRACES` (`CockpitDashboard.tsx:11`) and never receive the fallback event; no amber pulsing dot, no `⚠ Fallback` tag, no `Why? →` wiring to real logs. Inspector drawer copy works but operates on mock traces only. |
| 2 — Pool Mutation & Reactive Headroom Recalculation | AI Concierge ↔ Goal Studio ↔ Vault ↔ Cockpit | **FAIL** | Headroom delta 140%→280%: never occurs (UI is static) | `POST /api/v1/pools` exists but only creates a pool from an existing `goalId` (`server.ts:223-226`) — it cannot add a Cerebras connection. **No TanStack Query in dependencies** (package.json), so `['pools']`/`['health']` cache invalidation does not exist. Vault UI renders 6 hardcoded `INITIAL_KEYS` (`CredentialVault.tsx:17-84`) with zero fetch/mutation wiring; "Probe & Test All Keys" is a 600 ms `setTimeout` (spec: 400 ms per-card skeleton). Cockpit headroom stats are static literals (140%, etc.). No Concierge proposal card exists in any component. |
| 3 — Credential Revocation & Circuit Breaker Lockdown | Vault ↔ Core Routing Engine ↔ Cockpit Telemetry | **FAIL** | Zero upstream attempts to revoked provider: unreachable (no revoke path) | **No revoke endpoint exists** (`server.ts` exposes only `POST /providers`, `POST /providers/:id/test`, `GET /providers` — no DELETE/revoke). Backend `vault.ts` encrypt/decrypt exists but no purge route reaches it. Vault UI has **no `[Revoke]` button at all** (present only in the `PLAN/*.code.html` mockups). Capsule 1 count is `{keys.length} / {keys.length}` — cannot drop 3→2. **Related backend defect (IRONCLAD-2):** expired connections are NOT filtered from dispatch candidates, so even a DB-level revoke could still receive traffic. |
| 4 — Real-Time Dynamic Theming Under Full DOM Load | Settings Studio ↔ CSS Custom Engine ↔ All Surfaces | **PASS (with FOUC caveat)** | Propagation: instant (same-frame `style.setProperty`); persistence: `localStorage` sync | `ThemeProvider` holds all **15 tokens**, writes directly to `document.documentElement.style` on every change (`ThemeContext.tsx:114-124`) — no remount/reload, nav pills/borders/progress bars across Cockpit/Vault/Concierge all consume `var(--…)` and inherit instantly. Export = full `{preset, tokens}` JSON to clipboard; Reset restores `#090a0f` Obsidian. **Caveat (FOUC):** tokens are applied in a `useEffect` **after** first mount, not in a pre-hydration inline script — a hard reload can paint `globals.css` defaults for one frame before localStorage tokens apply. FOUC defense FAILS on strict interpretation. |
| 5 — Security Leak & Monospace LTR Scoping Audit | Memory Inspection ↔ DOM Tree ↔ Accessibility & Directionality | **FAIL (1 CRITICAL leak)** | Clipboard: clean (0 trailing newline/zero-width chars); RTL scoping: strong | **CRITICAL — SECRET EXPOSURE:** `CredentialVault.tsx:215` renders `{isVisible ? key.rawKey : key.maskedKey}` and `INITIAL_KEYS` embeds 6 full plaintext keys (`gsk_0192837465910293847592b1`, `sk-or-v1-8492…`, etc.) in the JS bundle → plaintext is always in DOM memory and React tree, violating the "masked-only" assertion. **RTL:** PASS broadly — `dir="ltr"` applied to metrics ribbon, TTFT, model names, JSON textarea, token counters, masked-key rows. **Clipboard:** Inspector JSON copy and Theme export use `JSON.stringify(...)` → no trailing whitespace/zero-width chars; however Agent-setup export commands and `gr_admin_…` token copy buttons exist only in `PLAN/*.code.html` mockups, not in the live app. |

---

## SCENARIO-BY-SCENARIO DETAIL

### Scenario 1 — 429 Cascade
- **Backend chain verified working:** `gatewayService.dispatch/dispatchStream` performs silent failover on upstream 429, records breaker failure + cooldown into SQLite, and the decision trace records `attempted_failed` → `selected` (Crucible probe 1a: PASS, live socket).
- **Blocker:** the log SSE stream (`/api/v1/request-logs/stream`) is not implemented. The only SSE surface is the upstream proxy stream (`/v1/chat/completions` stream branch). Cockpit cannot react in real time; the relay is broken at `Fastify → UI`.
- **Inspector:** `DecisionInspectorDrawer` renders a `✕ Cooldown Active` style candidate list with 4-factor bars and raw JSON + copy, but its data comes from `SAMPLE_TRACES`, not `/api/v1/request-logs`.

### Scenario 2 — Pool Mutation
- Every ingredient of the reactive chain is missing: no TanStack Query dependency at all (`react-query` absent from package.json), no connection-add API reachable from the UI, no Concierge component, hardcoded Vault and Cockpit data. The only dynamic state in the UI is local `useState` (theme tokens, key visibility, probe animation).

### Scenario 3 — Revocation
- Backend purge path does not exist; UI action does not exist. Additionally, expired connections are not excluded by the routing snapshot (`getPoolSteps` / dispatch snapshot do not filter `connection.status === 'expired'` — IRONCLAD finding #2), so the "zero attempts to revoked provider" guarantee cannot hold even manually.

### Scenario 4 — Theming
- Instant propagation, persistence, export (15 tokens), import, and factory reset all implemented and token-driven across every surface (verified token usage in AppShell, Cockpit, Vault, Settings, GoalStudioModal, InspectorDrawer). Only the FOUC defense (pre-first-paint injection into `index.html`) is missing.
- Minor bug found: `getHexForInput()` (`SettingsAppearanceStudio.tsx:48-54`) force-maps any `rgba(...)` border token to `#7c9cff` and non-hex tokens to `#121622`, so editing `--border-subtle` through the picker silently corrupts it to a hex value.

### Scenario 5 — Security & RTL
- **Plaintext keys ship in the client bundle** (`INITIAL_KEYS.rawKey`) and render into the DOM on eye-toggle. Masked display is correct only in default state.
- `dir="ltr"` scoping is consistently and correctly applied to monospace/telemetry nodes.
- Clipboard contents inspected: no trailing `\n`, no zero-width characters (JSON.stringify output); but admin-token / curl / export-command copy affordances are mock-only.

---

## CONSOLIDATED RANKING

1. **[CRITICAL]** Plaintext API keys rendered in DOM/bundle — `src/web/components/vault/CredentialVault.tsx:9,22-77,215`.
2. **[HIGH]** No `/api/v1/request-logs/stream` — realtime explainability chain broken by design gap (`src/api/server.ts:228` polling only).
3. **[HIGH]** Whole web layer is disconnected mock data — no fetch/mutation layer, no TanStack Query, no router; entry (`main.tsx`) not even bundled (no `index.html`/bundler).
4. **[HIGH]** No provider revoke/delete API; expired connections still receive traffic (backend).
5. **[MEDIUM]** Theme FOUC: tokens applied post-mount, not pre-paint.
6. **[MEDIUM]** Vault probe uses 600 ms simulated timer vs spec 400 ms; per-card `[Test Handshake]` not wired to `POST /providers/:id/test`.
7. **[LOW]** Color-picker `rgba→hex` coercion bug in Settings Studio.
8. **[LOW]** Concierge rail message is a single hardcoded string (`AppShell.tsx:14`); no proposal cards.

## VERDICT SUMMARY

| Scenario | Result |
|---|---|
| 1 | PARTIAL FAIL (backend PASS, realtime UI chain FAIL) |
| 2 | FAIL |
| 3 | FAIL |
| 4 | PASS (FOUC caveat) |
| 5 | FAIL (critical plaintext-key leak; RTL/clipboard PASS) |

**Overall: 1 PASS / 1 PARTIAL / 3 FAIL out of 5 full-system flows. The backend daemon is production-hardening well (per prior audits), but the workstation UI is a static mock and cannot participate in any live relational flow.**
