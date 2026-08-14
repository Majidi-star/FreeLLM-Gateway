# FreeLLM-Gateway — Agent Context

## What this project is
A self-hosted OpenAI-compatible gateway proxy + React dashboard.
It pools free LLM API endpoints, handles rate limits, semantic caching, virtual keys, and model failover.
Designed to work as a drop-in replacement for `http://localhost:3000/v1`.

## Stack
- **Backend:** Node.js + Express (`server/`) — no TypeScript, plain ESM JS
- **Frontend:** React 19 + TypeScript + Vite (`src/`) — vanilla CSS (no Tailwind)
- **DB:** Flat-file JSON (`config.json`) — loaded/saved by `server/db.js`
- **Dev:** `npm run dev` starts both concurrently (backend :3000, frontend :5173)

## Architecture map

| File | Role |
|---|---|
| `server/index.js` | Express app, all management REST API routes (~41KB, main entry) |
| `server/router.js` | Failover queue loops, payload translation, provider routing (~20KB) |
| `server/db.js` | Config loader/saver, all state management (~19KB) |
| `server/mcp.js` | stdio MCP JSON-RPC 2.0 server for Claude Desktop etc. (~21KB) |
| `server/rateLimiter.js` | Sliding-window RPM/RPD trackers (~8KB) |
| `server/cache.js` | Semantic cache with cosine similarity (~4KB) |
| `server/proxy.js` | HTTP/HTTPS/SOCKS5 proxy agent builder (~2KB) |
| `config.json` | Local flat-file DB — providers, keys, pools, aliases (~99KB, git-ignored) |
| `src/App.tsx` | Tab controller, main layout (~13KB) |
| `src/components/GatewaySetup.tsx` | Provider config UI (~39KB, largest component) |
| `src/components/ActivePools.tsx` | Virtual model pool editor (~24KB) |
| `src/components/AgentChat.tsx` | Sidebar chat client (~39KB) |
| `src/components/Playground.tsx` | Model tester + benchmark table (~17KB) |
| `src/components/Sandbox.tsx` | Real-time trace logger (~13KB) |
| `src/components/Directory.tsx` | Free API signup links table (~5KB) |
| `src/utils/api.ts` | Axios API helpers (~8KB) |
| `src/utils/freeModelsDb.ts` | Seeded free provider database (~8KB) |

## Key concepts
- **Virtual Pool:** A named model alias (e.g. `coding-agent`) that maps to a priority queue of real model backends with automatic failover on rate limit or error.
- **Virtual Key:** A gateway-scoped API key with per-key RPM/RPD budgets. Used to share the gateway safely.
- **Model Alias/Redirect:** Rewrites an incoming model name (e.g. `gpt-4o`) to a pool or real model transparently.
- **Semantic Cache:** Stores embeddings of past prompts; returns cached completions on cosine-similarity match above threshold.
- **MCP Server:** `server/mcp.js` exposes 9 tools over stdio for Claude Desktop / Cline integration.

## Conventions
- All backend files are plain `.js` ESM modules
- Frontend uses `.tsx` / `.ts` with strict TypeScript
- `config.json` is the single source of truth for runtime state — never hardcode values
- Proxy support: per-provider HTTP/HTTPS/SOCKS5 via `server/proxy.js`
- No ORM, no SQL — everything is JSON in-memory with periodic disk flush

## Owner
GitHub: Majidi-star/FreeLLM-Gateway
