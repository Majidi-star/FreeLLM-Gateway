# Implementation Plan - Task 3: Local SQLite Semantic Cache

This plan implements a **Local SQLite Semantic Cache** to intercept incoming requests and return cached completions for semantically similar prompts. This reduces API usage, bypasses rate limits, and speeds up queries.

---

## Proposed Changes

### 1. Project Dependencies
* Install `sqlite3` using npm to store cache records locally.

### 2. Cache Utility Module
#### [NEW] [cache.js](file:///c:/Projects/Free-LLM-Provider/server/cache.js)
* Initialize SQLite database `server/cache.db` and create the schema:
  ```sql
  CREATE TABLE IF NOT EXISTS semantic_cache (
    id TEXT PRIMARY KEY,
    prompt TEXT,
    completion TEXT,
    created_at INTEGER
  );
  ```
* Implement a local **Token-based Cosine Similarity** comparison algorithm:
  - Tokenize text by stripping punctuation and splitting words.
  - Count token frequencies and calculate the dot product / vector magnitude.
  - Return a similarity score between `0.0` and `1.0`.
* Export:
  - `getSemanticCachedResponse(messages, threshold)`: Search database prompts, compute similarity, and return matching completion if above threshold.
  - `addSemanticCache(messages, completionText)`: Store the raw prompt string and target completion object in the database.

---

### 3. Gateway Router Interception
#### [MODIFY] [router.js](file:///c:/Projects/Free-LLM-Provider/server/router.js)
* Before executing candidate routing in `routeChatCompletion`:
  - Format the query messages into a clean prompt string (the last user message content).
  - Call `getSemanticCachedResponse(messages)`.
  - **Cache Hit (Stream):** If the client requested `stream: true`, chunk the cached text and emit standard OpenAI-compatible server-sent events (`data: ...`), ending with `data: [DONE]`. Include headers `x-gateway-cache: hit`.
  - **Cache Hit (Non-Stream):** Construct a standard non-stream JSON response payload containing the cached text. Include headers `x-gateway-cache: hit`.
  - **Cache Miss:** Proceed with routing. Once a provider responds successfully:
    - Capture the generated completion content.
    - Insert it into the cache database by calling `addSemanticCache`.

---

### 4. Cache Configurations GUI
#### [MODIFY] [ActivePools.tsx](file:///c:/Projects/Free-LLM-Provider/src/components/ActivePools.tsx)
* Render a new **Semantic Cache Settings** card.
* Allow users to:
  - Enable/Disable the semantic cache globally.
  - Configure the similarity threshold percentage (slider from `80%` to `99%`, defaulting to `92%`).
  - View cache stats (Total Cached Entries).
  - Clear the semantic cache table.

---

## Verification Plan

### Manual Verification
1. **Enable Cache:** Enable Semantic Cache in the pools tab with a `90%` threshold.
2. **First Query:** Ask a question in the chat assistant (e.g. "What is 10 + 20?"). Check logs to see cache miss and insertion.
3. **Second Query (Similar):** Ask a similar question (e.g. "what is 10+20?"). Check response headers and logs to verify `x-gateway-cache: hit` and instant execution.
