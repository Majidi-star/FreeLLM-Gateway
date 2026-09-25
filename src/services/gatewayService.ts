import { EventEmitter } from 'events';
import { PoolRepository } from '../infra/db/repositories/poolRepo.js';
import { ConnectionRepository } from '../infra/db/repositories/connectionRepo.js';
import { ModelRepository } from '../infra/db/repositories/modelRepo.js';
import { ProviderRepository } from '../infra/db/repositories/providerRepo.js';
import { HealthRepository } from '../infra/db/repositories/healthRepo.js';
import { QuotaRepository } from '../infra/db/repositories/quotaRepo.js';
import { RequestLogRepository } from '../infra/db/repositories/requestLogRepo.js';
import { GoalRepository } from '../infra/db/repositories/goalRepo.js';
import { UsageRepository } from '../infra/db/repositories/usageRepo.js';
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
import { generateId } from '../shared/ids.js';
import { AllTargetsExhaustedError, NotFoundError } from '../shared/errors.js';
import { DecisionTraceEntry } from '../shared/types.js';
import { PoolStepInfo } from '../domain/routing/types.js';
import { logger, redactSensitiveData } from '../infra/logger.js';
import { computeCostUsd, estimateTokens } from '../domain/pricing/costCalculator.js';

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

export type DispatchCtx = {
  accountId: string | null;
  apiKeyId: string | null;
  protocol: 'openai' | 'anthropic' | 'mcp' | 'native';
  clientName?: string;
};

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

export const inFlightConnectionRequests = new Map<string, number>();

export function getInFlightCount(connectionId: string): number {
  return inFlightConnectionRequests.get(connectionId) || 0;
}

export function incrementInFlight(connectionId: string): void {
  inFlightConnectionRequests.set(connectionId, (inFlightConnectionRequests.get(connectionId) || 0) + 1);
}

export function decrementInFlight(connectionId: string): void {
  const current = inFlightConnectionRequests.get(connectionId) || 0;
  if (current <= 1) {
    inFlightConnectionRequests.delete(connectionId);
  } else {
    inFlightConnectionRequests.set(connectionId, current - 1);
  }
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

export function isConnectionActive(conn: { status: string; id: string } | null): boolean {
  if (!conn) return false;
  if (['expired', 'revoked', 'deleted', 'banned', 'unavailable'].includes(conn.status)) {
    return false;
  }
  if (conn.status !== 'active' && conn.status !== 'healthy' && conn.status !== 'untested') {
    return false;
  }
  if (locallyExpiredConnectionIds.has(conn.id)) {
    return false;
  }
  return true;
}

export function safeParseTaskFitness(raw?: string | null): Record<string, number> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

export class GatewayService extends EventEmitter {
  private lastLogTimestamp = 0;

  constructor(
    private poolRepo: PoolRepository,
    private connectionRepo: ConnectionRepository,
    private modelRepo: ModelRepository,
    private providerRepo: ProviderRepository,
    private healthRepo: HealthRepository,
    private quotaRepo: QuotaRepository,
    private logRepo: RequestLogRepository,
    private usageRepo: UsageRepository,
    private goalRepo?: GoalRepository
  ) {
    super();
  }

  private emitLogEvent(payload: {
    traceId: string;
    timestamp: number;
    clientName: string;
    provider: string;
    model: string;
    tokens: { prompt: number; completion: number; total: number };
    latencyMs: number;
    isFallback: boolean;
    candidateTrace: DecisionTraceEntry[];
    accountId: string | null;
    apiKeyId: string | null;
    costUsd: number;
    ttftMs: number | null;
  }) {
    const timestamp = Math.max(Date.now(), this.lastLogTimestamp + 1);
    this.lastLogTimestamp = timestamp;
    this.emit('log', { ...payload, timestamp });
  }

  /**
   * Records the outcome of a dispatch to the request log and usage rollups.
   * This method must never throw into the request path — any failure is logged and swallowed.
   * Dropping a metric must not fail a served request.
   */
  private recordOutcome(fact: {
    poolId: string;
    connectionId: string | null;
    modelId: string | null;
    providerSlug: string | null;
    modelName: string | null;
    status: 'success' | 'failed' | 'timeout';
    latencyMs: number;
    ttftMs: number | null;
    tokensIn: number;
    tokensOut: number;
    tokensCached: number;
    tokensReasoning: number;
    errorCode: string | null;
    finishReason: string | null;
    decisionTrace: DecisionTraceEntry[];
    attemptCount: number;
    fallbackUsed: boolean;
    isStream: boolean;
    traceId: string;
    clientName: string;
    ctx: DispatchCtx;
  }): void {
    let costUsd = 0;
    try {
      const db = this.logRepo['db'] as any; // Access the database from the logRepo
      // Look up the model for pricing
      const modelRecord = fact.modelId ? this.modelRepo.findById(fact.modelId) : null;
      costUsd = modelRecord
        ? computeCostUsd(
            { cost_input_per_1k: modelRecord.cost_input_per_1k, cost_output_per_1k: modelRecord.cost_output_per_1k },
            fact.tokensIn,
            fact.tokensOut
          )
        : 0;

      const transaction = db.transaction(() => {
        // Log to request_logs
        this.logRepo.log({
          pool_id: fact.poolId,
          connection_id: fact.connectionId,
          model_id: fact.modelId,
          status: fact.status,
          latency_ms: fact.latencyMs,
          tokens_in: fact.tokensIn,
          tokens_out: fact.tokensOut,
          cost_usd: costUsd,
          error_code: fact.errorCode,
          decision_trace: JSON.stringify(redactSensitiveData(fact.decisionTrace)),
          account_id: fact.ctx.accountId,
          api_key_id: fact.ctx.apiKeyId,
          provider_slug: fact.providerSlug,
          model_name: fact.modelName,
          route_protocol: fact.ctx.protocol,
          is_stream: fact.isStream ? 'true' : 'false',
          client_name: fact.clientName,
          trace_id: fact.traceId,
          ttft_ms: fact.ttftMs,
          attempt_count: fact.attemptCount,
          fallback_used: fact.fallbackUsed ? 1 : 0,
          tokens_cached: fact.tokensCached,
          tokens_reasoning: fact.tokensReasoning,
        });

        // Record to usage rollups
        this.usageRepo.record({
          at: Date.now(),
          accountId: fact.ctx.accountId,
          apiKeyId: fact.ctx.apiKeyId,
          poolId: fact.poolId,
          providerSlug: fact.providerSlug,
          modelName: fact.modelName,
          status: fact.status,
          tokensIn: fact.tokensIn,
          tokensOut: fact.tokensOut,
          tokensCached: fact.tokensCached,
          tokensReasoning: fact.tokensReasoning,
          costUsd,
          latencyMs: fact.latencyMs,
          ttftMs: fact.ttftMs,
          fallbackUsed: fact.fallbackUsed,
        });
      });
      transaction();
    } catch (err) {
      logger.error({ err }, 'telemetry write failed');
    }

    // Emit the log event for SSE listeners (UI)
    this.emitLogEvent({
      traceId: fact.traceId,
      timestamp: Date.now(),
      clientName: fact.clientName,
      provider: fact.providerSlug ?? 'unknown',
      model: fact.modelName ?? 'unknown',
      tokens: {
        prompt: fact.tokensIn,
        completion: fact.tokensOut,
        total: fact.tokensIn + fact.tokensOut,
      },
      latencyMs: fact.latencyMs,
      isFallback: fact.fallbackUsed,
      candidateTrace: fact.decisionTrace,
      accountId: fact.ctx.accountId,
      apiKeyId: fact.ctx.apiKeyId,
      costUsd: costUsd,
      ttftMs: fact.ttftMs,
    });
  }

  public async dispatch(poolId: string, request: OpenAIChatRequest, signal?: AbortSignal, ctx?: DispatchCtx): Promise<DispatchResult> {
    const traceId = (request as any).traceId || generateId('tr');
    const clientName = ctx?.clientName ?? ((request as any).user || 'GoalRoute Client');

    const pool = this.poolRepo.findPoolById(poolId);
    if (!pool || !pool.is_active) {
      throw new NotFoundError(`Active pool with ID '${poolId}' not found`);
    }

    const goalRecord = pool.goal_id && this.goalRepo ? this.goalRepo.findById(pool.goal_id) : null;
    const taskType = goalRecord?.task_type || 'general';

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
      if (!isConnectionActive(conn)) {
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
      const fitness = taskFitnessMap[taskType] ?? taskFitnessMap.general ?? taskFitnessMap.coding_agent ?? 0.8;

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
        taskFitness: fitness,
      });
    }

    const policyFn = resolvePolicyFunction(pool.policy);
    const orderedSteps = policyFn(stepInfos);
    const decisionTrace: DecisionTraceEntry[] = [];

    for (const step of orderedSteps) {
      const conn = this.connectionRepo.findById(step.connectionId);
      if (!conn || !isConnectionActive(conn)) {
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
        cb.releaseProbe();
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

      // 3. Dual Quota Gate (Atomic Reservation for Tokens & Requests)
      let hasReservedTokens = false;
      let hasReservedRequests = false;
      let quotaExceeded = false;
      const estimatedTokens = request.max_tokens || 1000;

      let dailyTokenPolicy: any = null;
      let dailyReqPolicy: any = null;
      let tokenWindowStart = Date.now();
      let reqWindowStart = Date.now();

      try {
        dailyTokenPolicy = this.quotaRepo.getPolicy(conn.id, 'daily_tokens');
        dailyReqPolicy = this.quotaRepo.getPolicy(conn.id, 'daily_requests');

        if (dailyTokenPolicy) {
          tokenWindowStart = getWindowStart(Date.now(), dailyTokenPolicy.window_seconds);
          const reserved = this.quotaRepo.reserveQuota(
            conn.id,
            'daily_tokens',
            tokenWindowStart,
            estimatedTokens,
            dailyTokenPolicy.limit_value
          );
          if (!reserved) {
            quotaExceeded = true;
          } else {
            hasReservedTokens = true;
          }
        }

        if (!quotaExceeded && dailyReqPolicy) {
          reqWindowStart = getWindowStart(Date.now(), dailyReqPolicy.window_seconds);
          const reserved = this.quotaRepo.reserveQuota(
            conn.id,
            'daily_requests',
            reqWindowStart,
            1,
            dailyReqPolicy.limit_value
          );
          if (!reserved) {
            quotaExceeded = true;
            if (hasReservedTokens && dailyTokenPolicy) {
              try {
                this.quotaRepo.recordUsage(conn.id, 'daily_tokens', tokenWindowStart, -estimatedTokens);
              } catch {}
              hasReservedTokens = false;
            }
          } else {
            hasReservedRequests = true;
          }
        }
      } catch (quotaErr: any) {
        logger.warn({ connectionId: conn.id, error: quotaErr.message }, 'Quota gate database call failed; failing open');
      }

      if (quotaExceeded) {
        cb.releaseProbe();
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

      // 4. Dispatch Attempt
      try {
        const apiKey = decryptCredential({
          ciphertext: conn.credential_enc,
          iv: conn.credential_iv,
          tag: conn.credential_tag,
        });

        const translated = translateRequestToProvider(request, step.providerProtocol, step.modelName);

        incrementInFlight(conn.id);
        let httpRes: any;
        try {
          httpRes = await callProviderEndpoint({
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
        } finally {
          decrementInFlight(conn.id);
        }

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
          if (hasReservedTokens && dailyTokenPolicy && deltaTokens !== 0) {
            this.quotaRepo.recordUsage(conn.id, 'daily_tokens', tokenWindowStart, deltaTokens);
          }
          if (!hasReservedRequests && dailyReqPolicy) {
            this.quotaRepo.recordUsage(conn.id, 'daily_requests', reqWindowStart, 1);
          }
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

        const promptTokens = oaiResponse.usage?.prompt_tokens || 0;
        const completionTokens = oaiResponse.usage?.completion_tokens || 0;
        const attemptCount = decisionTrace.filter((t) => t.status !== 'skipped').length;
        const fallbackUsed = decisionTrace.some((t) => t.status === 'attempted_failed');
        const defaultCtx: DispatchCtx = { accountId: null, apiKeyId: null, protocol: 'openai', clientName };
        const ctxToUse = ctx ?? defaultCtx;

        this.recordOutcome({
          poolId,
          connectionId: conn.id,
          modelId: step.modelId,
          providerSlug: step.providerSlug,
          modelName: step.modelName,
          status: 'success',
          latencyMs: httpRes.latencyMs,
          ttftMs: null,
          tokensIn: promptTokens,
          tokensOut: completionTokens,
          tokensCached: 0,
          tokensReasoning: 0,
          errorCode: null,
          finishReason: oaiResponse.choices?.[0]?.finish_reason ?? null,
          decisionTrace,
          attemptCount,
          fallbackUsed,
          isStream: false,
          traceId,
          clientName,
          ctx: ctxToUse,
        });

        return {
          response: oaiResponse,
          decisionTrace,
          selectedStep: step,
          latencyMs: httpRes.latencyMs,
        };
      } catch (err: any) {
        // Refund pre-reserved quotas on dispatch failure
        if (hasReservedTokens && dailyTokenPolicy) {
          try {
            this.quotaRepo.recordUsage(conn.id, 'daily_tokens', tokenWindowStart, -estimatedTokens);
          } catch (refundErr: any) {
            logger.warn({ connectionId: conn.id, error: refundErr.message }, 'Failed to refund pre-reserved token quota');
          }
        }
        if (hasReservedRequests && dailyReqPolicy) {
          try {
            this.quotaRepo.recordUsage(conn.id, 'daily_requests', reqWindowStart, -1);
          } catch (refundErr: any) {
            logger.warn({ connectionId: conn.id, error: refundErr.message }, 'Failed to refund pre-reserved request quota');
          }
        }

        const statusCode = err.statusCode;
        const prov = this.providerRepo.findById(conn.provider_id);
        const authType = prov?.auth_type || 'api_key';

        const isHtmlWaf = /type=HTML/i.test(err.message || '') || /<html>/i.test(err.message || '');
        const isTerminalAuth = statusCode === 401 || (statusCode === 403 && !isHtmlWaf);

        if (isTerminalAuth) {
          cb.releaseProbe();
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
          this.emitLogEvent({
            traceId,
            timestamp: Date.now(),
            clientName,
            provider: step.providerSlug,
            model: step.modelName,
            tokens: { prompt: 0, completion: 0, total: 0 },
            latencyMs: 0,
            isFallback: true,
            candidateTrace: [...decisionTrace],
            accountId: ctx?.accountId ?? null,
            apiKeyId: ctx?.apiKeyId ?? null,
            costUsd: 0,
            ttftMs: null,
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
        } else {
          cb.releaseProbe();
        }

        decisionTrace.push({
          stepIndex: step.orderIndex,
          connectionId: step.connectionId,
          providerSlug: step.providerSlug,
          modelId: step.modelId,
          status: 'attempted_failed',
          error: err.message,
        });

        this.emitLogEvent({
          traceId,
          timestamp: Date.now(),
          clientName,
          provider: step.providerSlug,
          model: step.modelName,
          tokens: { prompt: 0, completion: 0, total: 0 },
          latencyMs: 0,
          isFallback: true,
          candidateTrace: [...decisionTrace],
          accountId: ctx?.accountId ?? null,
          apiKeyId: ctx?.apiKeyId ?? null,
          costUsd: 0,
          ttftMs: null,
        });

        logger.warn({ connectionId: conn.id, error: err.message }, 'Target dispatch failed, falling back to next step');
      }
    }

    // All steps exhausted
    const attemptCount = decisionTrace.filter((t) => t.status !== 'skipped').length;
    const fallbackUsed = decisionTrace.some((t) => t.status === 'attempted_failed');
    const defaultCtx: DispatchCtx = { accountId: null, apiKeyId: null, protocol: 'openai', clientName };
    const ctxToUse = ctx ?? defaultCtx;

    this.recordOutcome({
      poolId,
      connectionId: null,
      modelId: null,
      providerSlug: null,
      modelName: null,
      status: 'failed',
      latencyMs: 0,
      ttftMs: null,
      tokensIn: 0,
      tokensOut: 0,
      tokensCached: 0,
      tokensReasoning: 0,
      errorCode: 'ALL_TARGETS_EXHAUSTED',
      finishReason: null,
      decisionTrace,
      attemptCount,
      fallbackUsed,
      isStream: false,
      traceId,
      clientName,
      ctx: ctxToUse,
    });

    throw new AllTargetsExhaustedError(decisionTrace);
  }

  public async dispatchStream(poolId: string, request: OpenAIChatRequest, signal?: AbortSignal, ctx?: DispatchCtx): Promise<DispatchStreamResult> {
    const traceId = (request as any).traceId || generateId('tr');
    const clientName = ctx?.clientName ?? ((request as any).user || 'GoalRoute Client');

    const pool = this.poolRepo.findPoolById(poolId);
    if (!pool || !pool.is_active) {
      throw new NotFoundError(`Active pool with ID '${poolId}' not found`);
    }

    const goalRecord = pool.goal_id && this.goalRepo ? this.goalRepo.findById(pool.goal_id) : null;
    const taskType = goalRecord?.task_type || 'general';

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
      if (!isConnectionActive(conn)) {
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
      const fitness = taskFitnessMap[taskType] ?? taskFitnessMap.general ?? taskFitnessMap.coding_agent ?? 0.8;

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
        taskFitness: fitness,
      });
    }

    const policyFn = resolvePolicyFunction(pool.policy);
    const orderedSteps = policyFn(stepInfos);
    const decisionTrace: DecisionTraceEntry[] = [];

    for (const step of orderedSteps) {
      const conn = this.connectionRepo.findById(step.connectionId);
      if (!conn || !isConnectionActive(conn)) {
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
        cb.releaseProbe();
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

      // Dual Quota Gate (Atomic Reservation for Tokens & Requests)
      let hasReservedTokens = false;
      let hasReservedRequests = false;
      let quotaExceeded = false;
      const estimatedTokens = request.max_tokens || 1000;

      const dailyTokenPolicy = this.quotaRepo.getPolicy(conn.id, 'daily_tokens');
      const dailyReqPolicy = this.quotaRepo.getPolicy(conn.id, 'daily_requests');

      const tokenWindowStart = dailyTokenPolicy ? getWindowStart(Date.now(), dailyTokenPolicy.window_seconds) : Date.now();
      const reqWindowStart = dailyReqPolicy ? getWindowStart(Date.now(), dailyReqPolicy.window_seconds) : Date.now();

      try {
        if (dailyTokenPolicy) {
          const reserved = this.quotaRepo.reserveQuota(
            conn.id,
            'daily_tokens',
            tokenWindowStart,
            estimatedTokens,
            dailyTokenPolicy.limit_value
          );
          if (!reserved) {
            quotaExceeded = true;
          } else {
            hasReservedTokens = true;
          }
        }

        if (!quotaExceeded && dailyReqPolicy) {
          const reserved = this.quotaRepo.reserveQuota(
            conn.id,
            'daily_requests',
            reqWindowStart,
            1,
            dailyReqPolicy.limit_value
          );
          if (!reserved) {
            quotaExceeded = true;
            if (hasReservedTokens && dailyTokenPolicy) {
              try {
                this.quotaRepo.recordUsage(conn.id, 'daily_tokens', tokenWindowStart, -estimatedTokens);
              } catch {}
              hasReservedTokens = false;
            }
          } else {
            hasReservedRequests = true;
          }
        }
      } catch (quotaErr: any) {
        logger.warn({ connectionId: conn.id, error: quotaErr.message }, 'Quota gate database call failed; failing open');
      }

      if (quotaExceeded) {
        cb.releaseProbe();
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

      let quotaSettled = false;
      const settleStreamQuota = (actualTokens?: number, isSuccess: boolean = true) => {
        if (quotaSettled) return;
        quotaSettled = true;

        if (isSuccess) {
          const finalTokens = actualTokens ?? estimatedTokens;
          const deltaTokens = finalTokens - estimatedTokens;
          if (hasReservedTokens && dailyTokenPolicy && deltaTokens !== 0) {
            try { this.quotaRepo.recordUsage(conn.id, 'daily_tokens', tokenWindowStart, deltaTokens); } catch {}
          }
        } else {
          if (hasReservedTokens && dailyTokenPolicy) {
            try { this.quotaRepo.recordUsage(conn.id, 'daily_tokens', tokenWindowStart, -estimatedTokens); } catch {}
          }
          if (hasReservedRequests && dailyReqPolicy) {
            try { this.quotaRepo.recordUsage(conn.id, 'daily_requests', reqWindowStart, -1); } catch {}
          }
        }
      };

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

        // Variables for streaming telemetry
        let ttftMs: number | null = null;
        let accumulatedText = '';
        let promptTokens = 0;
        let completionTokens = 0;
        let usageReceived = false;
        const streamStartTime = Date.now();
        const MAX_ACCUMULATED_TEXT = 256 * 1024; // 256KB cap

        const sseStream = transformToOpenAISSEStream(
          httpRes.stream,
          step.providerProtocol,
          step.modelName,
          (usage) => {
            // Provider reported usage — capture it for recordOutcome
            usageReceived = true;
            promptTokens = usage.promptTokens;
            completionTokens = usage.completionTokens;
            try {
              settleStreamQuota(usage.totalTokens, true);
            } catch (recErr: any) {
              logger.warn({ connectionId: conn.id, error: recErr.message }, 'Failed to record quota usage');
            }
          },
          () => {
            // Stream completed successfully
            settleStreamQuota(estimatedTokens, true);
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
            // Stream errored
            settleStreamQuota(undefined, false);
            if (signal?.aborted) {
              cb.releaseProbe();
              return;
            }
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

        // Wrap the stream in a generator that captures TTFT, accumulates text for fallback,
        // and calls recordOutcome in the finally block.
        const self = this;
        const wrappedStream = (async function* () {
          try {
            for await (const chunk of sseStream) {
              // Capture TTFT on first chunk
              if (ttftMs === null) {
                ttftMs = Date.now() - streamStartTime;
              }
              // Accumulate text content for fallback token estimation (cap at 256KB)
              try {
                const dataLines = chunk.split('\n');
                for (const line of dataLines) {
                  if (line.startsWith('data: ') && line !== 'data: [DONE]') {
                    const jsonStr = line.slice(6);
                    const data = JSON.parse(jsonStr);
                    if (data.choices?.[0]?.delta?.content) {
                      const content = data.choices[0].delta.content;
                      if (accumulatedText.length + content.length <= MAX_ACCUMULATED_TEXT) {
                        accumulatedText += content;
                      }
                    }
                  }
                }
              } catch {
                // Ignore parse errors in telemetry accumulation
              }
              yield chunk;
            }
          } finally {
            // Determine tokens: use provider usage if received, else estimate from accumulated text
            let finalTokensIn = promptTokens;
            let finalTokensOut = completionTokens;
            let finishReason: string | null = null;
            let estimated = false;

            if (!usageReceived) {
              estimated = true;
              // Estimate from request messages (prompt) and accumulated text (completion)
              const promptChars = (request.messages || []).reduce(
                (acc, m) => acc + (typeof m.content === 'string' ? m.content.length : 0),
                0
              );
              finalTokensIn = Math.ceil(promptChars / 4);
              finalTokensOut = estimateTokens(accumulatedText);
              finishReason = 'stop|estimated';
            }

            const attemptCount = decisionTrace.filter((t) => t.status !== 'skipped').length;
            const fallbackUsed = decisionTrace.some((t) => t.status === 'attempted_failed');
            const defaultCtx: DispatchCtx = { accountId: null, apiKeyId: null, protocol: 'openai', clientName };
            const ctxToUse = ctx ?? defaultCtx;

            self.recordOutcome({
              poolId,
              connectionId: conn.id,
              modelId: step.modelId,
              providerSlug: step.providerSlug,
              modelName: step.modelName,
              status: 'success',
              latencyMs: httpRes.latencyMs,
              ttftMs,
              tokensIn: finalTokensIn,
              tokensOut: finalTokensOut,
              tokensCached: 0,
              tokensReasoning: 0,
              errorCode: null,
              finishReason,
              decisionTrace,
              attemptCount,
              fallbackUsed,
              isStream: true,
              traceId,
              clientName,
              ctx: ctxToUse,
            });
          }
        })();

        return {
          stream: wrappedStream,
          decisionTrace,
          selectedStep: step,
          latencyMs: httpRes.latencyMs,
        };
      } catch (err: any) {
        settleStreamQuota(undefined, false);
        const statusCode = err.statusCode;
        const prov = this.providerRepo.findById(conn.provider_id);
        const authType = prov?.auth_type || 'api_key';

        const isHtmlWaf = /type=HTML/i.test(err.message || '') || /<html>/i.test(err.message || '');
        const isTerminalAuth = statusCode === 401 || (statusCode === 403 && !isHtmlWaf);

        if (isTerminalAuth) {
          cb.releaseProbe();
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
          this.emitLogEvent({
            traceId,
            timestamp: Date.now(),
            clientName,
            provider: step.providerSlug,
            model: step.modelName,
            tokens: { prompt: 0, completion: 0, total: 0 },
            latencyMs: 0,
            isFallback: true,
            candidateTrace: [...decisionTrace],
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
        } else {
          cb.releaseProbe();
        }

        decisionTrace.push({
          stepIndex: step.orderIndex,
          connectionId: step.connectionId,
          providerSlug: step.providerSlug,
          modelId: step.modelId,
          status: 'attempted_failed',
          error: err.message,
        });

        this.emitLogEvent({
          traceId,
          timestamp: Date.now(),
          clientName,
          provider: step.providerSlug,
          model: step.modelName,
          tokens: { prompt: 0, completion: 0, total: 0 },
          latencyMs: 0,
          isFallback: true,
          candidateTrace: [...decisionTrace],
        });

        logger.warn({ connectionId: conn.id, error: err.message }, 'Target stream dispatch failed, falling back to next step');
      }
    }

    // All steps exhausted (streaming)
    const attemptCount = decisionTrace.filter((t) => t.status !== 'skipped').length;
    const fallbackUsed = decisionTrace.some((t) => t.status === 'attempted_failed');
    const defaultCtx: DispatchCtx = { accountId: null, apiKeyId: null, protocol: 'openai', clientName };
    const ctxToUse = ctx ?? defaultCtx;

    this.recordOutcome({
      poolId,
      connectionId: null,
      modelId: null,
      providerSlug: null,
      modelName: null,
      status: 'failed',
      latencyMs: 0,
      ttftMs: null,
      tokensIn: 0,
      tokensOut: 0,
      tokensCached: 0,
      tokensReasoning: 0,
      errorCode: 'ALL_TARGETS_EXHAUSTED',
      finishReason: null,
      decisionTrace,
      attemptCount,
      fallbackUsed,
      isStream: true,
      traceId,
      clientName,
      ctx: ctxToUse,
    });

    throw new AllTargetsExhaustedError(decisionTrace);
  }
}
