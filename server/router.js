import axios from 'axios';
import { loadConfig, saveConfig, addLog } from './db.js';
import { resolveProxyAgent } from './proxy.js';
import { checkRateLimit, recordUsage, setProviderCooldown } from './rateLimiter.js';

// Simple model cost database (approximate price per 1M tokens in USD)
const MODEL_PRICING = {
  'gpt-4o': { prompt: 2.50, completion: 10.00 },
  'gpt-4o-mini': { prompt: 0.15, completion: 0.60 },
  'claude-3-5-sonnet-20241022': { prompt: 3.00, completion: 15.00 },
  'claude-3-5-haiku-20241022': { prompt: 0.80, completion: 4.00 },
  'gemini-2.5-pro': { prompt: 1.25, completion: 5.00 }
};

/**
 * Estimate token counts based on string length (approx 4 chars per token).
 * @param {string} text 
 * @returns {number}
 */
function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Calculate cost of equivalent paid model call.
 * @param {string} virtualModelId 
 * @param {number} promptTokens 
 * @param {number} completionTokens 
 * @returns {number} - Saved cost in USD.
 */
function calculateCost(virtualModelId, promptTokens, completionTokens) {
  const price = MODEL_PRICING[virtualModelId];
  if (!price) {
    // Default fallback to standard GPT-4o pricing if no specific mapping
    return ((promptTokens * 2.50) + (completionTokens * 10.00)) / 1000000;
  }
  return ((promptTokens * price.prompt) + (completionTokens * price.completion)) / 1000000;
}

/**
 * Formats a request payload for Anthropic Messages API.
 * Extract system messages from OpenAI style messages array.
 */
function convertToAnthropic(payload) {
  const messages = [];
  let system = '';

  for (const msg of payload.messages) {
    if (msg.role === 'system') {
      system += (system ? '\n' : '') + msg.content;
    } else {
      messages.push({
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: msg.content
      });
    }
  }

  return {
    model: payload.model,
    messages,
    system: system || undefined,
    max_tokens: payload.max_tokens || 4096,
    temperature: payload.temperature,
    stream: payload.stream
  };
}

/**
 * Formats Anthropic response back to OpenAI format.
 */
function formatAnthropicResponse(anthropicData) {
  const content = anthropicData.content?.[0]?.text || '';
  return {
    id: anthropicData.id,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: anthropicData.model,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: content
        },
        finish_reason: anthropicData.stop_reason === 'end_turn' ? 'stop' : anthropicData.stop_reason
      }
    ],
    usage: {
      prompt_tokens: anthropicData.usage?.input_tokens || 0,
      completion_tokens: anthropicData.usage?.output_tokens || 0,
      total_tokens: (anthropicData.usage?.input_tokens || 0) + (anthropicData.usage?.output_tokens || 0)
    }
  };
}

/**
 * Handle routing for a request.
 * @param {object} reqPayload - OpenAI style request payload.
 * @param {object} res - Express response object.
 * @param {function} onRoutingEvent - Optional callback for real-time dashboard events.
 */
function resolveLoadBalancedKey(provider, modelObj) {
  const enabledKeys = provider.apiKeys ? provider.apiKeys.filter(k => k.enabled && k.key) : [];
  
  if (enabledKeys.length === 0) {
    // Fall back to legacy single key
    const legacyCheck = checkRateLimit(provider, modelObj);
    return {
      key: { id: 'default', key: provider.apiKey, weight: 1, enabled: true },
      virtualProvider: provider,
      limited: legacyCheck.limited,
      reason: legacyCheck.reason,
      retryAfterMs: legacyCheck.retryAfterMs
    };
  }

  const eligibleKeys = [];
  const limitedKeys = [];

  for (const key of enabledKeys) {
    const virtualProvider = {
      ...provider,
      id: `${provider.id}:${key.id}`,
      apiKey: key.key
    };
    
    const limitCheck = checkRateLimit(virtualProvider, modelObj);
    if (!limitCheck.limited) {
      eligibleKeys.push({ key, virtualProvider });
    } else {
      limitedKeys.push({ key, limitCheck });
    }
  }

  if (eligibleKeys.length > 0) {
    const totalWeight = eligibleKeys.reduce((sum, item) => sum + (item.key.weight || 1), 0);
    let rand = Math.random() * totalWeight;
    
    for (const item of eligibleKeys) {
      const weight = item.key.weight || 1;
      if (rand <= weight) {
        return {
          key: item.key,
          virtualProvider: item.virtualProvider,
          limited: false
        };
      }
      rand -= weight;
    }
    return {
      key: eligibleKeys[0].key,
      virtualProvider: eligibleKeys[0].virtualProvider,
      limited: false
    };
  } else {
    limitedKeys.sort((a, b) => a.limitCheck.retryAfterMs - b.limitCheck.retryAfterMs);
    const bestCandidate = limitedKeys[0];
    const virtualProvider = {
      ...provider,
      id: `${provider.id}:${bestCandidate.key.id}`,
      apiKey: bestCandidate.key.key
    };
    return {
      key: bestCandidate.key,
      virtualProvider,
      limited: true,
      reason: bestCandidate.limitCheck.reason,
      retryAfterMs: bestCandidate.limitCheck.retryAfterMs
    };
  }
}

/**
 * Handle routing for a request.
 * @param {object} reqPayload - OpenAI style request payload.
 * @param {object} res - Express response object.
 * @param {function} onRoutingEvent - Optional callback for real-time dashboard events.
 */
export async function routeChatCompletion(reqPayload, res, onRoutingEvent = null) {
  const config = loadConfig();
  
  const eventLog = (message, details = '') => {
    addLog('ROUTING', message, details);
    if (onRoutingEvent) {
      onRoutingEvent({ message, details });
    }
  };

  // 0. Intercept aliases
  if (config.aliases && config.aliases[reqPayload.model]) {
    const originalModel = reqPayload.model;
    reqPayload.model = config.aliases[originalModel];
    eventLog(`Aliased model request: "${originalModel}" -> "${reqPayload.model}"`);
  }

  const requestedModel = reqPayload.model;
  eventLog(`Routing request for model "${requestedModel}"`);

  // 1. Resolve targets
  let targets = [];
  const virtualModel = config.virtualModels.find(vm => vm.id === requestedModel);
  
  if (virtualModel) {
    targets = [...virtualModel.targets];
    eventLog(`Resolved virtual model "${requestedModel}" to ${targets.length} priority targets.`);
  } else {
    // If not a virtual model, look if any provider offers this exact model ID
    config.providers.forEach(p => {
      const match = p.models.find(m => m.id === requestedModel);
      if (match) {
        targets.push({ providerId: p.id, modelId: requestedModel });
      }
    });
    
    if (targets.length > 0) {
      eventLog(`Model "${requestedModel}" found directly in providers. Fallback available.`);
    } else {
      // Fallback: use the first enabled provider's first model
      const activeProvider = config.providers.find(p => p.enabled && p.apiKey);
      if (activeProvider && activeProvider.models.length > 0) {
        targets = [{ providerId: activeProvider.id, modelId: activeProvider.models[0].id }];
        eventLog(`Model "${requestedModel}" not found. Falling back to active provider: ${activeProvider.id}`);
      } else {
        return res.status(400).json({
          error: { message: `No active models or providers found matching "${requestedModel}".` }
        });
      }
    }
  }

  // 2. Select eligible target
  let chosenTarget = null;
  let rateLimitedTargets = [];

  for (const target of targets) {
    const provider = config.providers.find(p => p.id === target.providerId);
    if (!provider || !provider.enabled) {
      continue;
    }
    
    const hasKeys = provider.apiKeys && provider.apiKeys.some(k => k.enabled && k.key);
    if (!provider.apiKey && !hasKeys && provider.id !== 'cloudflare') {
      eventLog(`Skipping target provider "${provider.id}" (API Key missing).`);
      continue;
    }

    const modelObj = provider.models.find(m => m.id === target.modelId) || { id: target.modelId };
    
    // Resolve load-balanced key
    const keyResolution = resolveLoadBalancedKey(provider, modelObj);

    if (keyResolution.limited) {
      eventLog(`Target ${provider.id}/${target.modelId} rate-limited (all keys): ${keyResolution.reason}.`);
      rateLimitedTargets.push({ 
        target, 
        provider: keyResolution.virtualProvider || provider, 
        modelObj, 
        retryAfterMs: keyResolution.retryAfterMs 
      });
      continue;
    }

    chosenTarget = { 
      target, 
      provider: keyResolution.virtualProvider, 
      modelObj 
    };
    break;
  }

  // 3. Fallback queue wait logic if all are limited
  if (!chosenTarget && rateLimitedTargets.length > 0) {
    // Queue wait settings
    const queueEnabled = config.rateLimitQueueEnabled !== false;
    
    if (queueEnabled) {
      // Sort to find the one that recovers first
      rateLimitedTargets.sort((a, b) => a.retryAfterMs - b.retryAfterMs);
      const bestCandidate = rateLimitedTargets[0];
      const waitMs = bestCandidate.retryAfterMs;

      if (waitMs <= 30000) { // Limit wait time to max 30s
        eventLog(`All endpoints rate limited. Queueing request... Waiting ${Math.ceil(waitMs / 1000)}s for ${bestCandidate.provider.id}/${bestCandidate.target.modelId}`);
        await new Promise(r => setTimeout(r, waitMs));
        
        // Re-evaluate limits after wait
        const checkAgain = checkRateLimit(bestCandidate.provider, bestCandidate.modelObj);
        if (!checkAgain.limited) {
          chosenTarget = bestCandidate;
        }
      }
    }
  }

  if (!chosenTarget) {
    eventLog(`FAIL: All endpoints rate limited. Failing request.`);
    return res.status(429).json({
      error: {
        message: 'All eligible providers are currently rate-limited or in cooldown.',
        details: rateLimitedTargets.map(t => `${t.provider.id}: ${t.retryAfterMs}ms`).join(', ')
      }
    });
  }

  const { target, provider, modelObj } = chosenTarget;
  eventLog(`Selected backend target: ${provider.name} (model: ${target.modelId})`);
  
  const providerType = provider.id.split(':')[0];

  // 4. Dispatch the call
  const proxyAgent = reqPayload._chatProxy
    ? (reqPayload._chatProxy.proxyEnabled ? resolveProxyAgent({ proxyEnabled: true, proxyUrl: reqPayload._chatProxy.proxyUrl }, config) : null)
    : resolveProxyAgent(provider, config);
  const isStream = reqPayload.stream === true;
  
  // Construct provider request options
  let targetUrl = `${provider.baseUrl}/chat/completions`;
  let headers = {
    'Content-Type': 'application/json'
  };

  // Add API Key header based on provider format
  if (providerType === 'anthropic') {
    targetUrl = `${provider.baseUrl}/messages`;
    headers['x-api-key'] = provider.apiKey;
    headers['anthropic-version'] = '2023-06-01';
  } else if (providerType === 'cloudflare') {
    // Replace placeholder with actual account ID
    const accountIdMatch = provider.baseUrl.match(/accounts\/([^/]+)/);
    const accountId = accountIdMatch ? accountIdMatch[1] : '';
    headers['Authorization'] = `Bearer ${provider.apiKey}`;
  } else if (providerType === 'gemini') {
    // Gemini OpenAI compatibility endpoint:
    // Can pass api key via standard Authorization header or query parameter
    targetUrl = `${provider.baseUrl}/openai/chat/completions`;
    headers['Authorization'] = `Bearer ${provider.apiKey}`;
  } else {
    headers['Authorization'] = `Bearer ${provider.apiKey}`;
  }

  // Adjust model ID in paylod
  const apiPayload = { ...reqPayload, model: target.modelId };

  // Translate payload if Anthropic
  let payloadToSend = apiPayload;
  if (providerType === 'anthropic') {
    payloadToSend = convertToAnthropic(apiPayload);
  }

  const axiosConfig = {
    method: 'POST',
    url: targetUrl,
    data: payloadToSend,
    headers,
    timeout: 60000, // 60s timeout
    ...proxyAgent
  };

  try {
    if (isStream) {
      axiosConfig.responseType = 'stream';
      eventLog(`Initiating streaming response from ${provider.name}...`);
      const response = await axios(axiosConfig);

      // Set headers for SSE stream
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      let accumulatedText = '';
      
      response.data.on('data', (chunk) => {
        // Pass stream chunk directly to client
        res.write(chunk);

        // Parse chunks to estimate token count
        try {
          const chunkStr = chunk.toString();
          const lines = chunkStr.split('\n');
          for (const line of lines) {
            if (line.trim().startsWith('data:')) {
              const dataText = line.substring(5).trim();
              if (dataText === '[DONE]') continue;
              const parsed = JSON.parse(dataText);
              
              if (providerType === 'anthropic') {
                if (parsed.type === 'content_block_delta') {
                  accumulatedText += parsed.delta?.text || '';
                }
              } else {
                accumulatedText += parsed.choices?.[0]?.delta?.content || '';
              }
            }
          }
        } catch (e) {
          // Ignore parsing errors of partial chunks
        }
      });

      response.data.on('end', () => {
        const promptTokens = estimateTokens(JSON.stringify(reqPayload.messages));
        const completionTokens = estimateTokens(accumulatedText);
        const totalTokens = promptTokens + completionTokens;

        recordUsage(provider.id, target.modelId, totalTokens);
        
        // Track stats
        updateStats(true, requestedModel, promptTokens, completionTokens);
        
        eventLog(`Stream finished. Estimated tokens: ${totalTokens} (${promptTokens} prompt, ${completionTokens} completion)`);
        res.end();
      });

      response.data.on('error', (err) => {
        throw err;
      });

    } else {
      // Non streaming request
      eventLog(`Sending request to ${provider.name}...`);
      const response = await axios(axiosConfig);

      let openaiData = response.data;
      if (providerType === 'anthropic') {
        openaiData = formatAnthropicResponse(response.data);
      }

      // Record rate limits
      const promptTokens = openaiData.usage?.prompt_tokens || estimateTokens(JSON.stringify(reqPayload.messages));
      const completionTokens = openaiData.usage?.completion_tokens || estimateTokens(openaiData.choices?.[0]?.message?.content);
      const totalTokens = promptTokens + completionTokens;

      recordUsage(provider.id, target.modelId, totalTokens);
      updateStats(true, requestedModel, promptTokens, completionTokens);

      eventLog(`Request succeeded. Tokens: ${totalTokens}`);
      return res.status(200).json(openaiData);
    }
  } catch (err) {
    const errorMsg = err.response?.data?.error?.message || err.response?.data?.message || err.message;
    eventLog(`ERROR calling ${provider.name}:`, errorMsg);
    
    // Set provider on cooldown
    setProviderCooldown(provider.id, 60000); // 1 minute cooldown on failure
    updateStats(false);

    // Trigger failover retry!
    eventLog(`FAILOVER: Retrying next target candidate...`);
    
    // Remove the failed candidate and recurse
    const remainingTargets = reqPayload.messages; // mock reference, let's filter payload
    // To retry, we modify targets inside virtual model or we can just filter out the failed target
    // and run again. Since our targets array is resolved on-the-fly, we can track failed targets in a set!
    if (!reqPayload._failedBackends) {
      reqPayload._failedBackends = new Set();
    }
    reqPayload._failedBackends.add(`${provider.id}:${target.modelId}`);

    // Filter targets to remove failed ones
    const activeTargets = targets.filter(t => !reqPayload._failedBackends.has(`${t.providerId}:${t.modelId}`));
    if (activeTargets.length > 0) {
      // Create a temporary configuration list where we force virtual model targets
      // to exclude the failed ones.
      // Recurse route completions:
      return routeChatCompletion(reqPayload, res, onRoutingEvent);
    } else {
      eventLog(`FAILOVER: No targets remaining. Request failed.`);
      return res.status(err.response?.status || 500).json({
        error: {
          message: `All prioritized backends failed. Last error: ${errorMsg}`,
          provider: provider.name
        }
      });
    }
  }
}

/**
 * Updates stats in the configuration file.
 */
function updateStats(success, virtualModelId = null, promptTokens = 0, completionTokens = 0) {
  const config = loadConfig();
  config.stats.totalRequests += 1;
  if (success) {
    config.stats.successfulRequests += 1;
    if (virtualModelId && (virtualModelId === 'strong-reasoning' || virtualModelId === 'coding-agent' || virtualModelId === 'fast-flash' || virtualModelId === 'gpt-4o' || virtualModelId === 'claude-3-5-sonnet-20241022')) {
      // Calculate savings! We used a free model instead of a paid one
      const promptSaved = promptTokens;
      const completionSaved = completionTokens;
      const savings = calculateCost(virtualModelId, promptSaved, completionSaved);
      
      config.stats.tokensSaved += (promptSaved + completionSaved);
      config.stats.approximateCostSaved += savings;
    }
  } else {
    config.stats.failedRequests += 1;
  }
  saveConfig(config);
}
