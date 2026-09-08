import { PoolRepository } from '../infra/db/repositories/poolRepo.js';
import { ConnectionRepository } from '../infra/db/repositories/connectionRepo.js';
import { ModelRepository } from '../infra/db/repositories/modelRepo.js';
import { ProviderRepository } from '../infra/db/repositories/providerRepo.js';
import { HealthRepository } from '../infra/db/repositories/healthRepo.js';
import { QuotaRepository } from '../infra/db/repositories/quotaRepo.js';
import { RequestLogRepository } from '../infra/db/repositories/requestLogRepo.js';
import { CircuitBreaker } from '../domain/resilience/circuitBreaker.js';
import { calculateCooldownMs } from '../domain/resilience/cooldown.js';
import { computeSlidingWindowUsage, getWindowStart, wouldQuotaExceed } from '../domain/quota/slidingWindow.js';
import { resolvePolicyFunction } from '../domain/routing/policySelector.js';
import { translateRequestToProvider } from '../domain/translation/openaiToProvider.js';
import { translateResponseToOpenAI } from '../domain/translation/providerToOpenai.js';
import { OpenAIChatRequest, OpenAIChatResponse } from '../domain/translation/types.js';
import { callProviderEndpoint, callProviderEndpointStream } from '../infra/http/providerClient.js';
import { transformToOpenAISSEStream } from '../domain/translation/sseStream.js';
import { decryptCredential } from '../infra/security/vault.js';
import { AllTargetsExhaustedError, NotFoundError } from '../shared/errors.js';
import { DecisionTraceEntry } from '../shared/types.js';
import { PoolStepInfo } from '../domain/routing/types.js';
import { logger } from '../infra/logger.js';

export interface DispatchResult {
  response: OpenAIChatResponse;
  decisionTrace: DecisionTraceEntry[];
  selectedStep: PoolStepInfo;
  latencyMs: number;
}

export interface DispatchStreamResult {
  stream: AsyncIterable<string>;
  decisionTrace: DecisionTraceEntry[];
  selectedStep: PoolStepInfo;
  latencyMs: number;
}

export const breakerRegistry = new Map<string, CircuitBreaker>();

export function getSharedCircuitBreaker(
  connId: string,
  healthRecord: { state: any; consecutive_failures: number; opened_at: number | null } | null,
  now: number
): CircuitBreaker {
  let cb = breakerRegistry.get(connId);
  if (!cb) {
    cb = new CircuitBreaker(
      { failureThreshold: 5 },
      { now: () => Date.now() },
      healthRecord ? { state: healthRecord.state, consecutiveFailures: healthRecord.consecutive_failures, openedAt: healthRecord.opened_at } : undefined
    );
    breakerRegistry.set(connId, cb);
  }
  return cb;
}

export const locallyExpiredConnections = new Map<string, number>();

export function pruneLocallyExpiredConnections(now: number = Date.now()): void {
  for (const [id, expiry] of locallyExpiredConnections.entries()) {
    if (now >= expiry) {
      locallyExpiredConnections.delete(id);
    }
  }
}

export const locallyExpiredConnectionIds = {
  add(id: string): void {
    locallyExpiredConnections.set(id, Date.now() + 10 * 60 * 1000);
  },
  has(id: string): boolean {
    pruneLocallyExpiredConnections();
    const expiry = locallyExpiredConnections.get(id);
    if (!expiry) return false;
    if (Date.now() >= expiry) {
      locallyExpiredConnections.delete(id);
      return false;
    }
    return true;
  },
  delete(id: string): boolean {
    return locallyExpiredConnections.delete(id);
  },
  clear(): void {
    locallyExpiredConnections.clear();
  },
};

export function safeParseTaskFitness(raw?: string | null): Record<string, number> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

export class GatewayService {
  constructor(
    private poolRepo: PoolRepository,
    private connectionRepo: ConnectionRepository,
    private modelRepo: ModelRepository,
    private providerRepo: ProviderRepository,
    private healthRepo: HealthRepository,
    private quotaRepo: QuotaRepository,
    private logRepo: RequestLogRepository
  ) {}

  public async dispatch(poolId: string, request: OpenAIChatRequest): Promise<DispatchResult> {
    const pool = this.poolRepo.findPoolById(poolId);
    if (!pool || !pool.is_active) {
      throw new NotFoundError(`Active pool with ID '${poolId}' not found`);
    }

    const rawSteps = this.poolRepo.getPoolSteps(poolId);
    if (rawSteps.length === 0) {
      throw new AllTargetsExhaustedError([], `Pool '${poolId}' has no target steps configured`);
    }

    const now = Date.now();
    const stepInfos: PoolStepInfo[] = [];

    // Build step info snapshot with live state
    for (const step of rawSteps) {
      const conn = this.connectionRepo.findById(step.connection_id);
      const mdl = this.modelRepo.findById(step.model_id);
      const prov = conn ? this.providerRepo.findById(conn.provider_id) : null;

      if (!conn || !mdl || !prov) continue;
      if (conn.status === 'expired' || conn.status === 'banned' || conn.status === 'unavailable' || locallyExpiredConnectionIds.has(conn.id)) {
        continue;
      }

      // Health state & Cooldown state from DB
      const healthRecord = this.healthRepo.get(conn.id);
      const cb = getSharedCircuitBreaker(conn.id, healthRecord, now);

      const isCooldownActive = healthRecord?.cooldown_until != null && now < healthRecord.cooldown_until;

      // Quota headroom estimate
      let quotaRemainingPct = 1.0;
      try {
        const policy = this.quotaRepo.getPolicy(conn.id, 'daily_tokens');
        if (policy) {
          const windowStart = getWindowStart(now, policy.window_seconds);
          const currentUsage = this.quotaRepo.getUsage(conn.id, 'daily_tokens', windowStart);
          const prevUsage = this.quotaRepo.getUsage(conn.id, 'daily_tokens', windowStart - policy.window_seconds * 1000);
          const usage = computeSlidingWindowUsage({ currentUsage, previousUsage: prevUsage, windowSeconds: policy.window_seconds, nowMs: now });
          quotaRemainingPct = Math.max(0, 1 - usage / policy.limit_value);
        }
      } catch (quotaErr: any) {
        logger.warn({ connectionId: conn.id, error: quotaErr.message }, 'Failed to compute quota headroom');
      }

      const taskFitnessMap = safeParseTaskFitness(mdl.task_fitness);

      stepInfos.push({
        id: step.id,
        poolId: step.pool_id,
        orderIndex: step.order_index,
        connectionId: conn.id,
        providerSlug: prov.slug,
        providerBaseUrl: prov.base_url,
        providerProtocol: prov.protocol,
        modelId: mdl.id,
        modelName: mdl.model_name,
        role: step.role,
        weight: step.weight,
        healthState: cb.getState(),
        isCooldownActive,
        quotaRemainingPct,
        benchTtftMs: mdl.bench_ttft_ms || undefined,
        benchP95LatencyMs: mdl.bench_p95_latency_ms || undefined,
        costPer1kUsd: mdl.cost_input_per_1k + mdl.cost_output_per_1k,
        taskFitness: taskFitnessMap.coding_agent || 0.8,
      });
    }

    const policyFn = resolvePolicyFunction(pool.policy);
    const orderedSteps = policyFn(stepInfos);
    const decisionTrace: DecisionTraceEntry[] = [];

    for (const step of orderedSteps) {
      const conn = this.connectionRepo.findById(step.connectionId);
      if (!conn || conn.status === 'expired' || conn.status === 'banned' || conn.status === 'unavailable' || locallyExpiredConnectionIds.has(step.connectionId)) {
        decisionTrace.push({
          stepIndex: step.orderIndex,
          connectionId: step.connectionId,
          providerSlug: step.providerSlug,
          modelId: step.modelId,
          status: 'skipped',
          reason: `Connection status is ${conn?.status || 'expired'}`,
        });
        continue;
      }

      // 1. Circuit Breaker Gate
      const healthRecord = this.healthRepo.get(conn.id);
      const cb = getSharedCircuitBreaker(conn.id, healthRecord, Date.now());

      if (!cb.allowRequest()) {
        decisionTrace.push({
          stepIndex: step.orderIndex,
          connectionId: step.connectionId,
          providerSlug: step.providerSlug,
          modelId: step.modelId,
          status: 'skipped',
          reason: `Circuit breaker is ${cb.getState()}`,
        });
        continue;
      }

      // 2. Cooldown Gate
      if (healthRecord?.cooldown_until != null && Date.now() < healthRecord.cooldown_until) {
        decisionTrace.push({
          stepIndex: step.orderIndex,
          connectionId: step.connectionId,
          providerSlug: step.providerSlug,
          modelId: step.modelId,
          status: 'skipped',
          reason: 'Cooldown is active',
        });
        continue;
      }

      // 2. Quota Gate (Fail-Open on DB error)
      let quotaExceeded = false;
      const estimatedTokens = request.max_tokens || 1000;
      try {
        const dailyPolicy = this.quotaRepo.getPolicy(conn.id, 'daily_tokens');
        if (dailyPolicy) {
          const windowStart = getWindowStart(Date.now(), dailyPolicy.window_seconds);
          const currentUsage = this.quotaRepo.getUsage(conn.id, 'daily_tokens', windowStart);
          const prevUsage = this.quotaRepo.getUsage(conn.id, 'daily_tokens', windowStart - dailyPolicy.window_seconds * 1000);

          if (wouldQuotaExceed(dailyPolicy.limit_value, { currentUsage, previousUsage: prevUsage, windowSeconds: dailyPolicy.window_seconds, nowMs: Date.now() }, estimatedTokens)) {
            quotaExceeded = true;
          }
        }
      } catch (quotaErr: any) {
        logger.warn({ connectionId: conn.id, error: quotaErr.message }, 'Quota gate database call failed; failing open');
      }

      if (quotaExceeded) {
        decisionTrace.push({
          stepIndex: step.orderIndex,
          connectionId: step.connectionId,
          providerSlug: step.providerSlug,
          modelId: step.modelId,
          status: 'skipped',
          reason: 'Quota limit would be exceeded',
        });
        continue;
      }

      // Pre-reserve estimated tokens in quota ledger
      let currentWindowStart = Date.now();
      try {
        const dailyPolicy = this.quotaRepo.getPolicy(conn.id, 'daily_tokens');
        const windowSec = dailyPolicy ? dailyPolicy.window_seconds : 86400;
        currentWindowStart = getWindowStart(Date.now(), windowSec);
        this.quotaRepo.recordUsage(conn.id, 'daily_tokens', currentWindowStart, estimatedTokens);
      } catch (recErr: any) {
        logger.warn({ connectionId: conn.id, error: recErr.message }, 'Failed to pre-reserve quota usage');
      }

      // 3. Dispatch Attempt
      try {
        const apiKey = decryptCredential({
          ciphertext: conn.credential_enc,
          iv: conn.credential_iv,
          tag: conn.credential_tag,
        });

        const translated = translateRequestToProvider(request, step.providerProtocol, step.modelName);

        const httpRes = await callProviderEndpoint({
          baseUrl: step.providerBaseUrl,
          endpoint: translated.endpoint,
          apiKey,
          protocol: step.providerProtocol,
          method: 'POST',
          headers: translated.headers,
          body: translated.body,
          timeoutMs: 30000,
        });

        const oaiResponse = translateResponseToOpenAI(httpRes.data, step.providerProtocol, step.modelName);

        // Record Success
        cb.recordSuccess();
        const snapshot = cb.getSnapshot();
        this.healthRepo.upsert({
          connection_id: conn.id,
          state: snapshot.state,
          consecutive_failures: snapshot.consecutiveFailures,
          opened_at: snapshot.openedAt,
          cooldown_until: null,
        });

        // Record Quota Usage Adjustment (Delta)
        let actualTokens = estimatedTokens;
        if (oaiResponse.usage && typeof oaiResponse.usage.total_tokens === 'number') {
          actualTokens = oaiResponse.usage.total_tokens;
        } else {
          logger.warn({ connectionId: conn.id, providerSlug: step.providerSlug }, 'Missing usage metadata from provider response; retaining estimated tokens');
          const promptChars = (request.messages || []).reduce((acc, m) => acc + (typeof m.content === 'string' ? m.content.length : 0), 0);
          const completionChars = oaiResponse.choices?.[0]?.message?.content ? oaiResponse.choices[0].message.content.length : 0;
          actualTokens = Math.max(estimatedTokens, Math.ceil((promptChars + completionChars) / 4));
        }

        try {
          const deltaTokens = actualTokens - estimatedTokens;
          if (deltaTokens !== 0) {
            this.quotaRepo.recordUsage(conn.id, 'daily_tokens', currentWindowStart, deltaTokens);
          }
          this.quotaRepo.recordUsage(conn.id, 'daily_requests', currentWindowStart, 1);
        } catch (recErr: any) {
          logger.warn({ connectionId: conn.id, error: recErr.message }, 'Failed to record quota usage');
        }

        decisionTrace.push({
          stepIndex: step.orderIndex,
          connectionId: step.connectionId,
          providerSlug: step.providerSlug,
          modelId: step.modelId,
          status: 'selected',
          latencyMs: httpRes.latencyMs,
          reason: `Successfully served request via ${step.providerSlug}/${step.modelName}`,
        });

        // Log Request
        this.logRepo.log({
          pool_id: poolId,
          connection_id: conn.id,
          model_id: step.modelId,
          status: 'success',
          latency_ms: httpRes.latencyMs,
          tokens_in: oaiResponse.usage?.prompt_tokens || 0,
          tokens_out: oaiResponse.usage?.completion_tokens || 0,
          cost_usd: 0,
          error_code: null,
          decision_trace: JSON.stringify(decisionTrace),
        });

        return {
          response: oaiResponse,
          decisionTrace,
          selectedStep: step,
          latencyMs: httpRes.latencyMs,
        };
      } catch (err: any) {
        // Refund pre-reserved tokens on dispatch failure
        try {
          this.quotaRepo.recordUsage(conn.id, 'daily_tokens', currentWindowStart, -estimatedTokens);
        } catch (refundErr: any) {
          logger.warn({ connectionId: conn.id, error: refundErr.message }, 'Failed to refund pre-reserved quota');
        }
        const statusCode = err.statusCode;
        const prov = this.providerRepo.findById(conn.provider_id);
        const authType = prov?.auth_type || 'api_key';

        const isHtmlWaf = /type=HTML/i.test(err.message || '') || /<html>/i.test(err.message || '');
        const isTerminalAuth = statusCode === 401 || (statusCode === 403 && !isHtmlWaf);

        if (isTerminalAuth) {
          locallyExpiredConnectionIds.add(conn.id);
          this.connectionRepo.updateStatus(conn.id, 'expired', err.message);
          decisionTrace.push({
            stepIndex: step.orderIndex,
            connectionId: step.connectionId,
            providerSlug: step.providerSlug,
            modelId: step.modelId,
            status: 'attempted_failed',
            error: err.message,
            reason: 'CREDENTIAL_EXPIRED',
          });
          logger.warn({ connectionId: conn.id, error: err.message }, 'Credential expired (401/403), connection status updated to expired');
          continue;
        }

        const isBreakerEligible = statusCode === undefined || [403, 408, 429, 500, 502, 503, 504].includes(statusCode);

        if (isBreakerEligible) {
          cb.recordFailure();
          const snapshot = cb.getSnapshot();
          const cooldownDuration = calculateCooldownMs(authType, snapshot.consecutiveFailures - 1, err.retryAfterSeconds);
          const cooldownUntil = Date.now() + cooldownDuration;

          this.healthRepo.upsert({
            connection_id: conn.id,
            state: snapshot.state,
            consecutive_failures: snapshot.consecutiveFailures,
            opened_at: snapshot.openedAt,
            cooldown_until: cooldownUntil,
          });
        }

        decisionTrace.push({
          stepIndex: step.orderIndex,
          connectionId: step.connectionId,
          providerSlug: step.providerSlug,
          modelId: step.modelId,
          status: 'attempted_failed',
          error: err.message,
        });

        logger.warn({ connectionId: conn.id, error: err.message }, 'Target dispatch failed, falling back to next step');
      }
    }

    // All steps exhausted
    this.logRepo.log({
      pool_id: poolId,
      connection_id: null,
      model_id: null,
      status: 'failed',
      latency_ms: 0,
      tokens_in: 0,
      tokens_out: 0,
      cost_usd: 0,
      error_code: 'ALL_TARGETS_EXHAUSTED',
      decision_trace: JSON.stringify(decisionTrace),
    });

    throw new AllTargetsExhaustedError(decisionTrace);
  }

  public async dispatchStream(poolId: string, request: OpenAIChatRequest, signal?: AbortSignal): Promise<DispatchStreamResult> {
    const pool = this.poolRepo.findPoolById(poolId);
    if (!pool || !pool.is_active) {
      throw new NotFoundError(`Active pool with ID '${poolId}' not found`);
    }

    const rawSteps = this.poolRepo.getPoolSteps(poolId);
    if (rawSteps.length === 0) {
      throw new AllTargetsExhaustedError([], `Pool '${poolId}' has no target steps configured`);
    }

    const now = Date.now();
    const stepInfos: PoolStepInfo[] = [];

    for (const step of rawSteps) {
      const conn = this.connectionRepo.findById(step.connection_id);
      const mdl = this.modelRepo.findById(step.model_id);
      const prov = conn ? this.providerRepo.findById(conn.provider_id) : null;

      if (!conn || !mdl || !prov) continue;
      if (conn.status === 'expired' || conn.status === 'banned' || conn.status === 'unavailable' || locallyExpiredConnectionIds.has(conn.id)) {
        continue;
      }

      const healthRecord = this.healthRepo.get(conn.id);
      const cb = getSharedCircuitBreaker(conn.id, healthRecord, now);

      const isCooldownActive = healthRecord?.cooldown_until != null && now < healthRecord.cooldown_until;

      let quotaRemainingPct = 1.0;
      try {
        const policy = this.quotaRepo.getPolicy(conn.id, 'daily_tokens');
        if (policy) {
          const windowStart = getWindowStart(now, policy.window_seconds);
          const currentUsage = this.quotaRepo.getUsage(conn.id, 'daily_tokens', windowStart);
          const prevUsage = this.quotaRepo.getUsage(conn.id, 'daily_tokens', windowStart - policy.window_seconds * 1000);
          const usage = computeSlidingWindowUsage({ currentUsage, previousUsage: prevUsage, windowSeconds: policy.window_seconds, nowMs: now });
          quotaRemainingPct = Math.max(0, 1 - usage / policy.limit_value);
        }
      } catch (quotaErr: any) {
        logger.warn({ connectionId: conn.id, error: quotaErr.message }, 'Failed to compute quota headroom');
      }

      const taskFitnessMap = safeParseTaskFitness(mdl.task_fitness);

      stepInfos.push({
        id: step.id,
        poolId: step.pool_id,
        orderIndex: step.order_index,
        connectionId: conn.id,
        providerSlug: prov.slug,
        providerBaseUrl: prov.base_url,
        providerProtocol: prov.protocol,
        modelId: mdl.id,
        modelName: mdl.model_name,
        role: step.role,
        weight: step.weight,
        healthState: cb.getState(),
        isCooldownActive,
        quotaRemainingPct,
        benchTtftMs: mdl.bench_ttft_ms || undefined,
        benchP95LatencyMs: mdl.bench_p95_latency_ms || undefined,
        costPer1kUsd: mdl.cost_input_per_1k + mdl.cost_output_per_1k,
        taskFitness: taskFitnessMap.coding_agent || 0.8,
      });
    }

    const policyFn = resolvePolicyFunction(pool.policy);
    const orderedSteps = policyFn(stepInfos);
    const decisionTrace: DecisionTraceEntry[] = [];

    for (const step of orderedSteps) {
      const conn = this.connectionRepo.findById(step.connectionId);
      if (!conn || conn.status === 'expired' || conn.status === 'banned' || conn.status === 'unavailable' || locallyExpiredConnectionIds.has(step.connectionId)) {
        decisionTrace.push({
          stepIndex: step.orderIndex,
          connectionId: step.connectionId,
          providerSlug: step.providerSlug,
          modelId: step.modelId,
          status: 'skipped',
          reason: `Connection status is ${conn?.status || 'expired'}`,
        });
        continue;
      }

      const healthRecord = this.healthRepo.get(conn.id);
      const cb = getSharedCircuitBreaker(conn.id, healthRecord, Date.now());

      if (!cb.allowRequest()) {
        decisionTrace.push({
          stepIndex: step.orderIndex,
          connectionId: step.connectionId,
          providerSlug: step.providerSlug,
          modelId: step.modelId,
          status: 'skipped',
          reason: `Circuit breaker is ${cb.getState()}`,
        });
        continue;
      }

      if (healthRecord?.cooldown_until != null && Date.now() < healthRecord.cooldown_until) {
        decisionTrace.push({
          stepIndex: step.orderIndex,
          connectionId: step.connectionId,
          providerSlug: step.providerSlug,
          modelId: step.modelId,
          status: 'skipped',
          reason: 'Cooldown is active',
        });
        continue;
      }

      let quotaExceeded = false;
      const estimatedTokens = request.max_tokens || 1000;
      try {
        const dailyPolicy = this.quotaRepo.getPolicy(conn.id, 'daily_tokens');
        if (dailyPolicy) {
          const windowStart = getWindowStart(Date.now(), dailyPolicy.window_seconds);
          const currentUsage = this.quotaRepo.getUsage(conn.id, 'daily_tokens', windowStart);
          const prevUsage = this.quotaRepo.getUsage(conn.id, 'daily_tokens', windowStart - dailyPolicy.window_seconds * 1000);

          if (wouldQuotaExceed(dailyPolicy.limit_value, { currentUsage, previousUsage: prevUsage, windowSeconds: dailyPolicy.window_seconds, nowMs: Date.now() }, estimatedTokens)) {
            quotaExceeded = true;
          }
        }
      } catch (quotaErr: any) {
        logger.warn({ connectionId: conn.id, error: quotaErr.message }, 'Quota gate database call failed; failing open');
      }

      if (quotaExceeded) {
        decisionTrace.push({
          stepIndex: step.orderIndex,
          connectionId: step.connectionId,
          providerSlug: step.providerSlug,
          modelId: step.modelId,
          status: 'skipped',
          reason: 'Quota limit would be exceeded',
        });
        continue;
      }

      // Pre-reserve estimated tokens in quota ledger
      let currentWindowStart = Date.now();
      try {
        const dailyPolicy = this.quotaRepo.getPolicy(conn.id, 'daily_tokens');
        const windowSec = dailyPolicy ? dailyPolicy.window_seconds : 86400;
        currentWindowStart = getWindowStart(Date.now(), windowSec);
        this.quotaRepo.recordUsage(conn.id, 'daily_tokens', currentWindowStart, estimatedTokens);
      } catch (recErr: any) {
        logger.warn({ connectionId: conn.id, error: recErr.message }, 'Failed to pre-reserve quota usage');
      }

      try {
        const apiKey = decryptCredential({
          ciphertext: conn.credential_enc,
          iv: conn.credential_iv,
          tag: conn.credential_tag,
        });

        const streamRequest = { ...request, stream: true };
        const translated = translateRequestToProvider(streamRequest, step.providerProtocol, step.modelName);

        const httpRes = await callProviderEndpointStream({
          baseUrl: step.providerBaseUrl,
          endpoint: translated.endpoint,
          apiKey,
          protocol: step.providerProtocol,
          method: 'POST',
          headers: translated.headers,
          body: translated.body,
          timeoutMs: 30000,
          signal,
        });

        decisionTrace.push({
          stepIndex: step.orderIndex,
          connectionId: step.connectionId,
          providerSlug: step.providerSlug,
          modelId: step.modelId,
          status: 'selected',
          latencyMs: httpRes.latencyMs,
          reason: `Successfully served request via ${step.providerSlug}/${step.modelName}`,
        });

        const sseStream = transformToOpenAISSEStream(
          httpRes.stream,
          step.providerProtocol,
          step.modelName,
          (usage) => {
            try {
              const deltaTokens = usage.totalTokens - estimatedTokens;
              if (deltaTokens !== 0) {
                this.quotaRepo.recordUsage(conn.id, 'daily_tokens', currentWindowStart, deltaTokens);
              }
              this.quotaRepo.recordUsage(conn.id, 'daily_requests', currentWindowStart, 1);
            } catch (recErr: any) {
              logger.warn({ connectionId: conn.id, error: recErr.message }, 'Failed to record quota usage');
            }

            this.logRepo.log({
              pool_id: poolId,
              connection_id: conn.id,
              model_id: step.modelId,
              status: 'success',
              latency_ms: httpRes.latencyMs,
              tokens_in: usage.promptTokens,
              tokens_out: usage.completionTokens,
              cost_usd: 0,
              error_code: null,
              decision_trace: JSON.stringify(decisionTrace),
            });
          },
          () => {
            cb.recordSuccess();
            const snapshot = cb.getSnapshot();
            this.healthRepo.upsert({
              connection_id: conn.id,
              state: snapshot.state,
              consecutive_failures: snapshot.consecutiveFailures,
              opened_at: snapshot.openedAt,
              cooldown_until: null,
            });
          },
          (err) => {
            try {
              this.quotaRepo.recordUsage(conn.id, 'daily_tokens', currentWindowStart, -estimatedTokens);
            } catch {}
            const prov = this.providerRepo.findById(conn.provider_id);
            const authType = prov?.auth_type || 'api_key';
            cb.recordFailure();
            const snapshot = cb.getSnapshot();
            const cooldownDuration = calculateCooldownMs(authType, snapshot.consecutiveFailures - 1);
            const cooldownUntil = Date.now() + cooldownDuration;

            this.healthRepo.upsert({
              connection_id: conn.id,
              state: snapshot.state,
              consecutive_failures: snapshot.consecutiveFailures,
              opened_at: snapshot.openedAt,
              cooldown_until: cooldownUntil,
            });
          }
        );

        return {
          stream: sseStream,
          decisionTrace,
          selectedStep: step,
          latencyMs: httpRes.latencyMs,
        };
      } catch (err: any) {
        try {
          this.quotaRepo.recordUsage(conn.id, 'daily_tokens', currentWindowStart, -estimatedTokens);
        } catch {}
        const statusCode = err.statusCode;
        const prov = this.providerRepo.findById(conn.provider_id);
        const authType = prov?.auth_type || 'api_key';

        const isHtmlWaf = /type=HTML/i.test(err.message || '') || /<html>/i.test(err.message || '');
        const isTerminalAuth = statusCode === 401 || (statusCode === 403 && !isHtmlWaf);

        if (isTerminalAuth) {
          locallyExpiredConnectionIds.add(conn.id);
          this.connectionRepo.updateStatus(conn.id, 'expired', err.message);
          decisionTrace.push({
            stepIndex: step.orderIndex,
            connectionId: step.connectionId,
            providerSlug: step.providerSlug,
            modelId: step.modelId,
            status: 'attempted_failed',
            error: err.message,
            reason: 'CREDENTIAL_EXPIRED',
          });
          logger.warn({ connectionId: conn.id, error: err.message }, 'Credential expired (401/403), connection status updated to expired');
          continue;
        }

        const isBreakerEligible = statusCode === undefined || [403, 408, 429, 500, 502, 503, 504].includes(statusCode);

        if (isBreakerEligible) {
          cb.recordFailure();
          const snapshot = cb.getSnapshot();
          const cooldownDuration = calculateCooldownMs(authType, snapshot.consecutiveFailures - 1, err.retryAfterSeconds);
          const cooldownUntil = Date.now() + cooldownDuration;

          this.healthRepo.upsert({
            connection_id: conn.id,
            state: snapshot.state,
            consecutive_failures: snapshot.consecutiveFailures,
            opened_at: snapshot.openedAt,
            cooldown_until: cooldownUntil,
          });
        }

        decisionTrace.push({
          stepIndex: step.orderIndex,
          connectionId: step.connectionId,
          providerSlug: step.providerSlug,
          modelId: step.modelId,
          status: 'attempted_failed',
          error: err.message,
        });

        logger.warn({ connectionId: conn.id, error: err.message }, 'Target stream dispatch failed, falling back to next step');
      }
    }

    this.logRepo.log({
      pool_id: poolId,
      connection_id: null,
      model_id: null,
      status: 'failed',
      latency_ms: 0,
      tokens_in: 0,
      tokens_out: 0,
      cost_usd: 0,
      error_code: 'ALL_TARGETS_EXHAUSTED',
      decision_trace: JSON.stringify(decisionTrace),
    });

    throw new AllTargetsExhaustedError(decisionTrace);
  }
}
