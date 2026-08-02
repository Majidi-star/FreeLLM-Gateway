# [Revision] Global Persistent Chat Assistant Sidebar

This plan moves the Chat Assistant out of a separate tab and places it into a **persistent, global right sidebar** visible across all tabs. It also equips the agent with direct access to all app documentation and implements a state synchronization callback so that dashboard tabs instantly refresh when the assistant performs an action (e.g., syncing a provider).

---

## User Review Required

> [!IMPORTANT]
> * **Layout Structure:** The dashboard main layout will split into a flexible-width left pane (Directory, Setup, Pools, Connect) and a fixed `380px` right pane hosting the persistent chat sidebar.
> * **State Synchronization:** The sidebar will invoke a parent callback `onConfigChange()` whenever tool execution traces indicate database updates. This triggers a data reload in the active tab.
> * **Knowledge Base Tool:** We will add `get_app_documentation()` to the backend toolset, providing the agent with markdown specifications of the entire proxy architecture, virtual pools, rate limit rules, and client setup guides.

---

## Proposed Changes

### 1. Backend Agent Documentation Tool
#### [MODIFY] [index.js](file:///c:/Projects/Free-LLM-Provider/server/index.js)
* Add `get_app_documentation()` to `ASSISTANT_TOOLS` and implement its handler in `executeLocalTool`.
* The tool will return a detailed guide covering:
  - Gateway purpose and port (`3000`).
  - Virtual routing pools (`strong-reasoning`, `coding-agent`, `fast-flash`).
  - Configuration files (`config.json` database schema).
  - MCP client setups (Claude Desktop, Cursor).

---

### 2. Sidebar UI Layout & Synchronization
#### [MODIFY] [Sandbox.tsx](file:///c:/Projects/Free-LLM-Provider/src/components/Sandbox.tsx)
* Accept `onConfigChange?: () => void` prop.
* If the API response contains tool traces (`res.traces.length > 0`), invoke `onConfigChange()` to trigger a parent state refresh.
* Redesign the UI into a single-column layout:
  - Header: Compact row with Model selector, Proxy toggle checkbox, and Clear button.
  - Middle: Scrollable chat bubble window.
  - Bottom: Unified message input form.

#### [MODIFY] [App.tsx](file:///c:/Projects/Free-LLM-Provider/src/App.tsx)
* Remove the `5. Test Gateway` tab since the chat is now globally persistent.
* Add a `showAssistant` boolean state.
* Render a `💬 Assistant` header button in the top right to toggle the sidebar visibility.
* Render the chat assistant `<Sandbox onConfigChange={fetchInitialData} />` in the right column of the main grid layout when `showAssistant` is active.

---

## Verification Plan

### Manual Verification
1. **Global Visibility:** Navigate between Directory, Gateway Setup, and Active Pools. Confirm the chat sidebar remains visible and sticky.
2. **Toggle Sidebar:** Click the header button to hide/show the assistant sidebar.
3. **Instant Visual Sync:** With the Setup tab active, type *"sync groq"* in the sidebar chat. Confirm that once the tool completes, the model count for Groq instantly updates in the table.
