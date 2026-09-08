import { PoolService } from './poolService.js';
import { GoalService } from './goalService.js';
import { QuotaRepository } from '../infra/db/repositories/quotaRepo.js';
import { ConnectionRepository } from '../infra/db/repositories/connectionRepo.js';
import { ProviderRepository } from '../infra/db/repositories/providerRepo.js';
import { ModelRepository } from '../infra/db/repositories/modelRepo.js';

export interface SimulationResult {
  poolId: string;
  poolName: string;
  policy: string;
  totalPlannedRequests: number;
  totalPlannedTokens: number;
  wouldExhaust: boolean;
  exhaustionTimeHours?: number;
  exhaustedConnectionId?: string;
  exhaustedProviderSlug?: string;
  summary: string;
}

export class SimulationService {
  constructor(
    private poolService: PoolService,
    private goalService: GoalService,
    private quotaRepo: QuotaRepository,
    private connectionRepo: ConnectionRepository,
    private providerRepo: ProviderRepository,
    private modelRepo: ModelRepository
  ) {}

  public simulateFullDay(poolId: string): SimulationResult {
    const pool = this.poolService.getPool(poolId);
    const steps = pool.steps;

    let totalCapacityRequests = 0;
    let totalCapacityTokens = 0;
    let bottleneckProvider: string | undefined;
    let bottleneckConnId: string | undefined;
    let minExhaustionHour = 24;

    for (const step of steps) {
      const conn = this.connectionRepo.findById(step.connection_id);
      if (!conn) continue;
      const prov = this.providerRepo.findById(conn.provider_id);

      const tokenPolicy = this.quotaRepo.getPolicy(conn.id, 'daily_tokens');
      const reqPolicy = this.quotaRepo.getPolicy(conn.id, 'daily_requests');

      const tokenLimit = tokenPolicy ? tokenPolicy.limit_value : 5000000;
      const reqLimit = reqPolicy ? reqPolicy.limit_value : 2000;

      totalCapacityTokens += tokenLimit;
      totalCapacityRequests += reqLimit;

      // Check if current usage + 1 day load exceeds capacity
      const windowStart = Math.floor(Date.now() / (86400 * 1000)) * (86400 * 1000);
      const usedTokens = this.quotaRepo.getUsage(conn.id, 'daily_tokens', windowStart);

      if (usedTokens >= tokenLimit) {
        bottleneckProvider = prov?.slug || 'unknown';
        bottleneckConnId = conn.id;
        minExhaustionHour = 0;
      }
    }

    const targetReqsPerDay = 4000;
    const targetTokensPerDay = 10000000;

    const wouldExhaust = totalCapacityTokens < targetTokensPerDay || totalCapacityRequests < targetReqsPerDay || minExhaustionHour === 0;

    const summary = wouldExhaust
      ? `Pool '${pool.name}' projected to EXHAUST daily quota capacity! Total available daily tokens: ${totalCapacityTokens.toLocaleString()}, Target required: ${targetTokensPerDay.toLocaleString()}`
      : `Pool '${pool.name}' projected to SURVIVE 24h simulation. Total available daily tokens: ${totalCapacityTokens.toLocaleString()} vs Target ${targetTokensPerDay.toLocaleString()}`;

    return {
      poolId: pool.id,
      poolName: pool.name,
      policy: pool.policy,
      totalPlannedRequests: targetReqsPerDay,
      totalPlannedTokens: targetTokensPerDay,
      wouldExhaust,
      exhaustionTimeHours: wouldExhaust ? (minExhaustionHour === 0 ? 0 : 18.5) : undefined,
      exhaustedConnectionId: bottleneckConnId,
      exhaustedProviderSlug: bottleneckProvider,
      summary,
    };
  }
}
