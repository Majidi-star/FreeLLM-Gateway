# Competitor Feature Gaps - Technical Roadmap

This task list maps out the exact code changes and file locations required to implement the four gap-closing features.

---

## Task 1: Model Aliasing & Redirection Rules

* **Goal:** Enable legacy coding clients to query model IDs like `gpt-4` and have the gateway translate them on-the-fly to our virtual pools (e.g. `strong-reasoning`).
* **Technical Tasks:**
  - [ ] **Database Schema:** In `config.json`, add an `aliases` dictionary:
    ```json
    "aliases": {
      "gpt-4": "strong-reasoning",
      "gpt-4-turbo": "strong-reasoning",
      "claude-3-5-sonnet": "coding-agent"
    }
    ```
  - [ ] **Router Logic (`server/router.js`):** In `routeChatCompletion(reqPayload, res)`, intercept the request at the very first line:
    ```javascript
    const config = loadConfig();
    if (config.aliases && config.aliases[reqPayload.model]) {
      const targetModel = config.aliases[reqPayload.model];
      eventLog(`Aliasing model request from "${reqPayload.model}" to target pool "${targetModel}"`);
      reqPayload.model = targetModel;
    }
    ```
  - [ ] **Frontend Panel (`src/components/ActivePools.tsx`):**
    - Add an "Aliasing & Redirect Rules" table card.
    - Render rows of `Requested Model` -> `Target Pool/Model`.
    - Provide form inputs to dynamically add/remove alias mappings.

---

## Task 2: Multi-Account Load Balancing (Weighted Round-Robin)

* **Goal:** Allow users to add multiple API keys for the same provider (e.g., 3 different Groq accounts) to multiply effective free-tier RPM rate limits.
* **Technical Tasks:**
  - [ ] **Database Schema:** Extend the `Provider` schema in `config.json` to support a `keys` array:
    ```json
    {
      "id": "groq",
      "name": "Groq",
      "enabled": true,
      "keys": [
        { "id": "key-1", "apiKey": "gsk_...", "weight": 5, "enabled": true },
        { "id": "key-2", "apiKey": "gsk_...", "weight": 5, "enabled": true }
      ]
    }
    ```
  - [ ] **Router Selection (`server/router.js`):** Update the target selection block (around line 153). When resolving targets:
    - If a target provider has multiple enabled keys, calculate a weighted selection index (skipping keys currently on individual cooldowns).
    - Swap the `Authorization: Bearer [apiKey]` header to use the chosen weighted credential.
  - [ ] **Frontend UI (`src/components/GatewaySetup.tsx`):**
    - Inside the provider configuration drawer, change the single "API Key" input into a list manager where users can click **+ Add Account Key**, assign weights, and toggle individual accounts.

---

## Task 3: Local SQLite Semantic Cache

* **Goal:** Bypass rate limits and API latencies entirely by returning vector-cached responses for semantically similar prompts.
* **Technical Tasks:**
  - [ ] **Cache Helper (`server/cache.js`):**
    - Initialize a local `cache.db` SQLite database:
      ```sql
      CREATE TABLE IF NOT EXISTS semantic_cache (
        id TEXT PRIMARY KEY,
        prompt TEXT,
        completion TEXT,
        embedding TEXT,
        created_at INTEGER
      );
      ```
  - [ ] **Similarity Checker:** Implement a lightweight cosine-similarity comparison. Use a free embedding endpoint (e.g., Cohere/HuggingFace free keys) or a local TF-IDF character-gram intersection script to compute string vector proximity.
  - [ ] **Router Check (`server/router.js`):** Before executing target routing:
    - Compute the similarity of the incoming prompt against cached prompts.
    - If a prompt has a similarity index $> 0.92$, intercept the request and return the cached `completion` content instantly with a header `x-gateway-cache: hit`.
    - On cache miss, proceed to API call, and insert response to `cache.db`.

---

## Task 4: Virtual Gateway Keys & Budgets

* **Goal:** Generate custom local API keys with usage limits so the pool can be shared safely with friends or client tools.
* **Technical Tasks:**
  - [ ] **Database Schema:** Add a `virtualKeys` array to `config.json`:
    ```json
    "virtualKeys": [
      {
        "id": "sk-gw-aider",
        "name": "Aider Dev Key",
        "enabled": true,
        "limits": { "rpm": 10, "rpd": 500 },
        "usage": { "requestsToday": 0, "lastRequest": 0 }
      }
    ]
    ```
  - [ ] **Middleware Guard (`server/index.js`):**
    - Add a middleware `app.use('/v1/*', (req, res, next) => { ... })` preceding route executions.
    - Extract `Bearer <Token>` from headers. If it matches a key in `virtualKeys`:
      - Verify that the rate limits (RPM/RPD) for this specific key have not been exceeded.
      - Increment its daily counter.
      - Allow the request to pass to the router.
      - If verification fails, return a `429 Too Many Requests` reporting the exceeded virtual key quota.
  - [ ] **Frontend Manager (`src/components/GatewaySetup.tsx`):**
    - Add a "Virtual Key Manager" section.
    - Expose controls to **Generate Gateway Key**, edit limit rules, and view statistics for active tokens.
