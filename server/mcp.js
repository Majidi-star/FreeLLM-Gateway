// Disable console outputs immediately to protect stdio transport from JSON-RPC corruption
const originalConsoleLog = console.log;
console.log = function() {};
console.warn = function() {};
console.info = function() {};

import readline from 'readline';
import axios from 'axios';
import { loadConfig } from './db.js';

// Setup stdin reader line-by-line
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

rl.on('line', async (line) => {
  try {
    const request = JSON.parse(line);
    const { method, id, params } = request;

    if (method === 'initialize') {
      sendResponse(id, {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {}
        },
        serverInfo: {
          name: 'free-llm-pool-gateway-mcp',
          version: '1.0.0'
        }
      });
    } else if (method === 'notifications/initialized') {
      // NOOP
    } else if (method === 'tools/list') {
      sendResponse(id, {
        tools: [
          {
            name: 'get_gateway_status',
            description: 'Returns the gateway status, total cost saved, total requests, and pooled tokens count.',
            inputSchema: { type: 'object', properties: {} }
          },
          {
            name: 'list_providers',
            description: 'Lists all available API providers, their categories, website links, status, and synced models count.',
            inputSchema: { type: 'object', properties: {} }
          },
          {
            name: 'list_routing_pools',
            description: 'Lists all active virtual model routing pools (e.g. strong-reasoning) and their priority failover backends.',
            inputSchema: { type: 'object', properties: {} }
          },
          {
            name: 'sync_provider_models',
            description: 'Triggers dynamic model sync from a provider API, updating the database with its available models.',
            inputSchema: {
              type: 'object',
              properties: {
                providerId: { type: 'string', description: 'The unique ID of the provider (e.g. groq, gemini)' }
              },
              required: ['providerId']
            }
          },
          {
            name: 'ask_pool_completion',
            description: 'Sends a chat prompt to a gateway routing pool (e.g., strong-reasoning, coding-agent, fast-flash) and returns the text response.',
            inputSchema: {
              type: 'object',
              properties: {
                poolId: { type: 'string', description: 'The virtual pool ID (e.g. strong-reasoning, coding-agent, fast-flash)' },
                prompt: { type: 'string', description: 'The user message prompt to complete' },
                systemPrompt: { type: 'string', description: 'Optional system context instruction' },
                temperature: { type: 'number', description: 'Temperature value for generation (0.0 to 1.0)' }
              },
              required: ['poolId', 'prompt']
            }
          }
        ]
      });
    } else if (method === 'tools/call') {
      const { name, arguments: args } = params;
      const result = await handleToolCall(name, args);
      sendResponse(id, result);
    } else {
      if (id) {
        sendError(id, -32601, `Method not found: ${method}`);
      }
    }
  } catch (err) {
    sendError(null, -32700, `Parse error: ${err.message}`);
  }
});

async function handleToolCall(name, args) {
  try {
    const config = loadConfig();

    if (name === 'get_gateway_status') {
      const stats = config.stats;
      const responseText = `--- LLM FREE POOL GATEWAY STATUS ---
Total Requests: ${stats.totalRequests}
Successful Requests: ${stats.successfulRequests}
Failed Requests: ${stats.failedRequests}
Approximate Cost Saved: $${stats.approximateCostSaved.toFixed(2)}
Tokens Pooled: ${stats.tokensSaved.toLocaleString()}
Gateway Service: Online (Base: http://localhost:3000/v1)`;
      return { content: [{ type: 'text', text: responseText }] };
    }

    if (name === 'list_providers') {
      const providersText = config.providers.map(p => {
        return `- [${p.enabled ? 'ENABLED' : 'DISABLED'}] ${p.name} (${p.category}): ${p.models ? p.models.length : 0} models synced. limits: ${p.limitsDescription || 'N/A'}`;
      }).join('\n');
      return { content: [{ type: 'text', text: `Registered Providers:\n${providersText}` }] };
    }

    if (name === 'list_routing_pools') {
      const poolsText = config.virtualModels.map(vm => {
        const targets = vm.targets.map(t => `${t.providerId} -> ${t.modelId}`).join(', ');
        return `- ${vm.name} (${vm.id}): Priority queue: [ ${targets || 'Empty' } ]`;
      }).join('\n');
      return { content: [{ type: 'text', text: `Active Virtual Pools:\n${poolsText}` }] };
    }

    if (name === 'sync_provider_models') {
      const { providerId } = args;
      const provider = config.providers.find(p => p.id === providerId);
      if (!provider) {
        return { content: [{ type: 'text', text: `Error: Provider "${providerId}" not found.` }] };
      }

      const syncUrl = `http://localhost:3000/api/providers/${providerId}/sync-models`;
      const res = await axios.post(syncUrl, {
        apiKey: provider.apiKey,
        baseUrl: provider.baseUrl,
        proxyEnabled: provider.proxyEnabled,
        proxyUrl: provider.proxyUrl
      }, { timeout: 15000 });

      return { content: [{ type: 'text', text: `Success: Synced ${res.data.models.length} models for ${provider.name}!` }] };
    }

    if (name === 'ask_pool_completion') {
      const { poolId, prompt, systemPrompt, temperature } = args;

      const completionsUrl = `http://localhost:3000/v1/chat/completions`;
      const messages = [];
      if (systemPrompt) {
        messages.push({ role: 'system', content: systemPrompt });
      }
      messages.push({ role: 'user', content: prompt });

      const res = await axios.post(completionsUrl, {
        model: poolId,
        messages,
        temperature: temperature !== undefined ? temperature : 0.3,
        stream: false
      }, { timeout: 45000 });

      const text = res.data.choices[0].message.content;
      return { content: [{ type: 'text', text }] };
    }

    return { content: [{ type: 'text', text: `Tool not found: ${name}` }] };
  } catch (err) {
    const errorMsg = err.response?.data?.error?.message || err.response?.data?.message || err.message;
    return { content: [{ type: 'text', text: `Error executing tool: ${errorMsg}` }] };
  }
}

function sendResponse(id, result) {
  const payload = JSON.stringify({ jsonrpc: '2.0', id, result });
  originalConsoleLog(payload);
}

function sendError(id, code, message) {
  const payload = JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } });
  originalConsoleLog(payload);
}
