// Disable console outputs immediately to protect stdio transport from JSON-RPC corruption
const originalConsoleLog = console.log;
console.log = function() {};
console.warn = function() {};
console.info = function() {};

import readline from 'readline';
import axios from 'axios';
import { loadConfig, saveConfig } from './db.js';
import { clearCache } from './cache.js';

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
          },
          {
            name: 'manage_provider_keys',
            description: 'Add or remove individual API keys for a provider (used for load balancing).',
            inputSchema: {
              type: 'object',
              properties: {
                providerId: { type: 'string', description: 'The unique ID of the provider (e.g., groq)' },
                action: { type: 'string', enum: ['add', 'remove'], description: 'Whether to add or remove a key' },
                key: { type: 'string', description: 'The raw API key string (required for add)' },
                keyId: { type: 'string', description: 'The unique ID of the key to remove (required for remove)' },
                weight: { type: 'number', description: 'The weight of the key for weighted load balancing' },
                enabled: { type: 'boolean', description: 'Whether the key is enabled' }
              },
              required: ['providerId', 'action']
            }
          },
          {
            name: 'manage_model_aliases',
            description: 'Add or remove a model alias redirection mapping.',
            inputSchema: {
              type: 'object',
              properties: {
                action: { type: 'string', enum: ['add', 'remove'], description: 'Whether to add or remove an alias' },
                alias: { type: 'string', description: 'The model name requested by the client (e.g. gpt-4)' },
                targetPool: { type: 'string', description: 'The target virtual pool ID (required for add)' }
              },
              required: ['action', 'alias']
            }
          },
          {
            name: 'configure_semantic_cache',
            description: 'Enable/disable semantic cache, change similarity threshold, or clear cache database.',
            inputSchema: {
              type: 'object',
              properties: {
                enabled: { type: 'boolean', description: 'Enable or disable semantic caching' },
                threshold: { type: 'number', description: 'Similarity threshold from 0.0 to 1.0 (e.g., 0.92)' },
                clearCache: { type: 'boolean', description: 'Set to true to clear all cache entries' }
              }
            }
          },
          {
            name: 'manage_virtual_keys',
            description: 'Generate, toggle, or revoke a virtual gateway API key.',
            inputSchema: {
              type: 'object',
              properties: {
                action: { type: 'string', enum: ['generate', 'toggle', 'revoke'], description: 'Action to take' },
                name: { type: 'string', description: 'Descriptive label/name for the key (required for generate)' },
                rpm: { type: 'number', description: 'Requests per minute limit (0 for unlimited, default 10)' },
                rpd: { type: 'number', description: 'Requests per day limit (0 for unlimited, default 500)' },
                keyId: { type: 'string', description: 'The gateway key string to toggle or revoke (required for toggle/revoke)' },
                enabled: { type: 'boolean', description: 'Whether the key is enabled (required for toggle)' }
              },
              required: ['action']
            }
          },
          {
            name: 'manage_virtual_models',
            description: 'Create, delete, or manage routing targets inside a virtual model pool.',
            inputSchema: {
              type: 'object',
              properties: {
                action: { type: 'string', enum: ['create', 'delete', 'add_target', 'remove_target'], description: 'Action to perform' },
                poolId: { type: 'string', description: 'The unique pool ID (e.g. coding-agent)' },
                poolName: { type: 'string', description: 'The display name of the pool (required for create)' },
                providerId: { type: 'string', description: 'The provider ID for the target model (required_for add_target)' },
                modelId: { type: 'string', description: 'The model ID for the target model (required for add_target/remove_target)' },
                targetIndex: { type: 'number', description: 'The index of the target to remove (required for remove_target)' }
              },
              required: ['action', 'poolId']
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

    if (name === 'manage_provider_keys') {
      const { providerId, action, key, keyId, weight, enabled } = args;
      const provider = config.providers.find(p => p.id === providerId);
      if (!provider) return { content: [{ type: 'text', text: `Error: Provider "${providerId}" not found.` }] };
      
      if (action === 'add') {
        if (!key) return { content: [{ type: 'text', text: `Error: API key is required for action "add".` }] };
        const newKey = {
          id: `key-${Date.now()}`,
          key: key.trim(),
          weight: weight !== undefined ? weight : 1,
          enabled: enabled !== undefined ? enabled : true
        };
        if (!provider.apiKeys) provider.apiKeys = [];
        provider.apiKeys.push(newKey);
        config.providers = config.providers.map(p => p.id === providerId ? provider : p);
        saveConfig(config);
        return { content: [{ type: 'text', text: `Success: Added API Key "${newKey.id}" (weight: ${newKey.weight}) to ${provider.name}.` }] };
      }
      
      if (action === 'remove') {
        if (!keyId) return { content: [{ type: 'text', text: `Error: keyId is required for action "remove".` }] };
        if (!provider.apiKeys || !provider.apiKeys.some(k => k.id === keyId)) {
          return { content: [{ type: 'text', text: `Error: Key ID "${keyId}" not found in provider "${providerId}".` }] };
        }
        provider.apiKeys = provider.apiKeys.filter(k => k.id !== keyId);
        config.providers = config.providers.map(p => p.id === providerId ? provider : p);
        saveConfig(config);
        return { content: [{ type: 'text', text: `Success: Removed API Key "${keyId}" from ${provider.name}.` }] };
      }
      return { content: [{ type: 'text', text: `Error: Invalid action "${action}".` }] };
    }

    if (name === 'manage_model_aliases') {
      const { action, alias, targetPool } = args;
      if (!config.aliases) config.aliases = {};

      if (action === 'add') {
        if (!targetPool) return { content: [{ type: 'text', text: `Error: targetPool is required for action "add".` }] };
        config.aliases[alias] = targetPool;
        saveConfig(config);
        return { content: [{ type: 'text', text: `Success: Created alias redirection mapping "${alias}" -> "${targetPool}".` }] };
      }

      if (action === 'remove') {
        if (!config.aliases[alias]) return { content: [{ type: 'text', text: `Error: Alias "${alias}" not found.` }] };
        delete config.aliases[alias];
        saveConfig(config);
        return { content: [{ type: 'text', text: `Success: Revoked alias redirection mapping for "${alias}".` }] };
      }
      return { content: [{ type: 'text', text: `Error: Invalid action "${action}".` }] };
    }

    if (name === 'configure_semantic_cache') {
      const { enabled, threshold, clearCache: clear } = args;
      let statusText = '';

      if (enabled !== undefined) {
        config.semanticCacheEnabled = enabled;
        statusText += `Semantic cache toggled to ${enabled ? 'ENABLED' : 'DISABLED'}. `;
      }
      if (threshold !== undefined) {
        config.semanticCacheThreshold = threshold;
        statusText += `Similarity threshold updated to ${threshold}. `;
      }
      if (enabled !== undefined || threshold !== undefined) {
        saveConfig(config);
      }
      if (clear === true) {
        clearCache();
        statusText += `Semantic Cache database cleared successfully.`;
      }

      return { content: [{ type: 'text', text: statusText ? `Success: ${statusText.trim()}` : `No configuration changes provided.` }] };
    }

    if (name === 'manage_virtual_keys') {
      const { action, name: keyName, rpm, rpd, keyId, enabled } = args;
      if (!config.virtualKeys) config.virtualKeys = [];

      if (action === 'generate') {
        if (!keyName) return { content: [{ type: 'text', text: `Error: Name description is required for action "generate".` }] };
        const randomHex = Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
        const newKeyId = `sk-gw-${randomHex}`;
        const newKey = {
          id: newKeyId,
          name: keyName.trim(),
          enabled: true,
          limits: { rpm: rpm !== undefined ? rpm : 10, rpd: rpd !== undefined ? rpd : 500 },
          usage: { requests: [] }
        };
        config.virtualKeys.push(newKey);
        saveConfig(config);
        return { content: [{ type: 'text', text: `Success: Generated Gateway Key "${newKeyId}" for "${keyName.trim()}" (limits: ${newKey.limits.rpm} RPM, ${newKey.limits.rpd} RPD).` }] };
      }

      if (action === 'toggle') {
        if (!keyId) return { content: [{ type: 'text', text: `Error: keyId is required for action "toggle".` }] };
        if (enabled === undefined) return { content: [{ type: 'text', text: `Error: enabled state is required for action "toggle".` }] };
        const keyObj = config.virtualKeys.find(k => k.id === keyId);
        if (!keyObj) return { content: [{ type: 'text', text: `Error: Gateway Key "${keyId}" not found.` }] };
        
        keyObj.enabled = enabled;
        config.virtualKeys = config.virtualKeys.map(k => k.id === keyId ? keyObj : k);
        saveConfig(config);
        return { content: [{ type: 'text', text: `Success: Gateway Key "${keyId}" is now ${enabled ? 'ENABLED' : 'DISABLED'}.` }] };
      }

      if (action === 'revoke') {
        if (!keyId) return { content: [{ type: 'text', text: `Error: keyId is required for action "revoke".` }] };
        if (!config.virtualKeys.some(k => k.id === keyId)) return { content: [{ type: 'text', text: `Error: Gateway Key "${keyId}" not found.` }] };
        
        config.virtualKeys = config.virtualKeys.filter(k => k.id !== keyId);
        saveConfig(config);
        return { content: [{ type: 'text', text: `Success: Revoked Gateway Key "${keyId}" successfully.` }] };
      }
      return { content: [{ type: 'text', text: `Error: Invalid action "${action}".` }] };
    }

    if (name === 'manage_virtual_models') {
      const { action, poolId, poolName, providerId, modelId, targetIndex } = args;
      if (!config.virtualModels) config.virtualModels = [];

      const cleanPoolId = poolId.toLowerCase().trim().replace(/\s+/g, '-');

      if (action === 'create') {
        if (!poolName) return { content: [{ type: 'text', text: `Error: poolName is required for action "create".` }] };
        if (config.virtualModels.some(vm => vm.id === cleanPoolId)) {
          return { content: [{ type: 'text', text: `Error: Virtual pool "${cleanPoolId}" already exists.` }] };
        }
        const newPool = {
          id: cleanPoolId,
          name: poolName.trim(),
          targets: []
        };
        config.virtualModels.push(newPool);
        saveConfig(config);
        return { content: [{ type: 'text', text: `Success: Created virtual model pool "${poolName.trim()}" (ID: ${cleanPoolId}).` }] };
      }

      if (action === 'delete') {
        if (!config.virtualModels.some(vm => vm.id === cleanPoolId)) {
          return { content: [{ type: 'text', text: `Error: Virtual pool "${cleanPoolId}" not found.` }] };
        }
        config.virtualModels = config.virtualModels.filter(vm => vm.id !== cleanPoolId);
        saveConfig(config);
        return { content: [{ type: 'text', text: `Success: Deleted virtual model pool "${cleanPoolId}".` }] };
      }

      const pool = config.virtualModels.find(vm => vm.id === cleanPoolId);
      if (!pool) return { content: [{ type: 'text', text: `Error: Virtual pool "${cleanPoolId}" not found.` }] };

      if (action === 'add_target') {
        if (!providerId || !modelId) return { content: [{ type: 'text', text: `Error: providerId and modelId are required for action "add_target".` }] };
        if (pool.targets.some(t => t.providerId === providerId && t.modelId === modelId)) {
          return { content: [{ type: 'text', text: `Error: Target "${providerId}/${modelId}" is already in pool "${cleanPoolId}".` }] };
        }
        pool.targets.push({ providerId, modelId });
        config.virtualModels = config.virtualModels.map(vm => vm.id === cleanPoolId ? pool : vm);
        saveConfig(config);
        return { content: [{ type: 'text', text: `Success: Added target "${providerId}/${modelId}" to virtual pool "${cleanPoolId}".` }] };
      }

      if (action === 'remove_target') {
        if (targetIndex === undefined && (!providerId || !modelId)) {
          return { content: [{ type: 'text', text: `Error: targetIndex or providerId+modelId is required for action "remove_target".` }] };
        }
        let originalLength = pool.targets.length;
        if (targetIndex !== undefined) {
          pool.targets = pool.targets.filter((_, idx) => idx !== targetIndex);
        } else {
          pool.targets = pool.targets.filter(t => !(t.providerId === providerId && t.modelId === modelId));
        }
        if (pool.targets.length === originalLength) {
          return { content: [{ type: 'text', text: `Error: Target was not found in virtual pool "${cleanPoolId}".` }] };
        }
        config.virtualModels = config.virtualModels.map(vm => vm.id === cleanPoolId ? pool : vm);
        saveConfig(config);
        return { content: [{ type: 'text', text: `Success: Removed target from virtual pool "${cleanPoolId}".` }] };
      }

      return { content: [{ type: 'text', text: `Error: Invalid action "${action}".` }] };
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
