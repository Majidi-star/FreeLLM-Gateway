import { addLog } from './db.js';

// Sliding window history database
// Format: { timestamp: number, tokens: number }
const history = {
  // key: "providerId", "baseProviderId", or "providerId:modelId"
  requests: {},
};

// Active in-flight concurrency tracker per key
const activeConcurrency = {};

// Full details of active in-flight requests for UI
export const activeRequests = [];

// Cooldown expiry timestamps (for API errors or unexpected 429s)
// Format: { providerId: timestamp }
const cooldowns = {};

/**
 * Clean up history entries older than the window duration.
 * @param {string} key - History identifier.
 * @param {number} windowMs - Window duration in milliseconds.
 */
function cleanHistory(key, windowMs) {
  if (!history.requests[key]) {
    history.requests[key] = [];
    return;
  }
  const now = Date.now();
  history.requests[key] = history.requests[key].filter(
    (req) => now - req.timestamp < windowMs
  );
}

/**
 * Overrides the usage history for a key to a specific value.
 */
export function overrideUsage(key, type, newValue) {
  const now = Date.now();
  const reqs = history.requests[key] || [];
  
  let currentCount = reqs.length;
  let currentTokens = reqs.reduce((sum, r) => sum + (r.tokens || 0), 0);
  
  if (type === 'count') {
    currentCount = Math.max(0, newValue);
  } else if (type === 'tokens') {
    currentTokens = Math.max(0, newValue);
  }
  
  history.requests[key] = Array(currentCount).fill(null).map((_, i) => ({
    timestamp: now,
    tokens: i === 0 ? currentTokens : 0
  }));
}

/**
 * Gets the current usage details for a given key and window.
 * @param {string} key - History identifier.
 * @param {number} windowMs - Window duration in milliseconds.
 * @param {number} limitVal - The limit value being tested (to find exact timestamp for slot release)
 * @returns {object} - { count: number, tokens: number, oldestTimestamp: number }
 */
function getUsage(key, windowMs, limitVal = 1) {
  cleanHistory(key, windowMs);
  const reqs = history.requests[key] || [];
  const count = reqs.length;
  const tokens = reqs.reduce((sum, req) => sum + (req.tokens || 0), 0);
  
  const targetIdx = Math.max(0, count - limitVal);
  const oldestTimestamp = count > 0 && reqs[targetIdx] ? reqs[targetIdx].timestamp : Date.now();
  return { count, tokens, oldestTimestamp };
}

/**
 * Puts a provider on temporary cooldown.
 * @param {string} providerId - Provider identifier.
 * @param {number} durationMs - Duration in milliseconds (default 15 seconds).
 */
export function setProviderCooldown(providerId, durationMs = 15000, isSilent = false) {
  const baseProviderId = providerId.split(':')[0];
  const expires = Date.now() + durationMs;
  
  if (!cooldowns[providerId] || expires > cooldowns[providerId]) {
    cooldowns[providerId] = expires;
  }
  if (!cooldowns[baseProviderId] || expires > cooldowns[baseProviderId]) {
    cooldowns[baseProviderId] = expires;
  }
  
  if (!isSilent) {
    addLog('WARN', `Provider "${providerId}" placed on cooldown for ${durationMs / 1000}s.`);
  }
}

/**
 * Puts a specific model on a provider on temporary cooldown.
 * @param {string} providerId - Provider identifier.
 * @param {string} modelId - Model identifier.
 * @param {number} durationMs - Duration in milliseconds (default 15 seconds).
 */
export function setModelCooldown(providerId, modelId, durationMs = 15000, isSilent = false) {
  const key = `${providerId}:${modelId}`;
  const expires = Date.now() + durationMs;
  
  if (!cooldowns[key] || expires > cooldowns[key]) {
    cooldowns[key] = expires;
  }
  
  if (!isSilent) {
    addLog('WARN', `Model "${modelId}" on provider "${providerId}" placed on cooldown for ${durationMs / 1000}s.`);
  }
}

/**
 * Gets remaining cooldown time for a provider.
 * @param {string} providerId - Provider identifier.
 * @returns {number} - Cooldown time remaining in ms, or 0.
 */
export function getProviderCooldownTime(providerId) {
  const baseProviderId = providerId.split(':')[0];
  const expires1 = cooldowns[providerId] || 0;
  const expires2 = cooldowns[baseProviderId] || 0;
  const maxExpires = Math.max(expires1, expires2);
  if (!maxExpires) return 0;
  const remaining = maxExpires - Date.now();
  return remaining > 0 ? remaining : 0;
}

/**
 * Gets remaining cooldown time for a specific model.
 * @param {string} providerId - Provider identifier.
 * @param {string} modelId - Model identifier.
 * @returns {number} - Cooldown time remaining in ms, or 0.
 */
export function getModelCooldownTime(providerId, modelId) {
  const key = `${providerId}:${modelId}`;
  const expires = cooldowns[key] || 0;
  if (!expires) return 0;
  const remaining = expires - Date.now();
  return remaining > 0 ? remaining : 0;
}

/**
 * Gets current active in-flight requests count for a key.
 * @param {string} key - Identifier.
 * @returns {number}
 */
export function getConcurrency(key) {
  return activeConcurrency[key] || 0;
}

/**
 * Checks if a virtual pool has exceeded configured rate limits.
 * Also checks pool-level concurrency (in-flight requests).
 */
export function checkPoolRateLimit(poolId, limits = {}) {
  // Check pool-level concurrency (in-flight requests)
  if (limits.concurrent) {
    const currentPoolConc = activeConcurrency[poolId] || 0;
    if (currentPoolConc >= limits.concurrent) {
      return {
        limited: true,
        reason: `Exceeded Pool Concurrency Limit (${currentPoolConc}/${limits.concurrent} active)`,
        retryAfterMs: 1500,
      };
    }
  }

  const limitsToCheck = [];
  if (limits.rpm) limitsToCheck.push({ name: `Pool RPM (${limits.rpm})`, val: limits.rpm, window: 60 * 1000, token: false, key: poolId });
  if (limits.rph) limitsToCheck.push({ name: `Pool RPH (${limits.rph})`, val: limits.rph, window: 60 * 60 * 1000, token: false, key: poolId });
  if (limits.rpd) limitsToCheck.push({ name: `Pool RPD (${limits.rpd})`, val: limits.rpd, window: 24 * 60 * 60 * 1000, token: false, key: poolId });
  if (limits.rpmo) limitsToCheck.push({ name: `Pool RPMonth (${limits.rpmo})`, val: limits.rpmo, window: 30 * 24 * 60 * 60 * 1000, token: false, key: poolId });
  
  if (limits.tpm) limitsToCheck.push({ name: `Pool TPM (${limits.tpm})`, val: limits.tpm, window: 60 * 1000, token: true, key: poolId });
  if (limits.tph) limitsToCheck.push({ name: `Pool TPH (${limits.tph})`, val: limits.tph, window: 60 * 60 * 1000, token: true, key: poolId });
  if (limits.tpd) limitsToCheck.push({ name: `Pool TPD (${limits.tpd})`, val: limits.tpd, window: 24 * 60 * 60 * 1000, token: true, key: poolId });
  if (limits.tpmo) limitsToCheck.push({ name: `Pool TPMonth (${limits.tpmo})`, val: limits.tpmo, window: 30 * 24 * 60 * 60 * 1000, token: true, key: poolId });

  for (const check of limitsToCheck) {
    const { count, tokens, oldestTimestamp } = getUsage(check.key, check.window, check.val);
    if (check.token) {
      if (tokens >= check.val) {
        const timePassed = Date.now() - oldestTimestamp;
        return { limited: true, reason: `Exceeded ${check.name} (${tokens} tokens used)`, retryAfterMs: Math.max(1000, check.window - timePassed) };
      }
    } else {
      if (count >= check.val) {
        const timePassed = Date.now() - oldestTimestamp;
        return { limited: true, reason: `Exceeded ${check.name} (${count} requests made)`, retryAfterMs: Math.max(1000, check.window - timePassed) };
      }
    }
  }
  return { limited: false, reason: '', retryAfterMs: 0 };
}

/**
 * Checks if a provider or specific model has exceeded configured rate limits.
 * Supports Concurrency, RPM, RPH, RPD, RPMonth, TPM, TPH, TPD, TPMonth.
 * @param {object} provider - Provider config object.
 * @param {object} model - Model config object.
 * @returns {object} - { limited: boolean, reason: string, retryAfterMs: number }
 */
export function checkRateLimit(provider, model) {
  const providerId = provider.id;
  const baseProviderId = providerId.split(':')[0];
  const modelId = model.id;

  // 1. Check active cooldown
  const providerCooldownRemaining = getProviderCooldownTime(providerId);
  const modelCooldownRemaining = getModelCooldownTime(providerId, modelId);
  
  const maxCooldown = Math.max(providerCooldownRemaining, modelCooldownRemaining);
  
  if (maxCooldown > 0) {
    const isModelSpecific = modelCooldownRemaining > providerCooldownRemaining;
    return {
      limited: true,
      reason: isModelSpecific 
        ? `Model cooldown (${Math.ceil(maxCooldown / 1000)}s remaining)` 
        : `Provider cooldown (${Math.ceil(maxCooldown / 1000)}s remaining)`,
      retryAfterMs: maxCooldown,
    };
  }

  const pLimits = provider.limits || {};
  const mLimits = { ...model.defaultLimits, ...model.limits };

  // 2. Check Concurrency Limits (Instantaneous active HTTP calls)
  if (pLimits.concurrent) {
    const currentConc = Math.max(getConcurrency(providerId), getConcurrency(baseProviderId));
    if (currentConc >= pLimits.concurrent) {
      return {
        limited: true,
        reason: `Exceeded Provider Concurrency Limit (${currentConc}/${pLimits.concurrent} active)`,
        retryAfterMs: 1500,
      };
    }
  }

  if (mLimits.concurrent) {
    const currentMConc = getConcurrency(`${providerId}:${modelId}`);
    if (currentMConc >= mLimits.concurrent) {
      return {
        limited: true,
        reason: `Exceeded Model Concurrency Limit (${currentMConc}/${mLimits.concurrent} active)`,
        retryAfterMs: 1500,
      };
    }
  }

  // 3. Define rate limits to evaluate
  const limitsToCheck = [];

  // Model-level limits
  if (mLimits.rpm) limitsToCheck.push({ name: `Model RPM (${mLimits.rpm})`, val: mLimits.rpm, window: 60 * 1000, token: false, key: `${providerId}:${modelId}` });
  if (mLimits.rph) limitsToCheck.push({ name: `Model RPH (${mLimits.rph})`, val: mLimits.rph, window: 60 * 60 * 1000, token: false, key: `${providerId}:${modelId}` });
  if (mLimits.rpd) limitsToCheck.push({ name: `Model RPD (${mLimits.rpd})`, val: mLimits.rpd, window: 24 * 60 * 60 * 1000, token: false, key: `${providerId}:${modelId}` });
  if (mLimits.rpmo) limitsToCheck.push({ name: `Model RPMonth (${mLimits.rpmo})`, val: mLimits.rpmo, window: 30 * 24 * 60 * 60 * 1000, token: false, key: `${providerId}:${modelId}` });
  
  if (mLimits.tpm) limitsToCheck.push({ name: `Model TPM (${mLimits.tpm})`, val: mLimits.tpm, window: 60 * 1000, token: true, key: `${providerId}:${modelId}` });
  if (mLimits.tph) limitsToCheck.push({ name: `Model TPH (${mLimits.tph})`, val: mLimits.tph, window: 60 * 60 * 1000, token: true, key: `${providerId}:${modelId}` });
  if (mLimits.tpd) limitsToCheck.push({ name: `Model TPD (${mLimits.tpd})`, val: mLimits.tpd, window: 24 * 60 * 60 * 1000, token: true, key: `${providerId}:${modelId}` });
  if (mLimits.tpmo) limitsToCheck.push({ name: `Model TPMonth (${mLimits.tpmo})`, val: mLimits.tpmo, window: 30 * 24 * 60 * 60 * 1000, token: true, key: `${providerId}:${modelId}` });

  // Provider-level limits (evaluate for providerId and baseProviderId)
  const addPLimit = (name, val, window, token) => {
    limitsToCheck.push({ name: `Provider ${name} (${val})`, val, window, token, key: providerId });
    if (baseProviderId !== providerId) {
      limitsToCheck.push({ name: `Base Provider ${name} (${val})`, val, window, token, key: baseProviderId });
    }
  };

  if (pLimits.rpm) addPLimit('RPM', pLimits.rpm, 60 * 1000, false);
  if (pLimits.rph) addPLimit('RPH', pLimits.rph, 60 * 60 * 1000, false);
  if (pLimits.rpd) addPLimit('RPD', pLimits.rpd, 24 * 60 * 60 * 1000, false);
  if (pLimits.rpmo) addPLimit('RPMonth', pLimits.rpmo, 30 * 24 * 60 * 60 * 1000, false);

  if (pLimits.tpm) addPLimit('TPM', pLimits.tpm, 60 * 1000, true);
  if (pLimits.tph) addPLimit('TPH', pLimits.tph, 60 * 60 * 1000, true);
  if (pLimits.tpd) addPLimit('TPD', pLimits.tpd, 24 * 60 * 60 * 1000, true);
  if (pLimits.tpmo) addPLimit('TPMonth', pLimits.tpmo, 30 * 24 * 60 * 60 * 1000, true);

  // Check each limit
  for (const check of limitsToCheck) {
    const { count, tokens, oldestTimestamp } = getUsage(check.key, check.window, check.val);
    
    if (check.token) {
      if (tokens >= check.val) {
        const timePassed = Date.now() - oldestTimestamp;
        const retryAfterMs = Math.max(1000, check.window - timePassed);
        return {
          limited: true,
          reason: `Exceeded ${check.name} (${tokens} tokens used)`,
          retryAfterMs,
        };
      }
    } else {
      if (count >= check.val) {
        const timePassed = Date.now() - oldestTimestamp;
        const retryAfterMs = Math.max(1000, check.window - timePassed);
        return {
          limited: true,
          reason: `Exceeded ${check.name} (${count} requests made)`,
          retryAfterMs,
        };
      }
    }
  }

  return { limited: false, reason: '', retryAfterMs: 0 };
}

/**
 * Pre-flight reservation when a request is dispatched.
 * Increments concurrency and records an immediate request entry.
 * @param {string} providerId - Provider identifier.
 * @param {string} modelId - Model identifier.
 * @param {number} estimatedTokens - Optional prompt token count for live view.
 * @returns {object} - The created history entry object reference.
 */
export function recordRequestStart(providerId, modelId, estimatedTokens = 0) {
  const baseProviderId = providerId.split(':')[0];
  const modelKey = `${providerId}:${modelId}`;
  
  activeConcurrency[providerId] = (activeConcurrency[providerId] || 0) + 1;
  if (baseProviderId !== providerId) {
    activeConcurrency[baseProviderId] = (activeConcurrency[baseProviderId] || 0) + 1;
  }
  activeConcurrency[modelKey] = (activeConcurrency[modelKey] || 0) + 1;

  const now = Date.now();
  const entry = { timestamp: now, tokens: estimatedTokens, providerId, modelId };

  activeRequests.push(entry);

  const append = (key) => {
    if (!history.requests[key]) history.requests[key] = [];
    history.requests[key].push(entry);
  };

  append(providerId);
  if (baseProviderId !== providerId) append(baseProviderId);
  append(modelKey);

  return entry;
}

/**
 * Post-execution cleanup when a request finishes or fails.
 * Decrements concurrency and updates token consumption.
 * @param {string} providerId - Provider identifier.
 * @param {string} modelId - Model identifier.
 * @param {object} entry - The history entry reference returned by recordRequestStart.
 * @param {number} tokens - Count of tokens estimated or consumed.
 */
export function recordRequestEnd(providerId, modelId, entry, tokens = 0) {
  const baseProviderId = providerId.split(':')[0];
  const modelKey = `${providerId}:${modelId}`;

  if (activeConcurrency[providerId] > 0) activeConcurrency[providerId]--;
  if (baseProviderId !== providerId && activeConcurrency[baseProviderId] > 0) activeConcurrency[baseProviderId]--;
  if (activeConcurrency[modelKey] > 0) activeConcurrency[modelKey]--;

  if (entry) {
    entry.tokens = tokens;
    const idx = activeRequests.findIndex(r => r === entry);
    if (idx !== -1) {
      activeRequests.splice(idx, 1);
    }
  }
}

/**
 * Legacy wrapper for backward compatibility.
 */
export function recordUsage(providerId, modelId, tokens = 0) {
  const entry = recordRequestStart(providerId, modelId);
  recordRequestEnd(providerId, modelId, entry, tokens);
}

/**
 * Gets all current rate limit stats for all active providers and models.
 * Used for GUI progress bars.
 * @param {Array} providers - All providers from config.
 * @returns {object}
 */
export function getRateLimitMetrics(config) {
  const metrics = {};
  config.providers.forEach((provider) => {
    // Provider level
    const pLimits = provider.limits || {};
    if (Object.keys(pLimits).length > 0) {
      const rpmUsage = getUsage(provider.id, 60 * 1000, pLimits.rpm || 1);
      const rphUsage = getUsage(provider.id, 60 * 60 * 1000, pLimits.rph || 1);
      const rpdUsage = getUsage(provider.id, 24 * 60 * 60 * 1000, pLimits.rpd || 1);
      const rpmoUsage = getUsage(provider.id, 30 * 24 * 60 * 60 * 1000, pLimits.rpmo || 1);
      
      metrics[provider.id] = {
        rpm: { used: rpmUsage.count, limit: pLimits.rpm || 0 },
        rph: { used: rphUsage.count, limit: pLimits.rph || 0 },
        rpd: { used: rpdUsage.count, limit: pLimits.rpd || 0 },
        rpmo: { used: rpmoUsage.count, limit: pLimits.rpmo || 0 },
        tpm: { used: rpmUsage.tokens, limit: pLimits.tpm || 0 },
        tph: { used: rphUsage.tokens, limit: pLimits.tph || 0 },
        tpd: { used: rpdUsage.tokens, limit: pLimits.tpd || 0 },
        tpmo: { used: rpmoUsage.tokens, limit: pLimits.tpmo || 0 },
        concurrent: { used: getConcurrency(provider.id), limit: pLimits.concurrent || 0 },
        cooldown: getProviderCooldownTime(provider.id),
      };
    }

    // Model level
    provider.models.forEach((model) => {
      const key = `${provider.id}:${model.id}`;
      const mLimits = { ...model.defaultLimits, ...model.limits };
      
      if (Object.keys(mLimits).length > 0) {
        const rpmUsage = getUsage(key, 60 * 1000, mLimits.rpm || 1);
        const rphUsage = getUsage(key, 60 * 60 * 1000, mLimits.rph || 1);
        const rpdUsage = getUsage(key, 24 * 60 * 60 * 1000, mLimits.rpd || 1);
        const rpmoUsage = getUsage(key, 30 * 24 * 60 * 60 * 1000, mLimits.rpmo || 1);
        
        metrics[key] = {
          rpm: { used: rpmUsage.count, limit: mLimits.rpm || 0 },
          rph: { used: rphUsage.count, limit: mLimits.rph || 0 },
          rpd: { used: rpdUsage.count, limit: mLimits.rpd || 0 },
          rpmo: { used: rpmoUsage.count, limit: mLimits.rpmo || 0 },
          tpm: { used: rpmUsage.tokens, limit: mLimits.tpm || 0 },
          tph: { used: rphUsage.tokens, limit: mLimits.tph || 0 },
          tpd: { used: rpdUsage.tokens, limit: mLimits.tpd || 0 },
          tpmo: { used: rpmoUsage.tokens, limit: mLimits.tpmo || 0 },
          concurrent: { used: getConcurrency(key), limit: mLimits.concurrent || 0 },
        };
      }
    });
  });

  // Include virtual pools limits
  config.virtualModels.forEach(vm => {
    if (vm.limits && Object.keys(vm.limits).length > 0) {
      const rpmUsage = getUsage(vm.id, 60 * 1000, vm.limits.rpm || 1);
      const rphUsage = getUsage(vm.id, 60 * 60 * 1000, vm.limits.rph || 1);
      const rpdUsage = getUsage(vm.id, 24 * 60 * 60 * 1000, vm.limits.rpd || 1);
      const rpmoUsage = getUsage(vm.id, 30 * 24 * 60 * 60 * 1000, vm.limits.rpmo || 1);
      
      metrics[vm.id] = {
        rpm: { used: rpmUsage.count, limit: vm.limits.rpm || 0 },
        rph: { used: rphUsage.count, limit: vm.limits.rph || 0 },
        rpd: { used: rpdUsage.count, limit: vm.limits.rpd || 0 },
        rpmo: { used: rpmoUsage.count, limit: vm.limits.rpmo || 0 },
        tpm: { used: rpmUsage.tokens, limit: vm.limits.tpm || 0 },
        tph: { used: rphUsage.tokens, limit: vm.limits.tph || 0 },
        tpd: { used: rpdUsage.tokens, limit: vm.limits.tpd || 0 },
        tpmo: { used: rpmoUsage.tokens, limit: vm.limits.tpmo || 0 },
      };
    }
  });

  return metrics;
}

/**
 * Legacy helper — records a completed pool usage entry (no pre-flight).
 * Prefer tryReservePool / releasePoolReservation for new call sites.
 */
export function recordPoolUsage(poolId, totalTokens = 0) {
  const now = Date.now();
  if (!history.requests[poolId]) history.requests[poolId] = [];
  history.requests[poolId].push({ timestamp: now, tokens: totalTokens });
}

// ---------------------------------------------------------------------------
// Atomic reserve helpers — eliminate TOCTOU races for multi-user concurrency
// ---------------------------------------------------------------------------

/**
 * Atomically checks rate limits for a provider+model and, if allowed, claims
 * the slot immediately (increments concurrency + pushes a sliding-window entry).
 *
 * Because JavaScript is single-threaded and this function contains no `await`,
 * nothing can interleave between the check and the reservation — TOCTOU is
 * eliminated.
 *
 * @param {object} provider - Provider config object.
 * @param {object} model    - Model config object.
 * @param {number} estimatedTokens - Optional prompt token estimate for live view.
 * @returns {{ reserved: boolean, entry?: object, reason?: string, retryAfterMs?: number }}
 */
export function tryReserve(provider, model, estimatedTokens = 0) {
  const result = checkRateLimit(provider, model);
  if (result.limited) {
    return { reserved: false, reason: result.reason, retryAfterMs: result.retryAfterMs };
  }
  // Claim the slot synchronously — safe because no await between check and increment.
  const entry = recordRequestStart(provider.id, model.id, estimatedTokens);
  return { reserved: true, entry };
}

/**
 * Atomically checks pool-level rate limits and, if allowed, claims a pool slot
 * (increments pool concurrency + pushes a pre-flight sliding-window entry).
 *
 * @param {string} poolId  - Virtual pool / virtualModel id.
 * @param {object} limits  - Pool limits config (rpm, rpd, tpm, concurrent, …).
 * @returns {{ reserved: boolean, entry?: object, reason?: string, retryAfterMs?: number }}
 */
export function tryReservePool(poolId, limits = {}) {
  const result = checkPoolRateLimit(poolId, limits);
  if (result.limited) {
    return { reserved: false, reason: result.reason, retryAfterMs: result.retryAfterMs };
  }
  // Claim pool slot synchronously.
  if (!history.requests[poolId]) history.requests[poolId] = [];
  const entry = { timestamp: Date.now(), tokens: 0 };
  history.requests[poolId].push(entry);
  activeConcurrency[poolId] = (activeConcurrency[poolId] || 0) + 1;
  return { reserved: true, entry };
}

/**
 * Finalises a pool reservation made by tryReservePool.
 * Updates the token count on the pre-flight entry and decrements pool concurrency.
 *
 * @param {string} poolId    - Virtual pool id.
 * @param {object|null} entry - The entry reference returned by tryReservePool.
 * @param {number} tokens    - Actual tokens consumed (0 on failure/abort).
 */
export function releasePoolReservation(poolId, entry, tokens = 0) {
  if (entry) {
    entry.tokens = tokens;
  }
  if ((activeConcurrency[poolId] || 0) > 0) {
    activeConcurrency[poolId]--;
  }
}

