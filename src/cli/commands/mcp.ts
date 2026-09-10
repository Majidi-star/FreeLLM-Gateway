import { getDatabase } from '../../infra/db/client.js';
import { runMigrations } from '../../infra/db/migrationRunner.js';
import { ProviderRepository } from '../../infra/db/repositories/providerRepo.js';
import { ConnectionRepository } from '../../infra/db/repositories/connectionRepo.js';
import { ModelRepository } from '../../infra/db/repositories/modelRepo.js';
import { GoalRepository } from '../../infra/db/repositories/goalRepo.js';
import { PoolRepository } from '../../infra/db/repositories/poolRepo.js';
import { HealthRepository } from '../../infra/db/repositories/healthRepo.js';
import { QuotaRepository } from '../../infra/db/repositories/quotaRepo.js';

import { ProviderService } from '../../services/providerService.js';
import { GoalService } from '../../services/goalService.js';
import { PoolService } from '../../services/poolService.js';
import { McpService } from '../../services/mcpService.js';
import { logger } from '../../infra/logger.js';

export async function runMcp(): Promise<void> {
  // Ensure internal logging directs to stderr so stdout remains clean for JSON-RPC messages
  (logger as any).destination = 2;

  const db = getDatabase();
  runMigrations(db);

  const providerRepo = new ProviderRepository(db);
  const connectionRepo = new ConnectionRepository(db);
  const modelRepo = new ModelRepository(db);
  const goalRepo = new GoalRepository(db);
  const poolRepo = new PoolRepository(db);
  const healthRepo = new HealthRepository(db);
  const quotaRepo = new QuotaRepository(db);

  const providerService = new ProviderService(providerRepo, connectionRepo);
  const goalService = new GoalService(goalRepo, connectionRepo, providerRepo, modelRepo, healthRepo, quotaRepo);
  const poolService = new PoolService(poolRepo, goalService);

  const mcpService = new McpService(
    quotaRepo,
    healthRepo,
    connectionRepo,
    providerRepo,
    goalService,
    poolService,
    providerService
  );

  await mcpService.connectStdio();
}
