# Implementation Plan - Task 4: Virtual Gateway Keys & Budgets

This plan implements **Virtual Gateway Keys & Budgets** to allow users to generate custom API keys with request rate-limits (RPM / RPD) to share access to the gateway pools safely.

---

## Proposed Changes

### 1. Database Schema
#### [MODIFY] [db.js](file:///c:/Projects/Free-LLM-Provider/server/db.js)
* Add `virtualKeys: []` to `DEFAULT_CONFIG`.
* Update `loadConfig()` to merge the `virtualKeys` array from config file or fall back to `[]`:
  ```javascript
  merged.virtualKeys = parsed.virtualKeys || [];
  ```

---

### 2. Request Authentication Middleware
#### [MODIFY] [index.js](file:///c:/Projects/Free-LLM-Provider/server/index.js)
* Implement a `validateVirtualKey` validation middleware function:
  - If `virtualKeys` is empty, let requests pass through unimpeded (no authentication required).
  - If `virtualKeys` contains entries, parse the incoming request `Authorization` Bearer token header.
  - Verify that the token matches an enabled virtual key.
  - Evaluate the key's sliding window history against configured limits (RPM / RPD).
  - If rate-limited, return `429 Too Many Requests`. If invalid, return `401 Unauthorized`.
  - Save the pruned history timestamps to the configuration file.
* Inject `validateVirtualKey` into `/v1/chat/completions` and `/v1/models` route pathways.

---

### 3. Frontend Key Manager Drawer
#### [MODIFY] [api.ts](file:///c:/Projects/Free-LLM-Provider/src/utils/api.ts)
* Update `GatewayConfig` interface to declare `virtualKeys`:
  ```typescript
  export interface VirtualKey {
    id: string;
    name: string;
    enabled: boolean;
    limits: { rpm: number; rpd: number };
    usage?: { requests: number[] };
  }
  
  export interface GatewayConfig {
    ...
    virtualKeys?: VirtualKey[];
  }
  ```

#### [MODIFY] [GatewaySetup.tsx](file:///c:/Projects/Free-LLM-Provider/src/components/GatewaySetup.tsx)
* Append a **Virtual Gateway Keys Manager** settings card.
* Display a list of active virtual keys showing:
  - Key identifier name.
  - Raw key string value (with a button to copy to clipboard).
  - RPM and RPD rate limits.
  - Active toggle to enable/disable the key.
  - Delete button to revoke the key.
* Add a **+ Generate Gateway Key** form allowing users to assign:
  - A descriptive key name (e.g. Aider key).
  - RPM limit (default `10`).
  - RPD limit (default `500`).
* Sync state changes using `onSave(updatedConfig)`.

---

## Verification Plan

### Manual Verification
1. **Create Virtual Key:** In Gateway Setup, add a key named "Test Aider Key" with `rpm: 2`.
2. **Execute Auth Request:** Send a request to `localhost:3000/v1/chat/completions` using the generated bearer key. Verify completion is returned.
3. **Execute Unauth Request:** Send a request without the header and verify it is rejected with `401 Unauthorized`.
4. **Exceed rate limits:** Query the endpoint three times inside one minute; verify the third request fails with `429`.
