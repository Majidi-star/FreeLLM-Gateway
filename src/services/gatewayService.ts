import { PoolRepository } from '../infra/db/repositories/poolRepo.js';
import { ConnectionRepository } from '../infra/db/repositories/connectionRepo.js';
import { ModelRepository } from '../infra/db/repositories/modelRepo.js';
import { ProviderRepository } from '../infra/db/repositories/providerRepo.js';
import { HealthRepository } from '../infra/db/repositories/healthRepo.js';
import { QuotaRepository } from '../infra/db/repositories/quotaRepo.js';
import { RequestLogRepository } from '../infra/db/repositories/requestLogRepo.js';
import { CircuitBreaker } from '../domain/resilience/circuitBreaker.js';
import { CooldownTracker } from '../domain/resilience/cooldown.js';
import { computeSlidingWindowUsage, wouldQuotaExceed } from '../domain/quota/slidingWindow.js';
import { resolvePolicyFunction } from '../domain/routing/policySelector.js';
import { translateRequestToProvider } from '../domain/translation/openaiToProvider.js';
import { translateResponseToOpenAI } from '../domain/translation/providerToOpenai.js';
import { OpenAIChatRequest, OpenAIChatResponse } from '../domain/translation/types.js';
import { callProviderEndpoint } from '../infra/http/providerClient.js';
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

      // Health state
      const healthRecord = this.healthRepo.get(conn.id);
      const cb = new CircuitBreaker(
        { failureThreshold: 5 },
        { now: () => now },
        healthRecord ? { state: healthRecord.state, consecutiveFailures: healthRecord.consecutive_failures, openedAt: healthRecord.opened_at } : undefined
      );

      // Cooldown state
      const cooldownTracker = new CooldownTracker(prov.auth_type);

      // Quota headroom estimate
      const policy = this.quotaRepo.getPolicy(conn.id, 'daily_tokens');
      let quotaRemainingPct = 1.0;
      if (policy) {
        const windowStart = Math.floor(now / (policy.window_seconds * 1000)) * (policy.window_seconds * 1000);
        const currentUsage = this.quotaRepo.getUsage(conn.id, 'daily_tokens', windowStart);
        const prevUsage = this.quotaRepo.getUsage(conn.id, 'daily_tokens', windowStart - policy.window_seconds * 1000);
        const usage = computeSlidingWindowUsage({ currentUsage, previousUsage: prevUsage, windowSeconds: policy.window_seconds, nowMs: now });
        quotaRemainingPct = Math.max(0, 1 - usage / policy.limit_value);
      }

      const taskFitnessMap = JSON.parse(mdl.task_fitness || '{}');

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
        isCooldownActive: cooldownTracker.isActive(now),
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
      const conn = this.connectionRepo.findById(step.connectionId)!;

      // 1. Circuit Breaker Gate
      const healthRecord = this.healthRepo.get(conn.id);
      const cb = new CircuitBreaker(
        { failureThreshold: 5 },
        { now: () => Date.now() },
        healthRecord ? { state: healthRecord.state, consecutiveFailures: healthRecord.consecutive_failures, openedAt: healthRecord.opened_at } : undefined
      );

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

      // 2. Quota Gate
      const dailyPolicy = this.quotaRepo.getPolicy(conn.id, 'daily_tokens');
      if (dailyPolicy) {
        const estimatedTokens = request.max_tokens || 1000;
        const windowStart = Math.floor(Date.now() / (dailyPolicy.window_seconds * 1000)) * (dailyPolicy.window_seconds * 1000);
        const currentUsage = this.quotaRepo.getUsage(conn.id, 'daily_tokens', windowStart);
        const prevUsage = this.quotaRepo.getUsage(conn.id, 'daily_tokens', windowStart - dailyPolicy.window_seconds * 1000);

        if (wouldQuotaExceed(dailyPolicy.limit_value, { currentUsage, previousUsage: prevUsage, windowSeconds: dailyPolicy.window_seconds, nowMs: Date.now() }, estimatedTokens)) {
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

        // Record Quota Usage
        const tokensUsed = oaiResponse.usage?.total_tokens || 500;
        const currentWindowStart = Math.floor(Date.now() / (86400 * 1000)) * (86400 * 1000);
        this.quotaRepo.recordUsage(conn.id, 'daily_tokens', currentWindowStart, tokensUsed);
        this.quotaRepo.recordUsage(conn.id, 'daily_requests', currentWindowStart, 1);

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
        cb.recordFailure();
        const snapshot = cb.getSnapshot();
        this.healthRepo.upsert({
          connection_id: conn.id,
          state: snapshot.state,
          consecutive_failures: snapshot.consecutiveFailures,
          opened_at: snapshot.openedAt,
          cooldown_until: null,
        });

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
}
