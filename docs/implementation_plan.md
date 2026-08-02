# Implementation Plan - Task 2: Multi-Account Load Balancing (Weighted Round-Robin)

This plan implements **Multi-Account Load Balancing** to distribute requests across multiple API keys of the same provider (e.g. multiple Groq keys) to multiply rate limit capacity and fail over individual keys.

---

## Proposed Changes

### 1. Database Schema
#### [MODIFY] [db.js](file:///c:/Projects/Free-LLM-Provider/server/db.js)
* Update the default provider object definition to include an optional `apiKeys` array:
  ```javascript
  apiKeys: []
  ```

---

### 2. Router Selection & Per-Key Rate Limiting
#### [MODIFY] [router.js](file:///c:/Projects/Free-LLM-Provider/server/router.js)
* Enhance target resolution in `routeChatCompletion` to handle multi-key selection.
* If a provider has multiple custom keys:
  - Check the rate limits for each individual key by calling `checkRateLimit` with a temporary provider configuration where the `id` is formatted as `providerId:keyId`.
  - Filter down to the eligible (non-limited) keys.
  - Distribute requests among eligible keys using a **Weighted Random Selection** algorithm based on the keys' configured weights.
  - Substitute the request authentication header to use the chosen key.
  - If a key request fails (e.g., returns 429), place *only that specific key* (using `providerId:keyId`) on cooldown instead of disabling the entire provider.

---

### 3. Frontend Multi-Key Management
#### [MODIFY] [api.ts](file:///c:/Projects/Free-LLM-Provider/src/utils/api.ts)
* Update the `Provider` interface definition to support the `apiKeys` schema:
  ```typescript
  export interface ProviderKey {
    id: string;
    key: string;
    weight: number;
    enabled: boolean;
  }
  
  export interface Provider {
    ...
    apiKeys?: ProviderKey[];
  }
  ```

#### [MODIFY] [GatewaySetup.tsx](file:///c:/Projects/Free-LLM-Provider/src/components/GatewaySetup.tsx)
* Redesign the provider settings form inside the configuration drawer:
  - If a provider is expanded, show a **"Manage Keys & Accounts"** section.
  - Provide a list of keys with:
    - Key input box (masked by default).
    - Weight input field (number, default `1`).
    - Toggle switch to Enable/Disable the key.
    - Delete button to remove the key.
  - Add a **+ Add Account Key** button to append a new credential slot.
  - On save, sync the updated keys list back to the configuration file.

---

## Verification Plan

### Manual Verification
1. **Add Multiple Keys:** In Gateway Setup, configure two different API keys for Groq (e.g. Groq account A and Groq account B) with equal weights.
2. **Execute Multi-Requests:** Send 10 completions in the chat sidebar.
3. **Verify Distribution:** Check the logs to confirm that the requests were balanced across the two key IDs (e.g. alternating between key 1 and key 2).
