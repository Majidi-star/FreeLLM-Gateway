# Implementation Plan - Task 1: Model Aliasing & Redirection Rules

This plan implements **Model Aliasing & Redirection Rules** to map arbitrary model requests (such as `gpt-4` or `claude-3-5-sonnet`) to our local virtual pools (like `strong-reasoning` or `coding-agent`) automatically.

---

## Proposed Changes

### 1. Backend Config Schema & Interception
#### [MODIFY] [db.js](file:///c:/Projects/Free-LLM-Provider/server/db.js)
* Add `aliases: {}` to `DEFAULT_CONFIG`.
* In `loadConfig()`, merge the aliases object from the loaded config or fall back to an empty object:
  ```javascript
  merged.aliases = parsed.aliases || {};
  ```

#### [MODIFY] [router.js](file:///c:/Projects/Free-LLM-Provider/server/router.js)
* At the beginning of `routeChatCompletion(reqPayload, res, onRoutingEvent)`, intercept the requested model ID:
  ```javascript
  const config = loadConfig();
  if (config.aliases && config.aliases[reqPayload.model]) {
    const aliasedModel = config.aliases[reqPayload.model];
    eventLog(`Aliasing model request from "${reqPayload.model}" to target pool "${aliasedModel}"`);
    reqPayload.model = aliasedModel;
  }
  ```

---

### 2. Frontend Integration
#### [MODIFY] [api.ts](file:///c:/Projects/Free-LLM-Provider/src/utils/api.ts)
* Add `aliases?: Record<string, string>;` to `GatewayConfig` interface.

#### [MODIFY] [ActivePools.tsx](file:///c:/Projects/Free-LLM-Provider/src/components/ActivePools.tsx)
* Render a new **Model Redirection Rules** card at the bottom of the page.
* Display a table of current mapping rules.
* Provide input fields to create a new mapping rule:
  - **Requested Model Name** (e.g. `gpt-4`)
  - **Target Pool / Model** (dropdown list of virtual pools and direct models)
  - Action buttons: **Add Rule** and inline **Delete** buttons.
* Save changes by invoking `onSave(updatedConfig)`.

---

## Verification Plan

### Manual Verification
1. **Create Redirect Rule:** In the **Active Pools** tab, add a redirection rule mapping `gpt-4` to `strong-reasoning`.
2. **Execute Test:** Query the gateway using `cURL` or the chat sidebar requesting model `gpt-4`.
3. **Verify Routing Event:** Check the logs/routing history to verify the request was mapped to `strong-reasoning` and resolved to a free provider.
