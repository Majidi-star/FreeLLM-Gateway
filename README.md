# 🌐 LLM Free Pool Gateway & Dashboard

An OpenAI-compatible self-hosted gateway proxy server and glassmorphic management dashboard. It pools free API endpoints, syncs models dynamically, automatically handles rate limits, routes priorities, handles proxy tunnels, and logs API token usage and cost savings.

Designed for developers, agentic systems, and IDE tools (like Cursor, Aider, and Claude Code) to leverage permanently free LLM endpoints and trial credits without manual provider management.

---

## 🌟 Key Features

* **OpenAI-Compatible Endpoint (`http://localhost:3000/v1`):** Drop-in replacement for any SDK or application targeting the OpenAI API spec.
* **Interactive Playground:** Run test prompts, configure parameters (temperature, top_p, max_tokens), check precise response latencies, and review benchmark tables displaying which model and provider served your request.
* **Virtual Routing Pools (Active Pools):** Map generic model tags (e.g. `strong-reasoning`, `coding-agent`) to priority queues of model backends. Automatically fails over to next candidates if rate limits (RPM/RPD) are reached or server errors occur.
* **Semantic Caching:** Speed up repeated requests and save API credits by matching prompts against cached completions with a configurable cosine similarity threshold.
* **Virtual API Keys & Budgets:** Generate custom gateway access tokens with individual RPM/RPD sliding-window rate limit budgets to securely share your gateway with team members or external agent tools.
* **Dynamic Model Synchronization:** Sync provider model lists dynamically directly from API endpoints, eliminating hardcoded model listings.
* **Model Redirection Aliases:** Set redirection aliases (e.g., rewriting requests for `gpt-4o` to route automatically to a local pool or free model).
* **Agent & MCP Server Integration:** A stdio-based Model Context Protocol (MCP) server enables external agent tools (like Claude Desktop or Cline) to dynamically audit status, list providers, query logs, and manage pools or keys.
* **Global & Per-Provider Proxies:** Support HTTP/HTTPS/SOCKS5 proxy agents globally or individually per provider to bypass geographic restrictions or handle latency rules.

---

## 📂 Project Architecture

```
Free-LLM-Gateway/
 ├── server/                    # Node.js Express Backend
 │    ├── cache.js              # Semantic cache manager & vector index
 │    ├── db.js                 # persistent configuration loader (config.json)
 │    ├── mcp.js                # stdio MCP JSON-RPC 2.0 tool server
 │    ├── proxy.js              # HTTP/HTTPS & SOCKS5 proxy tunnel agents
 │    ├── rateLimiter.js        # sliding-window request & token trackers
 │    ├── router.js             # failover queue loops & payload translations
 │    └── index.js              # Express server and management API routes
 ├── src/                       # React Frontend Client (Vite + TS)
 │    ├── components/
 │    │    ├── Directory.tsx    # Table of seeded free API signup links & limits
 │    │    ├── GatewaySetup.tsx # Custom provider configuration & dynamic sync
 │    │    ├── ActivePools.tsx  # Virtual model priority list editor (Auto-save)
 │    │    ├── Playground.tsx   # Model tester, benchmarks, & latency tracker
 │    │    └── Sandbox.tsx      # Sidebar Chat client & real-time trace logger
 │    ├── utils/
 │    │    └── api.ts           # Axios backend api queries
 │    └── App.tsx               # Main layout and tab controller
 ├── config.json                # Local Database (Git Ignored for keys protection)
 └── test-gateway.js            # Mock client verification test script
```

---

## 🚀 Quick Start

### 1. Installation
Clone the repository and install the dependencies:
```bash
git clone https://github.com/Majidi-star/FreeLLM-Gateway.git
cd Free-LLM-Provider
npm install
```

### 2. Launch the Gateway and Dashboard
Start both the backend server and frontend client concurrently:
```bash
npm run dev
```
The gateway will launch on **port 3000**, serving the management dashboard at [http://localhost:3000](http://localhost:3000).

### 3. Step-by-Step Configuration
1. **Find Free Keys:** Open the **Free API Directory** tab to find direct signup and documentation links for the 26 pre-seeded free and trial providers (NVIDIA NIM, Google AI Studio, Groq, OpenRouter, etc.).
2. **Setup Gateway:** In the **Gateway Setup** tab, configure a provider (e.g. `groq`), insert your API Key, and click **Sync Models** to dynamically download their active model lists.
3. **Add Custom Providers:** Click **+ Add Custom Provider** to connect private, local, or undocumented backends (e.g., local Ollama at `http://localhost:11434/v1`).
4. **Map Priority Pools:** Under **Active Pools**, select your synced models in the target dropdowns (e.g., mapping `deepseek-r1` on SambaNova as Priority #1, falling back to `deepseek/deepseek-r1:free` on OpenRouter as Priority #2 for the `strong-reasoning` pool). Changes save automatically!
5. **Test in Playground:** Go to the **Playground** tab, type a prompt, and run it to watch the response latency, token usage, and serving provider in the benchmarks table.

---

## 🔌 Integrating with Developer Tools

To route requests from external developer tools through the gateway:

### 1. Cursor / VS Code
* Open **Cursor Settings** -> **Models**.
* Toggle **Override OpenAI Base URL** and input: `http://localhost:3000/v1`
* Enter any mock string (e.g., `any-key` or your generated Virtual Key) in the OpenAI API Key field.
* Under model settings, add the virtual pool names (e.g. `coding-agent` or `strong-reasoning`).

### 2. Aider CLI
Set base URL environment variables and call your pool:
```bash
# macOS/Linux
export OPENAI_API_BASE="http://localhost:3000/v1"
export OPENAI_API_KEY="sk-gw-xxxx"  # Your gateway virtual key
aider --model coding-agent

# PowerShell (Windows)
$env:OPENAI_API_BASE="http://localhost:3000/v1"
$env:OPENAI_API_KEY="sk-gw-xxxx"
aider --model coding-agent
```

### 3. Python SDK
```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:3000/v1",
    api_key="sk-gw-xxxx" # Gateway key
)

response = client.chat.completions.create(
    model="strong-reasoning", # Invokes priority failover pool
    messages=[{"role": "user", "content": "Explain gravity in one sentence."}],
    temperature=0.7
)
print(response.choices[0].message.content)
```

---

## 🔌 Model Context Protocol (MCP) Server

Connect your desktop LLM clients (like Claude Desktop) directly to your gateway to give them configuration control.

### Setup Command:
```json
{
  "mcpServers": {
    "free-llm-gateway": {
      "command": "node",
      "args": ["C:/Projects/Free-LLM-Provider/server/mcp.js"]
    }
  }
}
```

### Exposed Tools:
* `get_gateway_status`: Retrieve total cost saved, total requests, tokens saved, and backend metrics.
* `list_providers`: List all providers with their active configurations.
* `list_routing_pools`: List virtual models and their prioritized target models.
* `sync_provider_models`: Sync provider configurations and pull models.
* `manage_provider_keys`: Add or remove API keys dynamically.
* `manage_model_aliases`: Add or remove model redirection rules.
* `configure_semantic_cache`: Enable/disable semantic caching and set threshold values.
* `manage_virtual_keys`: Generate, toggle, or revoke virtual keys.
* `manage_virtual_models`: Create, delete, or manage priority targets in virtual model pools.

---

## 📄 License

This project is licensed under the terms of the MIT LICENSE file included in the repository.
