import { addLog } from './db.js';

// Sliding window history database
// Format: { timestamp: number, tokens: number }
const history = {
  // key: "providerId" or "providerId:modelId"
  requests: {},
};

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
 * Gets the current usage details for a given key and window.
 * @param {string} key - History identifier.
 * @param {number} windowMs - Window duration in milliseconds.
 * @returns {object} - { count: number, tokens: number, oldestTimestamp: number }
 */
function getUsage(key, windowMs) {
  cleanHistory(key, windowMs);
  const reqs = history.requests[key] || [];
  const count = reqs.length;
  const tokens = reqs.reduce((sum, req) => sum + (req.tokens || 0), 0);
  const oldestTimestamp = count > 0 ? reqs[0].timestamp : Date.now();
  return { count, tokens, oldestTimestamp };
}

/**
 * Puts a provider on temporary cooldown.
 * @param {string} providerId - Provider identifier.
 * @param {number} durationMs - Duration in milliseconds (default 30 seconds).
 */
export function setProviderCooldown(providerId, durationMs = 30000) {
  const expires = Date.now() + durationMs;
  cooldowns[providerId] = expires;
  addLog('WARN', `Provider "${providerId}" placed on cooldown for ${durationMs / 1000}s.`);
}

/**
 * Gets remaining cooldown time for a provider.
 * @param {string} providerId - Provider identifier.
 * @returns {number} - Cooldown time remaining in ms, or 0.
 */
export function getProviderCooldownTime(providerId) {
  const expires = cooldowns[providerId];
  if (!expires) return 0;
  const remaining = expires - Date.now();
  return remaining > 0 ? remaining : 0;
}

/**
 * Checks if a provider or specific model has exceeded configured rate limits.
 * Supports RPM, RPH, RPD (Requests Per Minute/Hour/Day) and TPM, TPH, TPD (Tokens Per Minute/Hour/Day).
 * @param {object} provider - Provider config object.
 * @param {object} model - Model config object.
 * @returns {object} - { limited: boolean, reason: string, retryAfterMs: number }
 */
export function checkRateLimit(provider, model) {
  const providerId = provider.id;
  const modelId = model.id;

  // 1. Check active cooldown
  const cooldownRemaining = getProviderCooldownTime(providerId);
  if (cooldownRemaining > 0) {
    return {
      limited: true,
      reason: `Provider cooldown (${Math.ceil(cooldownRemaining / 1000)}s remaining)`,
      retryAfterMs: cooldownRemaining,
    };
  }

  // Define limits to evaluate
  // Format: { name, limitVal, windowMs, isTokenLimit }
  const limitsToCheck = [];

  // Model-level limits (from model.limits or model.defaultLimits)
  const mLimits = { ...model.defaultLimits, ...model.limits };
  
  if (mLimits.rpm) limitsToCheck.push({ name: `Model RPM (${mLimits.rpm})`, val: mLimits.rpm, window: 60 * 1000, token: false, key: `${providerId}:${modelId}` });
  if (mLimits.rph) limitsToCheck.push({ name: `Model RPH (${mLimits.rph})`, val: mLimits.rph, window: 60 * 60 * 1000, token: false, key: `${providerId}:${modelId}` });
  if (mLimits.rpd) limitsToCheck.push({ name: `Model RPD (${mLimits.rpd})`, val: mLimits.rpd, window: 24 * 60 * 60 * 1000, token: false, key: `${providerId}:${modelId}` });
  if (mLimits.rpmo) limitsToCheck.push({ name: `Model RPMonth (${mLimits.rpmo})`, val: mLimits.rpmo, window: 30 * 24 * 60 * 60 * 1000, token: false, key: `${providerId}:${modelId}` });
  
  if (mLimits.tpm) limitsToCheck.push({ name: `Model TPM (${mLimits.tpm})`, val: mLimits.tpm, window: 60 * 1000, token: true, key: `${providerId}:${modelId}` });
  if (mLimits.tph) limitsToCheck.push({ name: `Model TPH (${mLimits.tph})`, val: mLimits.tph, window: 60 * 60 * 1000, token: true, key: `${providerId}:${modelId}` });
  if (mLimits.tpd) limitsToCheck.push({ name: `Model TPD (${mLimits.tpd})`, val: mLimits.tpd, window: 24 * 60 * 60 * 1000, token: true, key: `${providerId}:${modelId}` });
  if (mLimits.tpmo) limitsToCheck.push({ name: `Model TPMonth (${mLimits.tpmo})`, val: mLimits.tpmo, window: 30 * 24 * 60 * 60 * 1000, token: true, key: `${providerId}:${modelId}` });

  // Provider-level limits (if set in provider config)
  const pLimits = provider.limits || {};
  if (pLimits.rpm) limitsToCheck.push({ name: `Provider RPM (${pLimits.rpm})`, val: pLimits.rpm, window: 60 * 1000, token: false, key: providerId });
  if (pLimits.rph) limitsToCheck.push({ name: `Provider RPH (${pLimits.rph})`, val: pLimits.rph, window: 60 * 60 * 1000, token: false, key: providerId });
  if (pLimits.rpd) limitsToCheck.push({ name: `Provider RPD (${pLimits.rpd})`, val: pLimits.rpd, window: 24 * 60 * 60 * 1000, token: false, key: providerId });
  if (pLimits.rpmo) limitsToCheck.push({ name: `Provider RPMonth (${pLimits.rpmo})`, val: pLimits.rpmo, window: 30 * 24 * 60 * 60 * 1000, token: false, key: providerId });
  
  if (pLimits.tpm) limitsToCheck.push({ name: `Provider TPM (${pLimits.tpm})`, val: pLimits.tpm, window: 60 * 1000, token: true, key: providerId });
  if (pLimits.tph) limitsToCheck.push({ name: `Provider TPH (${pLimits.tph})`, val: pLimits.tph, window: 60 * 60 * 1000, token: true, key: providerId });
  if (pLimits.tpd) limitsToCheck.push({ name: `Provider TPD (${pLimits.tpd})`, val: pLimits.tpd, window: 24 * 60 * 60 * 1000, token: true, key: providerId });
  if (pLimits.tpmo) limitsToCheck.push({ name: `Provider TPMonth (${pLimits.tpmo})`, val: pLimits.tpmo, window: 30 * 24 * 60 * 60 * 1000, token: true, key: providerId });

  // Check each limit
  for (const check of limitsToCheck) {
    const { count, tokens, oldestTimestamp } = getUsage(check.key, check.window);
    
    if (check.token) {
      // Token limits checking
      // Note: We check if it is already over, or if there is no room.
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
      // Request limit checking
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
 * Record a request in the sliding window usage history.
 * @param {string} providerId - Provider identifier.
 * @param {string} modelId - Model identifier.
 * @param {number} tokens - Count of tokens estimated or consumed.
 */
export function recordUsage(providerId, modelId, tokens = 0) {
  const now = Date.now();
  const entry = { timestamp: now, tokens };

  // Helper to append and clean
  const append = (key) => {
    if (!history.requests[key]) {
      history.requests[key] = [];
    }
    history.requests[key].push(entry);
  };

  append(providerId); // Provider level
  append(`${providerId}:${modelId}`); // Model level
}

/**
 * Gets all current rate limit stats for all active providers and models.
 * Used for GUI progress bars.
 * @param {Array} providers - All providers from config.
 * @returns {object} - Map of { "providerId" or "providerId:modelId": { requestsUsed, limitRequests, tokensUsed, limitTokens } }
 */
export function getRateLimitMetrics(providers) {
  const metrics = {};
  providers.forEach((provider) => {
    // Provider level
    const pLimits = provider.limits || {};
    if (Object.keys(pLimits).length > 0) {
      const rpmUsage = getUsage(provider.id, 60 * 1000);
      const rphUsage = getUsage(provider.id, 60 * 60 * 1000);
      const rpdUsage = getUsage(provider.id, 24 * 60 * 60 * 1000);
      const rpmoUsage = getUsage(provider.id, 30 * 24 * 60 * 60 * 1000);
      
      metrics[provider.id] = {
        rpm: { used: rpmUsage.count, limit: pLimits.rpm || 0 },
        rph: { used: rphUsage.count, limit: pLimits.rph || 0 },
        rpd: { used: rpdUsage.count, limit: pLimits.rpd || 0 },
        rpmo: { used: rpmoUsage.count, limit: pLimits.rpmo || 0 },
        tpm: { used: rpmUsage.tokens, limit: pLimits.tpm || 0 },
        tph: { used: rphUsage.tokens, limit: pLimits.tph || 0 },
        tpd: { used: rpdUsage.tokens, limit: pLimits.tpd || 0 },
        tpmo: { used: rpmoUsage.tokens, limit: pLimits.tpmo || 0 },
        cooldown: getProviderCooldownTime(provider.id),
      };
    }

    // Model level
    provider.models.forEach((model) => {
      const key = `${provider.id}:${model.id}`;
      const mLimits = { ...model.defaultLimits, ...model.limits };
      
      if (Object.keys(mLimits).length > 0) {
        const rpmUsage = getUsage(key, 60 * 1000);
        const rphUsage = getUsage(key, 60 * 60 * 1000);
        const rpdUsage = getUsage(key, 24 * 60 * 60 * 1000);
        const rpmoUsage = getUsage(key, 30 * 24 * 60 * 60 * 1000);
        
        metrics[key] = {
          rpm: { used: rpmUsage.count, limit: mLimits.rpm || 0 },
          rph: { used: rphUsage.count, limit: mLimits.rph || 0 },
          rpd: { used: rpdUsage.count, limit: mLimits.rpd || 0 },
          rpmo: { used: rpmoUsage.count, limit: mLimits.rpmo || 0 },
          tpm: { used: rpmUsage.tokens, limit: mLimits.tpm || 0 },
          tph: { used: rphUsage.tokens, limit: mLimits.tph || 0 },
          tpd: { used: rpdUsage.tokens, limit: mLimits.tpd || 0 },
          tpmo: { used: rpmoUsage.tokens, limit: mLimits.tpmo || 0 },
        };
      }
    });
  });
  return metrics;
}
