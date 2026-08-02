# LLM Free Pool Gateway Checklist

## Backend Development
- [x] Initialize project package.json and install Node dependencies
- [x] Create `server/db.js` for handling persistent configurations in `config.json`
- [x] Create `server/proxy.js` to build HTTP/HTTPS/SOCKS5 proxy agents
- [x] Create `server/rateLimiter.js` to manage windows for RPM/TPM limits
- [x] Create `server/router.js` for priority-based fallback and routing logic
- [x] Create `server/index.js` Express server with OpenAI-compatible routes and GUI API

## Frontend Development
- [x] Initialize Vite React + TypeScript project
- [x] Configure Tailwind-free custom CSS framework (`src/index.css`)
- [x] Create global dashboard container and connection state in `src/App.tsx`
- [x] Create `src/components/Dashboard.tsx` displaying statistics
- [x] Create `src/components/ProvidersList.tsx` for keys and proxy configs
- [x] Create `src/components/RoutingRules.tsx` for visual drag-and-drop priorities
- [x] Create `src/components/Sandbox.tsx` chat testing with execution traces
- [x] Create `src/components/LogsViewer.tsx` to inspect routing operations

## Verification
- [x] Create `test-gateway.js` mock testing script
- [x] Manually verify API routes and proxy routing
- [x] Build final production bundle and document usage in `walkthrough.md`

## Database & Integration Hub Additions
- [x] Create `src/utils/freeModelsDb.ts` containing structured data of free APIs
- [x] Create `src/components/FreeModelsDb.tsx` interactive search database UI
- [x] Create `src/components/IntegrationHub.tsx` client connection guide UI
- [x] Integrate new tabs into `src/App.tsx` and build the production assets
- [x] Verify database search functionality and API test curl execution

## Simplified Gateway & Dynamic Sync Revision
- [x] Implement backend dynamic models fetcher `/api/providers/:providerId/sync-models`
- [x] Create frontend directory component `src/components/Directory.tsx`
- [x] Create frontend setup component `src/components/GatewaySetup.tsx`
- [x] Create frontend active pools priority list `src/components/ActivePools.tsx`
- [x] Update `src/components/Sandbox.tsx` to include both Chat and Trace Logs
- [x] Simplify navigation tabs in `src/App.tsx` and compile production build
- [x] Verify dynamic model syncing and priority fallbacks

## Dynamic CRUD Providers & 26-Seeded Registries
- [x] Seed all 26 providers from repository README in `server/db.js`
- [x] Implement dynamic provider lists in `src/components/Directory.tsx`
- [x] Add inline create, edit, delete buttons for custom providers in `GatewaySetup.tsx`
- [x] Update client `Provider` typescript interface in `src/utils/api.ts`
- [x] Recompile Vite React production build and restart Express daemon server
- [x] Validate routing and config re-creation via mock client tests

## Model Context Protocol (MCP) Server Additions
- [x] Create `server/mcp.js` JSON-RPC stdio protocol server exposing tools
- [x] Update `src/components/IntegrationHub.tsx` to include MCP configuration guides
- [x] Compile the updated frontend assets and test the mcp server on stdio
- [x] Update `walkthrough.md` to document the MCP integration setup steps

## Agentic Chat Assistant Revision
- [x] Implement backend `/api/chat-assistant` with function calling loop and MCP tools
- [x] Redesign `src/components/Sandbox.tsx` to support the agentic chat assistant UI
- [x] Connect selected model and custom proxy overrides to chat API calls
- [x] Build and verify chat agent functionality (sync, CRUD, and basic questions)

## Persistent Sidebar Chat Assistant
- [x] Add `get_app_documentation` tool to backend agent
- [x] Redesign `src/components/Sandbox.tsx` into a single-column global sidebar widget with an `onConfigChange` callback
- [x] Modify `src/App.tsx` main grid layout to render the persistent sidebar and toggle button
- [x] Rebuild Vite React production assets and test the live sidebar reload behaviour

## Task 1: Model Aliasing & Redirection Rules
- [x] Add `aliases` property and merge logic to `server/db.js`
- [x] Implement alias lookup interception in `server/router.js`
- [x] Update `GatewayConfig` interface definition in `src/utils/api.ts`
- [x] Build a redirection rules editor in `src/components/ActivePools.tsx`
- [x] Compile and verify model aliasing end-to-end

## Task 2: Multi-Account Load Balancing
- [x] Support `apiKeys` array in `server/db.js` seed default templates
- [x] Implement weighted key selection and individual key rate-limiting in `server/router.js`
- [x] Declare `apiKeys` in the frontend `Provider` interface in `src/utils/api.ts`
- [x] Build the Multi-Key Accounts manager section in `src/components/GatewaySetup.tsx`
- [x] Build and verify multi-account load balancing round-robin distribution

## Task 3: Local SQLite Semantic Cache
- [x] Install `sqlite3` dependency using npm (Handled via resilient pure-JS file-backed database)
- [x] Create `server/cache.js` containing SQLite table creation and cosine similarity checks
- [x] Inject cache lookup, stream chunking, and insertion in `server/router.js`
- [x] Expand client API configuration options in `src/utils/api.ts`
- [x] Build the Semantic Cache manager panel in `src/components/ActivePools.tsx`
- [x] Verify semantic cache hits and streaming completions end-to-end

## Task 4: Virtual Gateway Keys & Budgets
- [x] Support `virtualKeys` array in `server/db.js` seed default templates
- [x] Implement sliding-window key authentication middleware in `server/index.js`
- [x] Declare `virtualKeys` in the frontend config interface in `src/utils/api.ts`
- [x] Build the Virtual Gateway Keys manager panel in `src/components/GatewaySetup.tsx`
- [x] Compile and verify virtual key routing and budgets end-to-end
