# FreeLLM-Gateway (GoalRoute) ⚡

[![CI](https://github.com/Majidi-star/FreeLLM-Gateway/actions/workflows/ci.yml/badge.svg)](https://github.com/Majidi-star/FreeLLM-Gateway/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen.svg)](https://nodejs.org)

**FreeLLM-Gateway (GoalRoute)** is a multi-provider LLM gateway with goal-based self-healing routing, automatic quota tracking, AES-256-GCM credential vault encryption, circuit breakers, and protocol translation across OpenAI, Anthropic, Gemini, and MCP standards.

---

## Key Features 🚀

- **Multi-Protocol Gateways**: Run native endpoints for OpenAI (`/v1/chat/completions`), Anthropic (`/v1/messages`), and Model Context Protocol (MCP) on dedicated ports.
- **Goal-Based Routing & Policies**: Route requests across free and paid providers using set-cover, balanced, latency-optimized, or cost-minimized policies.
- **Self-Healing & Circuit Breakers**: Automatic exponential backoff, sliding window rate limits, and health monitoring for all provider connections.
- **Atomic Quota Accounting**: SQLite-backed atomic reservation and post-response delta usage reconciliation.
- **AES-256-GCM Encrypted Vault**: Zero plaintext key storage with runtime redaction in logs for API key formats (`sk-...`, `sk-ant-...`, `gsk_...`, `hf_...`, `AIza...`).
- **Interactive Cockpit & Appearance Studio**: Web-based administration dashboard and appearance customization studio.

---

## Multi-Port Protocol Endpoints 🔌

By default, FreeLLM-Gateway listens on 4 dedicated protocol ports:

| Endpoint Protocol | Default Port | Base Path |
| :--- | :--- | :--- |
| **Native Admin & API** | `8787` | `http://127.0.0.1:8787` |
| **OpenAI Protocol** | `8788` | `http://127.0.0.1:8788/v1/chat/completions` |
| **Anthropic Protocol** | `8789` | `http://127.0.0.1:8789/v1/messages` |
| **MCP Protocol** | `8790` | `http://127.0.0.1:8790/mcp` |

---

## Quick Start 🛠️

### 1. Requirements
- Node.js >= 22.0.0
- npm >= 10.0.0

### 2. Installation
```bash
git clone https://github.com/Majidi-star/FreeLLM-Gateway.git
cd FreeLLM-Gateway
npm install
```

### 3. Build & Run
```bash
# Build both backend TypeScript and frontend Web UI
npm run build
npm run build:web

# Start the gateway server directly
npm start
```

Alternatively, use the built-in CLI executable:
```bash
npx goalroute serve --port 8787
```

---

## Configuration (`.env`) ⚙️

Copy `.env.example` to `.env` and set your master key and admin secret token:

```env
NODE_ENV=production
PORT=8787
ENCRYPTION_MASTER_KEY=0000000000000000000000000000000000000000000000000000000000000000
ADMIN_API_TOKEN=your-secure-admin-token-here
LOG_LEVEL=info
```

> [!IMPORTANT]
> The server will refuse to boot in production if `ADMIN_API_TOKEN` or `ENCRYPTION_MASTER_KEY` remain default values.

---

## Testing & Quality 🧪

Run the Vitest test suite:
```bash
npm test
```

Run TypeScript typechecks:
```bash
npx tsc --noEmit
```

---

## Docker Deployment 🐳

Run FreeLLM-Gateway as a containerized service:

```bash
docker build -t goalroute .
docker run -d -p 8787:8787 -p 8788:8788 -p 8789:8789 -p 8790:8790 \
  -e ADMIN_API_TOKEN=your-secure-token \
  -e ENCRYPTION_MASTER_KEY=your-64-hex-master-key \
  goalroute
```

---

## License 📜

Distributed under the [Apache-2.0 License](LICENSE).
