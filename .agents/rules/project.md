# FreeLLM-Gateway — Agent Rules

## Code style
- Backend: plain ESM JS, no TypeScript. Keep it consistent.
- Frontend: React functional components with hooks only. No class components.
- CSS: vanilla CSS only, no Tailwind or CSS-in-JS.
- Never add new npm dependencies without asking first — this is a lean project.

## File reading strategy
- ALWAYS check AGENTS.md at project root first before exploring files.
- For backend changes: start with `server/index.js` (routes) or `server/db.js` (state), then drill down.
- For frontend changes: start with `src/App.tsx` (tab structure), then the specific component.
- `config.json` is ~99KB — never read the whole file. Use grep to find specific keys.
- Use grep_search before view_file whenever possible to pinpoint exact lines.

## Architecture constraints
- All persistent state lives in `config.json` via `server/db.js` — do not introduce other storage.
- All API routes are in `server/index.js` — do not split routes into separate files.
- The MCP server (`server/mcp.js`) must stay stdio-based and JSON-RPC 2.0 compliant.
- Virtual pools, keys, and aliases must go through `db.js` functions, not direct JSON mutations.

## Common pitfalls
- The backend runs on port 3000 (both API and static serving). Frontend dev server is on :5173.
- `config.json` is git-ignored — never suggest committing it.
- Rate limiter uses sliding windows — do not confuse RPM (per-minute) with RPD (per-day) windows.
- Semantic cache uses cosine similarity — threshold is configurable, default ~0.95.
