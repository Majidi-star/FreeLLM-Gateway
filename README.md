# Free LLM Pool Gateway & Dashboard

An OpenAI-compatible self-hosted gateway proxy server and glassmorphic management dashboard. It pools free API endpoints, syncs models dynamically, automatically handles rate limits, routes priorities, handles proxy tunnels, and logs API token usage and cost savings.

Designed for developers, agentic systems, and IDE tools (like Cursor, Aider, and Claude Code) to leverage permanently free LLM endpoints and trial credits without manual provider management.

---

## 🌟 Key Features

* **OpenAI-Compatible Endpoint (`http://localhost:3000/v1`):** Drop-in replacement for any SDK or application targeting the OpenAI API spec.
* **Dynamic Model Synchronization:** Pulls active model identifiers dynamically from the providers' APIs (such as Groq, Gemini AI Studio, OpenRouter, SambaNova, and Cohere), avoiding hardcoded model catalog errors.
* **Custom Provider CRUD Management:** Easily create, edit, delete, and test custom provider endpoints (such as local Ollama instances at `http://localhost:11434/v1` or private model servers).
* **Smart Priority Routing & Failovers:** Map virtual model pools (e.g. `strong-reasoning`, `coding-agent`, `fast-flash`) to priority lists of model backends. If a provider fails or hits a rate limit, the gateway automatically retries the next candidate in the queue.
* **Sliding-Window Rate Limiting:** Independently tracks requests and tokens per minute/hour/day (RPM, RPH, RPD, TPM, TPH, TPD) across all backends.
* **Tunnel Proxy Support:** Supports global and provider-specific SOCKS5/HTTP/HTTPS proxy agents to bypass geographic restrictions or handle latency rules.
* **Live Sandbox & Trace Terminal:** A built-in chat window and Server-Sent Events (SSE) log terminal to audit the gateway's failover actions in real time.

---

## 📂 Project Architecture

```
Free-LLM-Gateway/
 ├── server/                    # Node.js Backend Server
 │    ├── db.js                 # persistent configuration loader (config.json)
 │    ├── proxy.js              # HTTP/HTTPS & SOCKS5 proxy tunnel agents
 │    ├── rateLimiter.js        # sliding-window request & token trackers
 │    ├── router.js             # failover queue loops & payload translations
 │    └── index.js              # Express server and management API routes
 ├── src/                       # React Frontend Client (Vite + TS)
 │    ├── components/
 │    │    ├── Directory.tsx    # Table of seeded free API signup links & limits
 │    │    ├── GatewaySetup.tsx # Custom provider configuration & dynamic sync
 │    │    ├── ActivePools.tsx  # Virtual model priority list editor
 │    │    └── Sandbox.tsx      # Chat client & real-time trace logger
 │    ├── utils/
 │    │    └── api.ts           # Axios backend api queries
 │    ├── App.tsx               # Main layout and tab controller
 │    └── index.css             # Glassmorphic layout OKLCH design system
 ├── config.json                # Local Database (Git Ignored for keys protection)
 └── test-gateway.js            # Mock client verification test script
```

---

## 🚀 Quick Start

### 1. Installation
Clone the repository and install the dependencies:
```bash
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
4. **Map Priority Pools:** Under **Active Pools**, select your synced models in the target dropdowns (e.g., mapping `deepseek-r1` on SambaNova as Priority #1, falling back to `deepseek/deepseek-r1:free` on OpenRouter as Priority #2 for the `strong-reasoning` pool) and click **Save Pools**.
5. **Test:** Go to **Test Gateway**, type a prompt, and watch the gateway select and route the request in the log trace terminal!

---

## 🔌 Integrating with Developer Tools

To route requests from external developer tools through the gateway:

### 1. Cursor / VS Code
* Open **Cursor Settings** -> **Models**.
* Toggle **Override OpenAI Base URL** and input: `http://localhost:3000/v1`
* Enter any mock string (e.g., `any-key`) in the OpenAI API Key field.
* Under model settings, add the virtual pool names (e.g. `coding-agent` or `strong-reasoning`).

### 2. Aider CLI
Set base URL environment variables and call your pool:
```bash
# macOS/Linux
export OPENAI_API_BASE="http://localhost:3000/v1"
export OPENAI_API_KEY="any"
aider --model coding-agent

# PowerShell (Windows)
$env:OPENAI_API_BASE="http://localhost:3000/v1"
$env:OPENAI_API_KEY="any"
aider --model coding-agent
```

### 3. Python SDK
```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:3000/v1",
    api_key="mock-key"
)

response = client.chat.completions.create(
    model="strong-reasoning", # Invokes priority failover pool
    messages=[{"role": "user", "content": "Explain gravity in one sentence."}]
)
print(response.choices[0].message.content)
```

---

## 📄 License
This project is licensed under the terms of the LICENSE file included in the repository.
