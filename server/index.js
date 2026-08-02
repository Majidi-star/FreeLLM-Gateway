import express from 'express';
import cors from 'cors';
import path from 'path';
import axios from 'axios';
import { fileURLToPath } from 'url';
import { loadConfig, saveConfig, getLogs, clearLogs, addLog } from './db.js';
import { getRateLimitMetrics } from './rateLimiter.js';
import { getProxyAgent } from './proxy.js';
import { routeChatCompletion } from './router.js';
import { initCache, clearCache, getCacheSize } from './cache.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 3000;

const app = express();

app.use(cors());
app.use(express.json());

// List of connected SSE clients
let sseClients = [];

// Helper to broadcast routing events to GUI dashboard
function broadcastRoutingEvent(event) {
  sseClients.forEach((client) => {
    client.write(`data: ${JSON.stringify(event)}\n\n`);
  });
}

const validateVirtualKey = (req, res, next) => {
  const config = loadConfig();
  const keys = config.virtualKeys || [];
  
  if (keys.length === 0) {
    return next();
  }

  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();

  if (!token) {
    return res.status(401).json({ error: { message: 'Authentication required. Active virtual gateway keys are configured.' } });
  }

  const keyObj = keys.find(k => k.id === token);
  if (!keyObj) {
    return res.status(401).json({ error: { message: 'Invalid Virtual Gateway Key.' } });
  }

  if (!keyObj.enabled) {
    return res.status(403).json({ error: { message: 'This Virtual Gateway Key has been disabled.' } });
  }

  const now = Date.now();
  if (!keyObj.usage) {
    keyObj.usage = { requests: [] };
  }
  
  const oneDay = 24 * 60 * 60 * 1000;
  const oneMin = 60 * 1000;
  
  const history = keyObj.usage.requests || [];
  const validHistory = history.filter(t => now - t < oneDay);
  
  // Check RPM
  const rpmLimit = keyObj.limits?.rpm || 0;
  if (rpmLimit > 0) {
    const rpmCount = validHistory.filter(t => now - t < oneMin).length;
    if (rpmCount >= rpmLimit) {
      return res.status(429).json({ error: { message: `Virtual Key rate limit exceeded (RPM limit: ${rpmLimit}).` } });
    }
  }

  // Check RPD
  const rpdLimit = keyObj.limits?.rpd || 0;
  if (rpdLimit > 0) {
    const rpdCount = validHistory.length;
    if (rpdCount >= rpdLimit) {
      return res.status(429).json({ error: { message: `Virtual Key daily quota exceeded (RPD limit: ${rpdLimit}).` } });
    }
  }

  // Update history & save config
  validHistory.push(now);
  keyObj.usage.requests = validHistory;
  
  config.virtualKeys = config.virtualKeys.map(k => k.id === token ? keyObj : k);
  saveConfig(config);
  
  next();
};

app.use('/v1/*', validateVirtualKey);

// GET /v1/models - List all available models (virtual pools and individual provider models)
app.get('/v1/models', (req, res) => {
  const config = loadConfig();
  const modelList = [];

  // Add virtual pools
  config.virtualModels.forEach((vm) => {
    modelList.push({
      id: vm.id,
      object: 'model',
      created: 1686935002,
      owned_by: 'pool-gateway',
      type: 'virtual'
    });
  });

  // Add enabled provider models
  config.providers.forEach((p) => {
    if (p.enabled) {
      p.models.forEach((m) => {
        modelList.push({
          id: m.id,
          object: 'model',
          created: 1686935002,
          owned_by: p.id,
          type: 'direct'
        });
      });
    }
  });

  res.json({
    object: 'list',
    data: modelList
  });
});

// POST /v1/chat/completions - Route completions with fallback support
app.post('/v1/chat/completions', async (req, res) => {
  try {
    const payload = req.body;
    if (!payload.model || !payload.messages) {
      return res.status(400).json({
        error: { message: 'Missing model or messages parameters.' }
      });
    }

    await routeChatCompletion(payload, res, (event) => {
      broadcastRoutingEvent(event);
    });
  } catch (err) {
    addLog('ERROR', 'Uncaught completions handler error', err.message);
    res.status(500).json({
      error: { message: 'Internal server gateway error.', details: err.message }
    });
  }
});

// ----------------------------------------------------
// 2. GUI Administrative Routes
// ----------------------------------------------------

// SSE connection for real-time trace events in dashboard
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  sseClients.push(res);

  req.on('close', () => {
    sseClients = sseClients.filter(c => c !== res);
  });
});

// GET /api/config - Get current configurations
app.get('/api/config', (req, res) => {
  res.json(loadConfig());
});

// POST /api/config - Update configurations
app.post('/api/config', (req, res) => {
  try {
    const newConfig = req.body;
    const oldConfig = loadConfig();
    
    // Preserve stats during updates
    newConfig.stats = oldConfig.stats;

    if (saveConfig(newConfig)) {
      addLog('INFO', 'Gateway settings updated successfully.');
      res.json({ success: true });
    } else {
      res.status(500).json({ error: 'Failed to write config file.' });
    }
  } catch (err) {
    res.status(400).json({ error: 'Invalid config structure.', details: err.message });
  }
});

// GET /api/cache-stats - Get semantic cache size
app.get('/api/cache-stats', (req, res) => {
  res.json({ size: getCacheSize() });
});

// POST /api/cache-clear - Clear semantic cache database
app.post('/api/cache-clear', (req, res) => {
  clearCache();
  res.json({ success: true, size: 0 });
});

// GET /api/stats - Get metrics and current rate-limit usage
app.get('/api/stats', (req, res) => {
  const config = loadConfig();
  const rateLimitMetrics = getRateLimitMetrics(config.providers);
  res.json({
    stats: config.stats,
    limits: rateLimitMetrics
  });
});

// GET /api/logs - Get operational logs
app.get('/api/logs', (req, res) => {
  res.json(getLogs());
});

// POST /api/logs/clear - Clear logs
app.post('/api/logs/clear', (req, res) => {
  clearLogs();
  addLog('INFO', 'Gateway logs cleared.');
  res.json({ success: true });
});

// Helper to test provider connection
async function testConnectionHelper({ providerId, apiKey, baseUrl, proxyEnabled, proxyUrl, testModelId }) {
  addLog('INFO', `Testing connection helper for provider: ${providerId} using model: ${testModelId}`);
  const proxyAgent = proxyEnabled ? getProxyAgent(proxyUrl) : null;
  let url = `${baseUrl}/chat/completions`;
  let headers = {
    'Content-Type': 'application/json'
  };

  if (providerId === 'anthropic') {
    url = `${baseUrl}/messages`;
    headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = '2023-06-01';
  } else if (providerId === 'gemini') {
    url = `${baseUrl}/openai/chat/completions`;
    headers['Authorization'] = `Bearer ${apiKey}`;
  } else {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const payload = providerId === 'anthropic' 
    ? { model: testModelId, messages: [{ role: 'user', content: 'Ping' }], max_tokens: 5 }
    : { model: testModelId, messages: [{ role: 'user', content: 'Ping' }], max_tokens: 5, stream: false };

  const response = await axios({
    method: 'POST',
    url,
    data: payload,
    headers,
    timeout: 15000,
    ...proxyAgent
  });

  if (response.status === 200) {
    addLog('INFO', `Connection helper test passed for provider: ${providerId}`);
    return { success: true, message: 'Connection test succeeded!' };
  } else {
    throw new Error(`Unexpected status code: ${response.status}`);
  }
}

// Helper to dynamically sync models from provider API
async function syncModelsHelper({ providerId, apiKey, baseUrl, proxyEnabled, proxyUrl }) {
  addLog('INFO', `Syncing models helper for provider: ${providerId}`);
  const proxyAgent = proxyEnabled ? getProxyAgent(proxyUrl) : null;
  let fetchedModels = [];

  if (providerId === 'anthropic') {
    fetchedModels = [
      { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet' },
      { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku' },
      { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus' }
    ];
  } else if (providerId === 'cloudflare') {
    fetchedModels = [
      { id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', name: 'Llama 3.3 70B (FP8)' },
      { id: '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b', name: 'DeepSeek R1 Qwen 32B' },
      { id: '@cf/qwen/qwq-32b', name: 'Qwen QwQ 32B (Reasoning)' }
    ];
  } else {
    let url = `${baseUrl}/models`;
    if (providerId === 'opencode-zen') {
      url = 'https://opencode.ai/zen/v1/models';
    }
    let headers = {};
    
    if (providerId === 'gemini') {
      url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
    } else {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const response = await axios({
      method: 'GET',
      url,
      headers,
      timeout: 15000,
      ...proxyAgent
    });

    if (providerId === 'gemini') {
      const models = response.data.models || [];
      fetchedModels = models
        .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
        .map(m => {
          const cleanId = m.name.replace('models/', '');
          return { id: cleanId, name: m.displayName || cleanId };
        });
    } else if (providerId === 'cohere') {
      const models = response.data.models || [];
      fetchedModels = models.map(m => ({ id: m.name, name: m.name }));
    } else if (providerId === 'openrouter') {
      const models = response.data.data || [];
      fetchedModels = models
        .filter(m => {
          const completion = parseFloat(m.pricing?.completion || '0');
          const prompt = parseFloat(m.pricing?.prompt || '0');
          return completion === 0 && prompt === 0 && m.id.endsWith(':free');
        })
        .map(m => ({ id: m.id, name: m.name || m.id }));
    } else {
      const models = response.data.data || [];
      fetchedModels = models.map(m => ({ id: m.id, name: m.id }));
    }
  }

  if (fetchedModels.length === 0) {
    throw new Error('No models returned from provider API.');
  }

  // Save to config.json database
  const config = loadConfig();
  const provider = config.providers.find(p => p.id === providerId);
  if (provider) {
    provider.models = fetchedModels;
    saveConfig(config);
    addLog('INFO', `Successfully synced ${fetchedModels.length} models for provider: ${providerId}`);
    return fetchedModels;
  } else {
    throw new Error(`Provider "${providerId}" not found in config.`);
  }
}

// POST /api/test-provider - Verify connection status for a provider
app.post('/api/test-provider', async (req, res) => {
  try {
    const result = await testConnectionHelper(req.body);
    res.json(result);
  } catch (err) {
    const errorMsg = err.response?.data?.error?.message || err.response?.data?.message || err.message;
    res.status(500).json({ success: false, error: errorMsg });
  }
});

// POST /api/providers/:providerId/sync-models - Dynamically fetch models from provider API
app.post('/api/providers/:providerId/sync-models', async (req, res) => {
  try {
    const fetchedModels = await syncModelsHelper({ providerId: req.params.providerId, ...req.body });
    res.json({ success: true, models: fetchedModels });
  } catch (err) {
    const errorMsg = err.response?.data?.error?.message || err.response?.data?.message || err.message;
    res.status(500).json({ success: false, error: errorMsg });
  }
});

// ----------------------------------------------------
// Agentic Tools and completions handler
// ----------------------------------------------------

const ASSISTANT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_gateway_status',
      description: 'Get general statistics of the gateway (requests count, tokens pooled, and approximate cost saved in USD).',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_providers',
      description: 'Get a list of all configured API providers, their status, categories, and synced model count.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_routing_pools',
      description: 'Get all active virtual model pools and their priority failover backend lists.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'sync_provider_models',
      description: 'Sync the list of available models dynamically for a provider. Contact its API to pull models.',
      parameters: {
        type: 'object',
        properties: {
          providerId: { type: 'string', description: 'The unique ID of the provider (e.g. groq, gemini)' }
        },
        required: ['providerId']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'test_provider_connection',
      description: 'Verify API credentials and connectivity for a provider.',
      parameters: {
        type: 'object',
        properties: {
          providerId: { type: 'string', description: 'The unique ID of the provider' }
        },
        required: ['providerId']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'add_custom_provider',
      description: 'Dynamically add a new custom provider to the gateway. It will appear in both Setup and Directory tables.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Unique lowercase ID (e.g. local-ollama)' },
          name: { type: 'string', description: 'Display name (e.g. Local Ollama)' },
          baseUrl: { type: 'string', description: 'Endpoint address URL' },
          apiKey: { type: 'string', description: 'Optional API Key' },
          category: { type: 'string', description: 'Dropdown category (e.g. Custom Local, Permanent Free, Trial Credits)' },
          creditsDescription: { type: 'string', description: 'Description of free credits/plan' },
          limitsDescription: { type: 'string', description: 'Description of rate limits' }
        },
        required: ['id', 'name', 'baseUrl']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'delete_provider',
      description: 'Delete an existing provider from the configuration database.',
      parameters: {
        type: 'object',
        properties: {
          providerId: { type: 'string', description: 'The unique ID of the provider' }
        },
        required: ['providerId']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_app_documentation',
      description: 'Get comprehensive documentation about the LLM Free Pool Gateway, virtual routing pools, setup instructions, failovers, SOCKS5 proxies, and client integrations.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'manage_provider_keys',
      description: 'Add or remove individual API keys for a provider (used for load balancing).',
      parameters: {
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
    }
  },
  {
    type: 'function',
    function: {
      name: 'manage_model_aliases',
      description: 'Add or remove a model alias redirection mapping.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['add', 'remove'], description: 'Whether to add or remove an alias' },
          alias: { type: 'string', description: 'The model name requested by the client (e.g. gpt-4)' },
          targetPool: { type: 'string', description: 'The target virtual pool ID (required for add)' }
        },
        required: ['action', 'alias']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'configure_semantic_cache',
      description: 'Enable/disable semantic cache, change similarity threshold, or clear cache database.',
      parameters: {
        type: 'object',
        properties: {
          enabled: { type: 'boolean', description: 'Enable or disable semantic caching' },
          threshold: { type: 'number', description: 'Similarity threshold from 0.0 to 1.0 (e.g., 0.92)' },
          clearCache: { type: 'boolean', description: 'Set to true to clear all cache entries' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'manage_virtual_keys',
      description: 'Generate, toggle, or revoke a virtual gateway API key.',
      parameters: {
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
    }
  }
];

// Local tool executor
async function executeLocalTool(name, args) {
  const config = loadConfig();
  
  if (name === 'get_gateway_status') {
    const stats = config.stats;
    return `Gateway Status:\nTotal Requests: ${stats.totalRequests}\nSuccessful Requests: ${stats.successfulRequests}\nFailed Requests: ${stats.failedRequests}\nApproximate Cost Saved: $${stats.approximateCostSaved.toFixed(2)}\nTokens Saved: ${stats.tokensSaved}`;
  }
  
  if (name === 'list_providers') {
    return config.providers.map(p => `- [${p.enabled ? 'ENABLED' : 'DISABLED'}] ${p.name} (ID: ${p.id}, Category: ${p.category}): ${p.models?.length || 0} models synced. Base URL: ${p.baseUrl}`).join('\n');
  }
  
  if (name === 'list_routing_pools') {
    return config.virtualModels.map(vm => {
      const targets = vm.targets.map(t => `${t.providerId}/${t.modelId}`).join(', ');
      return `- ${vm.name} (${vm.id}): priority queue: [ ${targets || 'Empty' } ]`;
    }).join('\n');
  }
  
  if (name === 'sync_provider_models') {
    const { providerId } = args;
    const provider = config.providers.find(p => p.id === providerId);
    if (!provider) return `Error: Provider "${providerId}" not found.`;
    
    const models = await syncModelsHelper({
      providerId,
      apiKey: provider.apiKey || (provider.apiKeys?.[0]?.key || ''),
      baseUrl: provider.baseUrl,
      proxyEnabled: provider.proxyEnabled,
      proxyUrl: provider.proxyUrl
    });
    return `Success: Synced ${models.length} models for provider "${providerId}"!`;
  }

  if (name === 'test_provider_connection') {
    const { providerId } = args;
    const provider = config.providers.find(p => p.id === providerId);
    if (!provider) return `Error: Provider "${providerId}" not found.`;
    
    const result = await testConnectionHelper({
      providerId,
      apiKey: provider.apiKey || (provider.apiKeys?.[0]?.key || ''),
      baseUrl: provider.baseUrl,
      proxyEnabled: provider.proxyEnabled,
      proxyUrl: provider.proxyUrl,
      testModelId: provider.models[0]?.id || 'test'
    });
    return result.success ? `Success: ${result.message}` : `Failed: ${result.message}`;
  }

  if (name === 'add_custom_provider') {
    const { id, name: provName, baseUrl, apiKey, category, creditsDescription, limitsDescription } = args;
    const cleanId = id.toLowerCase().trim().replace(/\s+/g, '-');
    if (config.providers.some(p => p.id === cleanId)) {
      return `Error: A provider with ID "${cleanId}" already exists.`;
    }

    const created = {
      id: cleanId,
      name: provName,
      enabled: true,
      apiKey: apiKey || '',
      baseUrl: baseUrl.trim(),
      proxyEnabled: false,
      proxyUrl: '',
      category: category || 'Custom Local',
      website: '',
      signupUrl: '',
      creditsDescription: creditsDescription || 'Custom added provider details.',
      limitsDescription: limitsDescription || 'User defined custom rates.',
      models: []
    };

    config.providers.push(created);
    saveConfig(config);
    return `Success: Created custom provider "${provName}" (ID: ${cleanId}) successfully!`;
  }

  if (name === 'delete_provider') {
    const { providerId } = args;
    if (!config.providers.some(p => p.id === providerId)) {
      return `Error: Provider "${providerId}" not found.`;
    }
    config.providers = config.providers.filter(p => p.id !== providerId);
    saveConfig(config);
    return `Success: Deleted provider "${providerId}" from configuration database.`;
  }

  if (name === 'get_app_documentation') {
    return `--- LLM FREE POOL GATEWAY COMPREHENSIVE DOCUMENTATION ---
1. Overview:
   - This app acts as a local proxy server (running on port 3000) that allows pooling free/trial API keys from 26+ providers (e.g. Gemini, Groq, Nvidia NIM, SambaNova, Cloudflare Workers AI).
   - Point your local AI developer clients (Aider, Cursor, Python/Node apps) to base URL: http://localhost:3000/v1 using any mock API key.

2. Virtual Routing Pools (Virtual Models):
   - strong-reasoning: Routes reasoning prompts to DeepSeek-R1 (SambaNova/Groq) or Gemini 2.5 Pro.
   - coding-agent: Routes code generation requests to fast models like Groq Llama 3.3 70B, Qwen Coder, or Gemini Flash.
   - fast-flash: Routes general prompt requests to light, fast models (Gemini Flash-Lite, etc.).
   If a provider hits a rate limit (RPM/RPD) or fails, the gateway transparently falls back to the next candidate in the priority queue.

3. Model Context Protocol (MCP) Server:
   - Command: node C:/Projects/Free-LLM-Provider/server/mcp.js
   - Transport: Stdio JSON-RPC 2.0.
   - Exposes tools like get_gateway_status, list_providers, list_routing_pools, sync_provider_models, and ask_pool_completion.

4. Proxy Settings:
   - Users can configure SOCKS5/HTTP proxies globally or per-provider to bypass geographic restrictions on APIs.
   - The chat assistant has its own custom proxy settings override.`;
  }

  if (name === 'manage_provider_keys') {
    const { providerId, action, key, keyId, weight, enabled } = args;
    const provider = config.providers.find(p => p.id === providerId);
    if (!provider) return `Error: Provider "${providerId}" not found.`;
    
    if (action === 'add') {
      if (!key) return `Error: API key is required for action "add".`;
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
      return `Success: Added API Key "${newKey.id}" (weight: ${newKey.weight}) to ${provider.name}.`;
    }
    
    if (action === 'remove') {
      if (!keyId) return `Error: keyId is required for action "remove".`;
      if (!provider.apiKeys || !provider.apiKeys.some(k => k.id === keyId)) {
        return `Error: Key ID "${keyId}" not found in provider "${providerId}".`;
      }
      provider.apiKeys = provider.apiKeys.filter(k => k.id !== keyId);
      config.providers = config.providers.map(p => p.id === providerId ? provider : p);
      saveConfig(config);
      return `Success: Removed API Key "${keyId}" from ${provider.name}.`;
    }
    return `Error: Invalid action "${action}".`;
  }

  if (name === 'manage_model_aliases') {
    const { action, alias, targetPool } = args;
    if (!config.aliases) config.aliases = {};

    if (action === 'add') {
      if (!targetPool) return `Error: targetPool is required for action "add".`;
      config.aliases[alias] = targetPool;
      saveConfig(config);
      return `Success: Created alias redirection mapping "${alias}" -> "${targetPool}".`;
    }

    if (action === 'remove') {
      if (!config.aliases[alias]) return `Error: Alias "${alias}" not found.`;
      delete config.aliases[alias];
      saveConfig(config);
      return `Success: Revoked alias redirection mapping for "${alias}".`;
    }
    return `Error: Invalid action "${action}".`;
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

    return statusText ? `Success: ${statusText.trim()}` : `No configuration changes provided.`;
  }

  if (name === 'manage_virtual_keys') {
    const { action, name: keyName, rpm, rpd, keyId, enabled } = args;
    if (!config.virtualKeys) config.virtualKeys = [];

    if (action === 'generate') {
      if (!keyName) return `Error: Name description is required for action "generate".`;
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
      return `Success: Generated Gateway Key "${newKeyId}" for "${keyName.trim()}" (limits: ${newKey.limits.rpm} RPM, ${newKey.limits.rpd} RPD).`;
    }

    if (action === 'toggle') {
      if (!keyId) return `Error: keyId is required for action "toggle".`;
      if (enabled === undefined) return `Error: enabled state is required for action "toggle".`;
      const keyObj = config.virtualKeys.find(k => k.id === keyId);
      if (!keyObj) return `Error: Gateway Key "${keyId}" not found.`;
      
      keyObj.enabled = enabled;
      config.virtualKeys = config.virtualKeys.map(k => k.id === keyId ? keyObj : k);
      saveConfig(config);
      return `Success: Gateway Key "${keyId}" is now ${enabled ? 'ENABLED' : 'DISABLED'}.`;
    }

    if (action === 'revoke') {
      if (!keyId) return `Error: keyId is required for action "revoke".`;
      if (!config.virtualKeys.some(k => k.id === keyId)) return `Error: Gateway Key "${keyId}" not found.`;
      
      config.virtualKeys = config.virtualKeys.filter(k => k.id !== keyId);
      saveConfig(config);
      return `Success: Revoked Gateway Key "${keyId}" successfully.`;
    }
    return `Error: Invalid action "${action}".`;
  }

  return `Unknown tool name: ${name}`;
}

// POST /api/chat-assistant - Agentic chat interface with function-calling loop
app.post('/api/chat-assistant', async (req, res) => {
  const { messages, model, proxyEnabled, proxyUrl } = req.body;
  addLog('INFO', `Chat assistant processing message. Model: ${model}`);

  try {
    let currentMessages = [...messages];
    
    // Add system prompt setting the instructions
    const systemPromptIdx = currentMessages.findIndex(m => m.role === 'system');
    const systemContent = `You are the Free LLM Gateway Agentic Assistant. You help users manage their local gateway config, view stats, sync models, test connections, and add/remove providers.
You can execute actions on the dashboard dynamically using your tools. If the user asks you to perform an action (like syncing a provider, showing stats, adding or deleting a provider), use the corresponding tool immediately.
Always confirm the execution result of the tool to the user.`;
    
    if (systemPromptIdx >= 0) {
      currentMessages[systemPromptIdx].content = systemContent + '\n' + currentMessages[systemPromptIdx].content;
    } else {
      currentMessages.unshift({ role: 'system', content: systemContent });
    }

    let iterations = 0;
    const maxIterations = 5;
    let assistantMessage = null;
    let traceLogs = [];

    while (iterations < maxIterations) {
      iterations++;
      
      const mockRes = {
        statusCode: 200,
        headers: {},
        data: null,
        status(code) {
          this.statusCode = code;
          return this;
        },
        json(data) {
          this.data = data;
          return this;
        },
        setHeader(name, val) {
          this.headers[name] = val;
        },
        write() {},
        end() {}
      };

      const payload = {
        model,
        messages: currentMessages,
        tools: ASSISTANT_TOOLS,
        temperature: 0.3,
        stream: false
      };

      // Custom chat proxy settings applied to the request
      if (proxyEnabled && proxyUrl) {
        payload._chatProxy = { proxyEnabled, proxyUrl };
      }

      await routeChatCompletion(payload, mockRes);

      if (mockRes.statusCode !== 200) {
        throw new Error(mockRes.data?.error?.message || 'Completion failed in gateway.');
      }

      const choice = mockRes.data.choices[0];
      assistantMessage = choice.message;

      if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
        currentMessages.push(assistantMessage);

        for (const toolCall of assistantMessage.tool_calls) {
          const { name, arguments: argsString } = toolCall.function;
          addLog('INFO', `Agent calling local tool: ${name}`);
          
          let args = {};
          try {
            args = JSON.parse(argsString);
          } catch (e) {}

          traceLogs.push({ toolName: name, args });
          const toolOutput = await executeLocalTool(name, args);
          
          currentMessages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            name: name,
            content: toolOutput
          });
        }
        continue;
      }
      break;
    }

    res.json({ success: true, message: assistantMessage, traces: traceLogs });
  } catch (err) {
    addLog('ERROR', `Chat assistant execution failed`, err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Serve frontend static build files
const clientDistPath = path.join(__dirname, '..', 'dist');
app.use(express.static(clientDistPath));

// Fallback for single-page application routing
app.get('*', (req, res) => {
  if (!req.path.startsWith('/v1') && !req.path.startsWith('/api')) {
    res.sendFile(path.join(clientDistPath, 'index.html'));
  } else {
    res.status(404).json({ error: 'Endpoint not found.' });
  }
});

// Initialize cache and server
initCache();
app.listen(PORT, () => {
  addLog('INFO', `LLM Free Pool Gateway listening on port ${PORT}`);
  addLog('INFO', `OpenAI API endpoint: http://localhost:${PORT}/v1`);
});
