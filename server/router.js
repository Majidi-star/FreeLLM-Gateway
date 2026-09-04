import axios from 'axios';
import { loadConfig, saveConfig, addLog, recordLatency, getLatency, getStats, scheduleStatsFlush, addStatsHistoryEntry } from './db.js';
import { resolveProxyAgent } from './proxy.js';
import { checkRateLimit, recordRequestStart, recordRequestEnd, setProviderCooldown, getProviderCooldownTime, setModelCooldown, getModelCooldownTime, checkPoolRateLimit, recordPoolUsage, tryReserve, tryReservePool, releasePoolReservation } from './rateLimiter.js';
import { getSemanticCachedResponse, addSemanticCache } from './cache.js';

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

function redactHeaders(headers = {}) {
  return Object.fromEntries(Object.entries(headers).map(([name, value]) => {
    const lowerName = name.toLowerCase();
    const sensitive = lowerName === 'authorization' || lowerName === 'x-api-key' ||
      lowerName === 'api-key' || lowerName === 'proxy-authorization';
    return [name, sensitive ? '[REDACTED]' : value];
  }));
}

function toSerializable(value, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  if (Array.isArray(value)) return value.map(item => toSerializable(item, seen));
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    toSerializable(item, seen)
  ]));
}

function buildRequestDiagnostics({ reqPayload, targetUrl, headers, payloadToSend, timeoutMs, err = null, response = null }) {
  return {
    request: {
      method: 'POST',
      url: targetUrl,
      headers: redactHeaders(headers),
      body: toSerializable(payloadToSend),
      timeoutMs
    },
    response: response ? {
      status: response.status,
      statusText: response.statusText,
      headers: redactHeaders(response.headers),
      body: toSerializable(response.data)
    } : null,
    error: err ? {
      name: err.name,
      message: err.message,
      code: err.code,
      stack: err.stack
    } : null,
    gateway: {
      requestedModel: reqPayload.model,
      stream: reqPayload.stream === true
    }
  };
}

export function sanitizeProviderPayload(payload, providerId, modelId) {
  const standardKeys = new Set([
    'model', 'messages', 'temperature', 'top_p', 'stream', 'max_tokens',
    'tools', 'tool_choice', 'response_format', 'frequency_penalty',
    'presence_penalty', 'stop', 'n', 'seed', 'user', 'logprobs',
    'top_logprobs'
  ]);
  const sanitized = Object.fromEntries(
    Object.entries(payload).filter(([key]) => standardKeys.has(key))
  );
  const providerType = providerId.split(':')[0].toLowerCase();
  const supportsOSeries = providerType === 'openai' && /^o[134](?:-|$)/i.test(modelId);

  if (supportsOSeries && payload.max_completion_tokens !== undefined) {
    sanitized.max_completion_tokens = payload.max_completion_tokens;
  }
  if (supportsOSeries && payload.reasoning_effort !== undefined) {
    sanitized.reasoning_effort = payload.reasoning_effort;
  }

  return sanitized;
}

export function providerSupportsModel(provider, modelId) {
  const providerType = provider.id.split(':')[0].toLowerCase();
  if (providerType === 'reka' && /^(?:glm|deepseek)/i.test(modelId)) {
    return false;
  }
  return true;
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
 * Atomically selects and reserves an API key for a provider+model.
 * Uses tryReserve() to eliminate TOCTOU between rate-limit check and slot claim.
 * @param {object} provider  - Provider config object.
 * @param {object} modelObj  - Model config object.
 * @param {number} estimatedTokens - Estimated prompt tokens for live tracking.
 * @returns {{ key, virtualProvider, entry, limited, reason, retryAfterMs }}
 */
function resolveLoadBalancedKey(provider, modelObj, estimatedTokens = 0) {
  const enabledKeys = provider.apiKeys ? provider.apiKeys.filter(k => k.enabled && k.key) : [];
  
  if (enabledKeys.length === 0) {
    // Fall back to legacy single key — try to atomically reserve
    const reservation = tryReserve(provider, modelObj, estimatedTokens);
    return {
      key: { id: 'default', key: provider.apiKey, weight: 1, enabled: true },
      virtualProvider: provider,
      entry: reservation.entry || null,
      limited: !reservation.reserved,
      reason: reservation.reason || '',
      retryAfterMs: reservation.retryAfterMs || 0,
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
    
    // checkRateLimit is a pure read — safe to loop without side effects.
    const limitCheck = checkRateLimit(virtualProvider, modelObj);
    if (!limitCheck.limited) {
      eligibleKeys.push({ key, virtualProvider, limitCheck });
    } else {
      limitedKeys.push({ key, virtualProvider, limitCheck });
    }
  }

  if (eligibleKeys.length > 0) {
    const totalWeight = eligibleKeys.reduce((sum, item) => sum + (item.key.weight || 1), 0);
    let rand = Math.random() * totalWeight;
    
    // Pick winner then atomically reserve — loop through candidates in case
    // the winner was just taken by a concurrent request between our check and tryReserve.
    const orderedCandidates = [];
    for (const item of eligibleKeys) {
      const weight = item.key.weight || 1;
      if (rand <= weight) {
        orderedCandidates.unshift(item); // preferred first
        break;
      }
      rand -= weight;
      orderedCandidates.push(item);
    }
    // Ensure remaining eligible keys are tried if the preferred one got grabbed
    for (const item of eligibleKeys) {
      if (!orderedCandidates.includes(item)) orderedCandidates.push(item);
    }

    for (const item of orderedCandidates) {
      const reservation = tryReserve(item.virtualProvider, modelObj, estimatedTokens);
      if (reservation.reserved) {
        return {
          key: item.key,
          virtualProvider: item.virtualProvider,
          entry: reservation.entry,
          limited: false,
        };
      }
    }
    // All candidates got grabbed between check and reserve — treat as limited
  }

  // All keys are limited
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
    entry: null,
    limited: true,
    reason: bestCandidate.limitCheck.reason,
    retryAfterMs: bestCandidate.limitCheck.retryAfterMs,
  };
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

  // 0.1 Check Semantic Cache
  if (config.semanticCacheEnabled) {
    const cacheHit = getSemanticCachedResponse(reqPayload.messages, config.semanticCacheThreshold);
    if (cacheHit) {
      res.setHeader('x-gateway-cache', 'hit');
      res.setHeader('x-gateway-provider', 'Semantic Cache');
      
      const isStream = reqPayload.stream === true;
      const cachedCompletion = cacheHit.completion;
      const cachedText = cachedCompletion.choices?.[0]?.message?.content || '';
      
      if (isStream) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        
        eventLog(`Semantic Cache HIT - simulating stream response...`);
        
        const words = cachedText.split(' ');
        let i = 0;
        
        const sendChunk = () => {
          if (i >= words.length) {
            res.write(`data: [DONE]\n\n`);
            res.end();
            return;
          }
          
          const chunkWord = words[i] + (i === words.length - 1 ? '' : ' ');
          const chunkPayload = {
            id: `chatcmpl-${Date.now()}`,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: requestedModel,
            choices: [{
              index: 0,
              delta: { content: chunkWord },
              finish_reason: i === words.length - 1 ? 'stop' : null
            }]
          };
          
          res.write(`data: ${JSON.stringify(chunkPayload)}\n\n`);
          i++;
          setTimeout(sendChunk, Math.min(25, 200 / words.length));
        };
        
        sendChunk();
        
        // Stats
        const promptTokens = estimateTokens(JSON.stringify(reqPayload.messages));
        const completionTokens = estimateTokens(cachedText);
        updateStats(true, requestedModel, promptTokens, completionTokens, {
          providerId: 'cache',
          modelId: requestedModel,
          latencyMs: 10,
          cacheHit: true
        });
        return;
      } else {
        eventLog(`Semantic Cache HIT - returning cached payload.`);
        
        // Stats
        const promptTokens = estimateTokens(JSON.stringify(reqPayload.messages));
        const completionTokens = estimateTokens(cachedText);
        updateStats(true, requestedModel, promptTokens, completionTokens, {
          providerId: 'cache',
          modelId: requestedModel,
          latencyMs: 5,
          cacheHit: true
        });
        
        return res.status(200).json(cachedCompletion);
      }
    }
  }

  // 1. Resolve targets
  let targets = [];
  let virtualModel = null;
  
  // Direct providerId/modelId routing check
  let targetedProviderId = null;
  let targetedModelId = requestedModel;
  
  for (const p of config.providers) {
    if (requestedModel.startsWith(p.id + '/')) {
      targetedProviderId = p.id;
      targetedModelId = requestedModel.substring(p.id.length + 1);
      break;
    }
  }

  if (targetedProviderId) {
    targets = [{ providerId: targetedProviderId, modelId: targetedModelId }];
    eventLog(`Direct provider-specific routing: targeting provider "${targetedProviderId}" and model "${targetedModelId}".`);
  } else {
    const cleanRequestedModel = requestedModel.toLowerCase().trim().replace(/\s+/g, '-').replace(/-pool$/, '');
    virtualModel = config.virtualModels.find(vm => vm.id === requestedModel || vm.id === cleanRequestedModel);
    
    if (virtualModel) {
      if (virtualModel.limits) {
        const poolReservation = tryReservePool(virtualModel.id, virtualModel.limits);
        if (!poolReservation.reserved) {
          eventLog(`Virtual pool "${virtualModel.id}" rate limited globally: ${poolReservation.reason}`);
          return res.status(429).json({ error: { message: `Rate limit exceeded for pool "${virtualModel.id}": ${poolReservation.reason}`, type: 'pool_rate_limit_exceeded', retry_after: Math.ceil(poolReservation.retryAfterMs / 1000) } });
        }
        // Store for release on completion/failure
        reqPayload._poolReservation = poolReservation.entry;
        reqPayload._poolId = virtualModel.id;
      }
      targets = [...virtualModel.targets].filter(t => {
        if (t.enabled === false) return false;
        const provider = config.providers.find(p => p.id === t.providerId);
        const compatible = provider && providerSupportsModel(provider, t.modelId) &&
          provider.models.some(model => model.id === t.modelId);
        if (!compatible) {
          eventLog(`Ignoring invalid pool target ${t.providerId}/${t.modelId}; provider/model mapping is incompatible or unavailable.`);
        }
        return compatible;
      });
      if (targets.length === 0) {
        return res.status(503).json({ error: { message: `Virtual pool "${requestedModel}" has no active/enabled models available.`, type: 'pool_empty' } });
      }
      eventLog(`Resolved virtual model "${requestedModel}" to ${targets.length} priority targets.`);
    } else {
      // If not a virtual model, look if any provider offers this exact model ID
      config.providers.forEach(p => {
        const match = p.models.find(m => m.id === requestedModel);
        if (match && providerSupportsModel(p, requestedModel)) {
          targets.push({ providerId: p.id, modelId: requestedModel });
        }
      });
      
      if (targets.length > 0) {
        eventLog(`Model "${requestedModel}" found directly in providers. Fallback available.`);
      } else {
        if (/^(?:glm|deepseek)/i.test(requestedModel)) {
          return res.status(400).json({
            error: { message: `No compatible provider is configured for model "${requestedModel}".` }
          });
        }
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
  }

  // 2. Select eligible target
  let chosenTarget = null;
  let rateLimitedTargets = [];

  // Implement Load-Balancing / Random target selection if specified in pool
  let evaluatedTargets = [...targets];
  if (virtualModel) {
    if (virtualModel.strategy === 'random') {
      // Shuffle targets consistently across failovers using a seeded/saved order
      if (!reqPayload._randomOrder) {
        evaluatedTargets.sort(() => Math.random() - 0.5);
        reqPayload._randomOrder = evaluatedTargets.map(t => `${t.providerId}:${t.modelId}`);
      } else {
        evaluatedTargets.sort((a, b) => 
          reqPayload._randomOrder.indexOf(`${a.providerId}:${a.modelId}`) - 
          reqPayload._randomOrder.indexOf(`${b.providerId}:${b.modelId}`)
        );
      }
    }
    // Latency strategy: sort targets by in-memory EMA latency (no disk I/O).
    if (virtualModel.strategy === 'latency') {
      evaluatedTargets.sort((a, b) =>
        getLatency(a.providerId, a.modelId) - getLatency(b.providerId, b.modelId)
      );
    }
  }

  for (const target of evaluatedTargets) {
    if (reqPayload._failedBackends && reqPayload._failedBackends.has(`${target.providerId}:${target.modelId}`)) {
      eventLog(`Skipping already failed backend: ${target.providerId}/${target.modelId}`);
      continue;
    }

    const provider = config.providers.find(p => p.id === target.providerId);
    if (!provider || !provider.enabled) {
      continue;
    }
    if (!providerSupportsModel(provider, target.modelId)) {
      eventLog(`Skipping incompatible target ${provider.id}/${target.modelId}; provider/model mapping is invalid.`);
      continue;
    }
    
    const hasKeys = provider.apiKeys && provider.apiKeys.some(k => k.enabled && k.key);
    if (!provider.apiKey && !hasKeys && provider.id !== 'cloudflare') {
      eventLog(`Skipping target provider "${provider.id}" (API Key missing).`);
      continue;
    }

    const baseModelObj = provider.models.find(m => m.id === target.modelId);
    if (!baseModelObj) {
      eventLog(`Skipping unavailable target ${provider.id}/${target.modelId}; model is not registered by the provider.`);
      continue;
    }
    const modelObj = target.limits ? { ...baseModelObj, limits: { ...(baseModelObj.limits || {}), ...target.limits } } : baseModelObj;
    
    // Resolve load-balanced key — atomically checks limits and reserves the slot
    const promptTokensEst = estimateTokens(JSON.stringify(reqPayload.messages || []));
    const keyResolution = resolveLoadBalancedKey(provider, modelObj, promptTokensEst);

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
      modelObj,
      reqReservation: keyResolution.entry,  // slot already claimed atomically
    };
    break;

  }

  // 3. Fallback queue wait logic if all are limited
  if (!chosenTarget && rateLimitedTargets.length > 0) {
    const queueEnabled = config.rateLimitQueueEnabled !== false;
    const maxWaitMs = config.rateLimitQueueTimeoutMs || 180000; // 3 minutes default queue timeout
    
    if (queueEnabled) {
      const startTime = Date.now();
      eventLog(`All endpoints rate limited / in cooldown. Queueing request (max queue timeout: ${Math.ceil(maxWaitMs / 1000)}s)...`);
      
      while (Date.now() - startTime < maxWaitMs) {
        rateLimitedTargets.sort((a, b) => a.retryAfterMs - b.retryAfterMs);
        const shortestRetry = rateLimitedTargets[0]?.retryAfterMs || 2500;
        const sleepMs = Math.max(500, Math.min(shortestRetry, 2500));
        
        await new Promise(r => setTimeout(r, sleepMs));
        
        // Re-evaluate all targets in pool, dynamically loading latest config
        const currentConfig = loadConfig();
        const cleanRequestedModel = requestedModel.toLowerCase().trim().replace(/\s+/g, '-').replace(/-pool$/, '');
        let currentVirtualModel = currentConfig.virtualModels.find(vm => vm.id === requestedModel || vm.id === cleanRequestedModel);
        
        let currentEvaluatedTargets = evaluatedTargets;
        if (currentVirtualModel) {
          currentEvaluatedTargets = [...currentVirtualModel.targets].filter(t => t.enabled !== false);
          if (currentVirtualModel.strategy === 'random') {
            if (reqPayload._randomOrder) {
              currentEvaluatedTargets.sort((a, b) => 
                reqPayload._randomOrder.indexOf(`${a.providerId}:${a.modelId}`) - 
                reqPayload._randomOrder.indexOf(`${b.providerId}:${b.modelId}`)
              );
            } else {
              currentEvaluatedTargets.sort(() => Math.random() - 0.5);
            }
          }
        } else if (targetedProviderId) {
           currentEvaluatedTargets = [{ providerId: targetedProviderId, modelId: targetedModelId }];
        }
        
        for (const target of currentEvaluatedTargets) {
          if (reqPayload._failedBackends && reqPayload._failedBackends.has(`${target.providerId}:${target.modelId}`)) {
            continue;
          }
          const provider = currentConfig.providers.find(p => p.id === target.providerId);
          if (!provider || !provider.enabled) continue;
          if (!providerSupportsModel(provider, target.modelId)) {
            eventLog(`Skipping incompatible target ${provider.id}/${target.modelId} during queue recheck.`);
            continue;
          }
          
          const baseModelObj = provider.models.find(m => m.id === target.modelId);
          if (!baseModelObj) {
            eventLog(`Skipping unavailable target ${provider.id}/${target.modelId} during queue recheck.`);
            continue;
          }
          const modelObj = target.limits ? { ...baseModelObj, limits: { ...(baseModelObj.limits || {}), ...target.limits } } : baseModelObj;
          const promptTokensEst = estimateTokens(JSON.stringify(reqPayload.messages || []));
          const keyResolution = resolveLoadBalancedKey(provider, modelObj, promptTokensEst);
          
          if (!keyResolution.limited) {
            chosenTarget = {
              target,
              provider: keyResolution.virtualProvider,
              modelObj,
              reqReservation: keyResolution.entry,  // slot already claimed atomically
            };
            eventLog(`Queue wait successful: endpoint ${provider.id}/${target.modelId} is now available after ${Math.ceil((Date.now() - startTime) / 1000)}s.`);
            break;
          }
        }

        
        if (chosenTarget) break;
      }
    }
  }

  if (!chosenTarget) {
    // Attempt emergency system-wide fallback if all pool models are limited
    if (!reqPayload._systemFallbackTried) {
      reqPayload._systemFallbackTried = true;
      const anyActiveProvider = config.providers.find(p => 
        p.enabled && 
        (p.apiKey || p.apiKeys?.some(k => k.enabled && k.key)) && 
        p.models?.length > 0
      );
      if (anyActiveProvider) {
        const fallbackModel = anyActiveProvider.models.find(model => providerSupportsModel(anyActiveProvider, model.id));
        if (!fallbackModel) {
          return res.status(503).json({
            error: { message: 'No compatible emergency fallback model is available.' }
          });
        }
        const promptTokensEst = estimateTokens(JSON.stringify(reqPayload.messages || []));
        const fbResolution = resolveLoadBalancedKey(anyActiveProvider, fallbackModel, promptTokensEst);
        if (!fbResolution.limited) {
          chosenTarget = {
            target: { providerId: anyActiveProvider.id, modelId: fallbackModel.id },
            provider: fbResolution.virtualProvider,
            modelObj: fallbackModel,
            reqReservation: fbResolution.entry,  // slot already claimed atomically
          };
          eventLog(`EMERGENCY FALLBACK: Virtual pool limited. Using active provider ${anyActiveProvider.name} (${fallbackModel.id}) as fallback.`);
        }
      }
    }
  }

  if (!chosenTarget) {
    eventLog(`FAIL: All endpoints rate limited and queue timeout reached. Failing request.`);
    updateStats(false, requestedModel, 0, 0, {
      providerId: 'gateway',
      modelId: 'unknown',
      latencyMs: 0,
      error: 'All eligible providers are currently rate-limited or in cooldown.',
      diagnostics: {
        gateway: {
          requestedModel,
          requestBody: reqPayload,
          rateLimitedTargets: rateLimitedTargets.map(t => ({
            providerId: t.provider.id,
            modelId: t.target.modelId,
            retryAfterMs: t.retryAfterMs
          }))
        }
      }
    });
    return res.status(429).json({
      error: {
        message: 'All eligible providers are currently rate-limited or in cooldown.',
        details: rateLimitedTargets.map(t => `${t.provider.id}: ${t.retryAfterMs}ms`).join(', ')
      }
    });
  }

  const { target, provider, modelObj, reqReservation } = chosenTarget;
  eventLog(`Selected backend target: ${provider.name} (model: ${target.modelId})`);
  
  // NOTE: The slot was already atomically claimed inside resolveLoadBalancedKey via tryReserve.
  // reqReservation is the history entry reference to pass to recordRequestEnd on completion.
  const promptTokens = estimateTokens(JSON.stringify(reqPayload.messages || []));

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
    let base = provider.baseUrl;
    if (base.endsWith('/')) base = base.slice(0, -1);
    if (base.endsWith('/models')) {
      base = base.substring(0, base.length - 7);
    }
    if (base.endsWith('/openai')) {
      targetUrl = `${base}/chat/completions`;
    } else {
      targetUrl = `${base}/openai/chat/completions`;
    }
    headers['Authorization'] = `Bearer ${provider.apiKey}`;
  } else {
    headers['Authorization'] = `Bearer ${provider.apiKey}`;
  }

  // Adjust model ID in payload and remove all internal tracking fields (starting with _)
  const apiPayload = sanitizeProviderPayload({ ...reqPayload, model: target.modelId }, provider.id, target.modelId);
  for (const key of Object.keys(apiPayload)) {
    if (key.startsWith('_')) {
      delete apiPayload[key];
    }
  }

  // Translate payload if Anthropic
  let payloadToSend = apiPayload;
  if (providerType === 'anthropic') {
    payloadToSend = convertToAnthropic(apiPayload);
  }

  const targetTimeoutMs = target.timeoutMs;
  const timeoutMs = targetTimeoutMs || (virtualModel && virtualModel.config && virtualModel.config.timeoutMs) || 60000;


  const axiosConfig = {
    method: 'POST',
    url: targetUrl,
    data: payloadToSend,
    headers,
    timeout: timeoutMs,
    ...proxyAgent
  };

  const requestStartTime = Date.now();
  try {
    if (isStream) {
      axiosConfig.responseType = 'stream';
      eventLog(`Initiating streaming response from ${provider.name}...`);
      const response = await axios(axiosConfig);

      // Set headers for SSE stream later, after verifying the first chunk
      let accumulatedText = '';
      let firstTokenReceived = false;
      let headersSent = false;
      let initialBuffer = [];
      
      await new Promise((resolve, reject) => {
        response.data.on('data', (chunk) => {
          
          if (!headersSent) {
            initialBuffer.push(chunk);
            const bufferedStr = Buffer.concat(initialBuffer).toString();
            
            let isError = false;
            let errorMsg = '';
            let hasValidData = false;
            
            // 1. Check for raw JSON error response instead of SSE
            if (bufferedStr.trim().startsWith('{')) {
              try {
                const parsed = JSON.parse(bufferedStr);
                if (parsed.error) {
                  isError = true;
                  errorMsg = typeof parsed.error === 'string' ? parsed.error : (parsed.error.message || JSON.stringify(parsed.error));
                }
              } catch (e) {}
            }
            
            // 2. Check for SSE chunk containing an error or valid content
            if (!isError) {
              const lines = bufferedStr.split('\n');
              for (const line of lines) {
                if (line.trim().startsWith('data:')) {
                  const dataText = line.substring(5).trim();
                  if (dataText === '[DONE]') {
                    hasValidData = true;
                    continue;
                  }
                  try {
                    const parsed = JSON.parse(dataText);
                    if (parsed.error) {
                      isError = true;
                      errorMsg = typeof parsed.error === 'string' ? parsed.error : (parsed.error.message || JSON.stringify(parsed.error));
                      break;
                    }
                    if (parsed.choices || parsed.type === 'message_start' || parsed.type === 'content_block_delta') {
                      hasValidData = true;
                    }
                  } catch (e) {}
                }
              }
            }
            
            if (isError) {
              response.data.destroy(); // Abort stream
              const err = new Error(errorMsg);
              err.status = 400; // treat as provider error for failover
              return reject(err);
            }
            
            if (hasValidData) {
              res.setHeader('Content-Type', 'text/event-stream');
              res.setHeader('Cache-Control', 'no-cache');
              res.setHeader('Connection', 'keep-alive');
              res.setHeader('x-gateway-provider', provider.name);
              headersSent = true;
              
              for (const bChunk of initialBuffer) {
                res.write(bChunk);
              }
              initialBuffer = [];
              resolve();
            }
            
            return; // Wait for more data if neither error nor valid choices are found
          }

          if (!firstTokenReceived) {
            firstTokenReceived = true;
            recordLatency(provider.id, target.modelId, Date.now() - requestStartTime);
          }
          
          res.write(chunk);
          
          const chunkStr = chunk.toString();
          try {
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
          if (!headersSent) {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            res.setHeader('x-gateway-provider', provider.name);
            headersSent = true;
            for (const bChunk of initialBuffer) {
              res.write(bChunk);
            }
            initialBuffer = [];
            resolve();
          }

          const promptTokens = estimateTokens(JSON.stringify(reqPayload.messages));
          const completionTokens = estimateTokens(accumulatedText);
          const totalTokens = promptTokens + completionTokens;

          recordRequestEnd(provider.id, target.modelId, reqReservation, totalTokens);
          // Finalize pool reservation: update token count and decrement pool in-flight counter.
          if (virtualModel && reqPayload._poolId) {
            releasePoolReservation(reqPayload._poolId, reqPayload._poolReservation || null, totalTokens);
          } else if (virtualModel) {
            recordPoolUsage(virtualModel.id, totalTokens); // legacy path (no pool limits configured)
          }
          if (provider.limits && provider.limits.cooldownMs) {
            setProviderCooldown(provider.id, Number(provider.limits.cooldownMs), true);
          }
          
          // Track stats
          updateStats(true, requestedModel, promptTokens, completionTokens, {
            providerId: provider.id,
            modelId: target.modelId,
            latencyMs: Date.now() - requestStartTime,
            cacheHit: false
          });
          
          eventLog(`Stream finished. Estimated tokens: ${totalTokens} (${promptTokens} prompt, ${completionTokens} completion)`);

          // Add to cache
          if (config.semanticCacheEnabled) {
            const completionData = {
              id: `chatcmpl-${Date.now()}`,
              object: 'chat.completion',
              created: Math.floor(Date.now() / 1000),
              model: requestedModel,
              choices: [{
                index: 0,
                message: { role: 'assistant', content: accumulatedText },
                finish_reason: 'stop'
              }],
              usage: {
                prompt_tokens: promptTokens,
                completion_tokens: completionTokens,
                total_tokens: totalTokens
              }
            };
            addSemanticCache(reqPayload.messages, completionData);
          }

          res.end();
        });

        response.data.on('error', (err) => {
          if (!headersSent) {
            reject(err);
          } else {
            recordRequestEnd(provider.id, target.modelId, reqReservation, 0);
            if (virtualModel && reqPayload._poolId) {
              releasePoolReservation(reqPayload._poolId, reqPayload._poolReservation || null, 0);
            }
            eventLog(`STREAM ERROR MID-STREAM (${provider.name}):`, err.message);
            res.end();
          }
        });
      });

    } else {
      // Non streaming request
      eventLog(`Sending request to ${provider.name}...`);
      const response = await axios(axiosConfig);
      recordLatency(provider.id, target.modelId, Date.now() - requestStartTime);

      let openaiData = response.data;
      if (providerType === 'anthropic') {
        openaiData = formatAnthropicResponse(response.data);
      }

      // Record rate limits
      const promptTokens = openaiData.usage?.prompt_tokens || estimateTokens(JSON.stringify(reqPayload.messages));
      const completionTokens = openaiData.usage?.completion_tokens || estimateTokens(openaiData.choices?.[0]?.message?.content);
      const totalTokens = promptTokens + completionTokens;

      recordRequestEnd(provider.id, target.modelId, reqReservation, totalTokens);
      // Finalize pool reservation: update token count and decrement pool in-flight counter.
      if (virtualModel && reqPayload._poolId) {
        releasePoolReservation(reqPayload._poolId, reqPayload._poolReservation || null, totalTokens);
      } else if (virtualModel) {
        recordPoolUsage(virtualModel.id, totalTokens); // legacy path (no pool limits configured)
      }
      if (provider.limits && provider.limits.cooldownMs) {
        setProviderCooldown(provider.id, Number(provider.limits.cooldownMs), true);
      }
      updateStats(true, requestedModel, promptTokens, completionTokens, {
        providerId: provider.id,
        modelId: target.modelId,
        latencyMs: Date.now() - requestStartTime,
        cacheHit: false
      });

      eventLog(`Request succeeded. Tokens: ${totalTokens}`);

      // Add to cache
      if (config.semanticCacheEnabled) {
        addSemanticCache(reqPayload.messages, openaiData);
      }

      res.setHeader('x-gateway-provider', provider.name);
      return res.status(200).json(openaiData);
    }
  } catch (err) {
    recordRequestEnd(provider.id, target.modelId, reqReservation, 0);
    // Release pool reservation on error (0 tokens consumed)
    if (virtualModel && reqPayload._poolId) {
      releasePoolReservation(reqPayload._poolId, reqPayload._poolReservation || null, 0);
    }

    let errorMsg = err.response?.data?.error?.message || err.response?.data?.message || err.message;
    if (err.code === 'ENOTFOUND') {
      errorMsg += ` (DNS resolution failed for ${err.hostname || err.host}. This may indicate a network block or missing Proxy configuration for ${provider.name}.)`;
    }
    eventLog(`ERROR calling ${provider.name}:`, errorMsg);
    
    // Check if we should place on cooldown and failover based on strategy config
    const status = err.response?.status;
    const isRateLimit = status === 429;
    const isQuota = status === 403;
    const is5xx = status >= 500 && status < 600;
    const isOtherError = !isRateLimit && !isQuota && !is5xx;
    
    // Handle auth/quota failure alerts and auto-disable
    const isAuthError = status === 401 || status === 403 || status === 402;
    if (isAuthError) {
      const dbConfig = loadConfig();
      const pIndex = dbConfig.providers.findIndex(p => p.id === provider.id);
      if (pIndex !== -1) {
        dbConfig.providers[pIndex].enabled = false;
        dbConfig.providers[pIndex].errorMessage = `Disabled: ${errorMsg}`;
        
        // Update local memory config so remainder of this request loop skips it
        const localIndex = config.providers.findIndex(p => p.id === provider.id);
        if (localIndex !== -1) {
          config.providers[localIndex].enabled = false;
        }

        if (!dbConfig.alerts) {
          dbConfig.alerts = [];
        }

        // Add system alert
        const exists = dbConfig.alerts.some(a => a.providerId === provider.id && a.message === errorMsg);
        if (!exists) {
          dbConfig.alerts.push({
            id: `alert_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            providerId: provider.id,
            providerName: provider.name,
            errorType: status === 401 ? 'Authentication Failed (401)' : (status === 402 ? 'Payment Required/Credits Exhausted (402)' : 'Forbidden/Quota Exceeded (403)'),
            message: errorMsg,
            timestamp: new Date().toISOString()
          });
        }

        saveConfig(dbConfig);
        eventLog(`CRITICAL ALERT: Provider ${provider.name} disabled due to auth/quota failure: ${errorMsg}`);
      }
    }
    
    let shouldFallback = true;
    if (virtualModel && virtualModel.config) {
      const vConfig = virtualModel.config;
      if (isRateLimit && vConfig.fallbackOn429 === false) shouldFallback = false;
      if (isQuota && vConfig.fallbackOn403 === false) shouldFallback = false;
      if (is5xx && vConfig.fallbackOn5xx === false) shouldFallback = false;
      if (isOtherError && vConfig.fallbackOn5xx === false) shouldFallback = false;
    }

    if (!shouldFallback) {
      eventLog(`FAILOVER: Fallback bypassed/disabled for this error type (${status || 'network'}). Request failed.`);
      updateStats(false, requestedModel, 0, 0, {
        providerId: provider.id,
        modelId: target.modelId,
        latencyMs: Date.now() - requestStartTime,
        cacheHit: false,
        error: errorMsg,
        diagnostics: buildRequestDiagnostics({
          reqPayload, targetUrl, headers, payloadToSend, timeoutMs, err,
          response: err.response
        })
      });
      return res.status(status || 500).json({
        error: {
          message: `Request failed on targeted backend: ${errorMsg}. Failover bypassed by pool configuration.`,
          provider: provider.name
        }
      });
    }

    // Calculate intelligent cooldown duration
    let cooldownMs = 15000; // 15s default for rate limits / errors
    const retryAfterHeader = err.response?.headers?.['retry-after'];
    if (retryAfterHeader) {
      const parsedHeader = parseInt(retryAfterHeader, 10);
      if (!isNaN(parsedHeader)) {
        cooldownMs = parsedHeader * 1000;
      }
    } else if (target.cooldownMs) {
      cooldownMs = target.cooldownMs;
    } else if (virtualModel && virtualModel.config && virtualModel.config.cooldownMs) {
      cooldownMs = virtualModel.config.cooldownMs;
    } else if (is5xx) {
      cooldownMs = 30000; // 30s for server errors
    }

    const cooldownScope = virtualModel?.config?.cooldownScope || 'provider';
    if (cooldownScope === 'model') {
      setModelCooldown(provider.id, target.modelId, cooldownMs);
    } else {
      setProviderCooldown(provider.id, cooldownMs);
    }

    updateStats(false, requestedModel, 0, 0, {
      providerId: provider.id,
      modelId: target.modelId,
      latencyMs: Date.now() - requestStartTime,
      cacheHit: false,
      error: errorMsg,
      diagnostics: buildRequestDiagnostics({
        reqPayload, targetUrl, headers, payloadToSend, timeoutMs, err,
        response: err.response
      })
    });

    // Trigger failover retry!
    eventLog(`FAILOVER: Retrying next target candidate...`);
    
    if (!reqPayload._failedBackends) {
      reqPayload._failedBackends = new Set();
    }
    reqPayload._failedBackends.add(`${provider.id}:${target.modelId}`);

    // Filter targets to remove failed ones
    const activeTargets = targets.filter(t => !reqPayload._failedBackends.has(`${t.providerId}:${t.modelId}`));
    if (activeTargets.length > 0) {
      return routeChatCompletion(reqPayload, res, onRoutingEvent);
    } else {
      // All targets in the pool failed in this cycle!
      const currentCycle = reqPayload._poolCycle || 1;
      const maxPoolCycles = 3;
      
      if (currentCycle < maxPoolCycles) {
        reqPayload._poolCycle = currentCycle + 1;
        // Reset failed backends list for the next cycle
        reqPayload._failedBackends.clear();
        
        const cyclePauseMs = 3000 * currentCycle; // 3s for cycle 2, 6s for cycle 3
        eventLog(`FAILOVER: All backends in pool attempted (Cycle ${currentCycle}/${maxPoolCycles}). Pausing ${cyclePauseMs / 1000}s before retrying pool...`);
        
        await new Promise(r => setTimeout(r, cyclePauseMs));
        return routeChatCompletion(reqPayload, res, onRoutingEvent);
      } else {
        // Try system-wide emergency fallback if virtual pool completely failed
        const anyActiveProvider = config.providers.find(p => 
          p.enabled && 
          p.id !== provider.id && 
          (p.apiKey || p.apiKeys?.some(k => k.enabled && k.key)) && 
          p.models?.length > 0
        );
        
        if (anyActiveProvider && !reqPayload._emergencyFallbackTried) {
          reqPayload._emergencyFallbackTried = true;
          reqPayload._failedBackends.clear();
          const fbModel = anyActiveProvider.models[0];
          eventLog(`EMERGENCY FAILOVER: All pool backends failed after ${maxPoolCycles} cycles. Retrying with emergency provider ${anyActiveProvider.name}...`);
          return routeChatCompletion({ ...reqPayload, model: `${anyActiveProvider.id}/${fbModel.id}` }, res, onRoutingEvent);
        }
        
        eventLog(`FAILOVER: All backends and emergency fallbacks failed across ${maxPoolCycles} pool cycles. Request failed.`);
        return res.status(err.response?.status || 500).json({
          error: {
            message: `All prioritized backends failed. Last error: ${errorMsg}`,
            provider: provider.name
          }
        });
      }
    }
  }
}

/**
 * Updates stats in the in-memory buffer (flushed to disk on a debounce).
 */
function updateStats(success, virtualModelId = null, promptTokens = 0, completionTokens = 0, extra = {}) {
  // Mutate the in-memory stats buffer only; a debounced flush writes to disk.
  const stats = getStats();
  stats.totalRequests = (stats.totalRequests || 0) + 1;
  if (success) {
    stats.successfulRequests = (stats.successfulRequests || 0) + 1;
    if (virtualModelId && (virtualModelId === 'strong-reasoning' || virtualModelId === 'coding-agent' || virtualModelId === 'fast-flash' || virtualModelId === 'gpt-4o' || virtualModelId === 'claude-3-5-sonnet-20241022')) {
      // Calculate savings! We used a free model instead of a paid one
      const promptSaved = promptTokens;
      const completionSaved = completionTokens;
      const savings = calculateCost(virtualModelId, promptSaved, completionSaved);

      stats.tokensSaved = (stats.tokensSaved || 0) + (promptSaved + completionSaved);
      stats.approximateCostSaved = (stats.approximateCostSaved || 0) + savings;
    }
  } else {
    stats.failedRequests = (stats.failedRequests || 0) + 1;
  }
  scheduleStatsFlush();

  try {
    addStatsHistoryEntry({
      requestedModel: virtualModelId || extra.requestedModel || 'unknown',
      providerId: extra.providerId || (extra.cacheHit ? 'cache' : 'unknown'),
      modelId: extra.modelId || 'unknown',
      success: !!success,
      promptTokens: promptTokens || 0,
      completionTokens: completionTokens || 0,
      totalTokens: (promptTokens || 0) + (completionTokens || 0),
      latencyMs: extra.latencyMs || 0,
      cacheHit: !!extra.cacheHit,
      error: extra.error || null,
      diagnostics: extra.diagnostics || null
    });
  } catch (err) {
    console.error('Failed to add stats history entry:', err);
  }
}
