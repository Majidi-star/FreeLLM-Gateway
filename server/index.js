import express from 'express';
import cors from 'cors';
import path from 'path';
import axios from 'axios';
import { fileURLToPath } from 'url';
import { loadConfig, saveConfig, getLogs, clearLogs, addLog } from './db.js';
import { getRateLimitMetrics } from './rateLimiter.js';
import { getProxyAgent } from './proxy.js';
import { routeChatCompletion } from './router.js';

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

// ----------------------------------------------------
// 1. OpenAI-Compatible API Routes
// ----------------------------------------------------

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

// POST /api/test-provider - Verify connection status for a provider
app.post('/api/test-provider', async (req, res) => {
  const { providerId, apiKey, baseUrl, proxyEnabled, proxyUrl, testModelId } = req.body;
  addLog('INFO', `Testing connection for provider: ${providerId} using model: ${testModelId}`);

  try {
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
      addLog('INFO', `Connection test passed for provider: ${providerId}`);
      res.json({ success: true, message: 'Connection test succeeded!' });
    } else {
      throw new Error(`Unexpected status code: ${response.status}`);
    }
  } catch (err) {
    const errorMsg = err.response?.data?.error?.message || err.response?.data?.message || err.message;
    addLog('ERROR', `Connection test failed for provider: ${providerId}`, errorMsg);
    res.status(500).json({ success: false, error: errorMsg });
  }
});

// POST /api/providers/:providerId/sync-models - Dynamically fetch models from provider API
app.post('/api/providers/:providerId/sync-models', async (req, res) => {
  const { providerId } = req.params;
  const { apiKey, baseUrl, proxyEnabled, proxyUrl } = req.body;
  addLog('INFO', `Syncing models for provider: ${providerId}`);

  try {
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

    const config = loadConfig();
    const provider = config.providers.find(p => p.id === providerId);
    if (provider) {
      provider.models = fetchedModels;
      saveConfig(config);
      addLog('INFO', `Successfully synced ${fetchedModels.length} models for provider: ${providerId}`);
      res.json({ success: true, models: fetchedModels });
    } else {
      res.status(404).json({ success: false, error: 'Provider not found in config.' });
    }
  } catch (err) {
    const errorMsg = err.response?.data?.error?.message || err.response?.data?.message || err.message;
    addLog('ERROR', `Failed to sync models for provider: ${providerId}`, errorMsg);
    res.status(500).json({ success: false, error: errorMsg });
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

// Initialize server
app.listen(PORT, () => {
  addLog('INFO', `LLM Free Pool Gateway listening on port ${PORT}`);
  addLog('INFO', `OpenAI API endpoint: http://localhost:${PORT}/v1`);
});
