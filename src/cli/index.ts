#!/usr/bin/env node

import { Command } from 'commander';
import { getDatabase } from '../infra/db/client.js';
import { runMigrations } from '../infra/db/migrationRunner.js';
import { ProviderRepository } from '../infra/db/repositories/providerRepo.js';
import { ConnectionRepository } from '../infra/db/repositories/connectionRepo.js';
import { ModelRepository } from '../infra/db/repositories/modelRepo.js';
import { GoalRepository } from '../infra/db/repositories/goalRepo.js';
import { PoolRepository } from '../infra/db/repositories/poolRepo.js';
import { HealthRepository } from '../infra/db/repositories/healthRepo.js';
import { QuotaRepository } from '../infra/db/repositories/quotaRepo.js';
import { RequestLogRepository } from '../infra/db/repositories/requestLogRepo.js';

import { ProviderService } from '../services/providerService.js';
import { CatalogService } from '../catalog/catalogService.js';
import { GoalService } from '../services/goalService.js';
import { PoolService } from '../services/poolService.js';
import { GatewayService } from '../services/gatewayService.js';
import { SimulationService } from '../services/simulationService.js';
import { startServer } from '../api/server.js';

const program = new Command();

program
  .name('goalroute')
  .description('GoalRoute — Multi-provider LLM gateway with goal-based self-healing routing')
  .version('0.1.0');

function getServices() {
  const db = getDatabase();
  runMigrations(db);

  const providerRepo = new ProviderRepository(db);
  const connectionRepo = new ConnectionRepository(db);
  const modelRepo = new ModelRepository(db);
  const goalRepo = new GoalRepository(db);
  const poolRepo = new PoolRepository(db);
  const healthRepo = new HealthRepository(db);
  const quotaRepo = new QuotaRepository(db);
  const logRepo = new RequestLogRepository(db);

  const providerService = new ProviderService(providerRepo, connectionRepo);
  const catalogService = new CatalogService(providerRepo, modelRepo);
  const goalService = new GoalService(goalRepo, connectionRepo, providerRepo, modelRepo, healthRepo, quotaRepo);
  const poolService = new PoolService(poolRepo, goalService);
  const gatewayService = new GatewayService(poolRepo, connectionRepo, modelRepo, providerRepo, healthRepo, quotaRepo, logRepo);
  const simulationService = new SimulationService(poolService, goalService, quotaRepo, connectionRepo, providerRepo, modelRepo);

  return {
    providerService,
    catalogService,
    goalService,
    poolService,
    gatewayService,
    simulationService,
    connectionRepo,
    providerRepo,
    healthRepo,
    quotaRepo,
  };
}

// -------------------------------------------------------------
// Provider Commands
// -------------------------------------------------------------
const providerCmd = program.command('provider').description('Manage provider connections');

providerCmd
  .command('add <slug>')
  .description('Add a new provider API key connection')
  .requiredOption('--label <label>', 'User-facing connection label')
  .requiredOption('--key <apiKey>', 'Provider API Key')
  .option('--tier <tier>', 'Tier: free, paid, subscription', 'free')
  .option('--json', 'Emit output as JSON')
  .action((slug, options) => {
    const { providerService } = getServices();
    const result = providerService.addConnection({
      providerSlug: slug,
      label: options.label,
      apiKey: options.key,
      tier: options.tier as any,
    });
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`[+] Added connection '${result.label}' (ID: ${result.id}) for provider '${result.providerDisplayName}'`);
    }
  });

providerCmd
  .command('list')
  .description('List all configured provider connections')
  .option('--json', 'Emit output as JSON')
  .action((options) => {
    const { providerService } = getServices();
    const connections = providerService.listConnections();
    if (options.json) {
      console.log(JSON.stringify(connections, null, 2));
    } else {
      console.table(connections.map((c) => ({
        ID: c.id,
        Provider: c.providerSlug,
        Label: c.label,
        Tier: c.tier,
        Status: c.status,
      })));
    }
  });

providerCmd
  .command('test <connectionId>')
  .description('Test connection credentials with a live provider ping')
  .option('--json', 'Emit output as JSON')
  .action(async (connectionId, options) => {
    const { providerService } = getServices();
    const res = await providerService.testConnection(connectionId);
    if (options.json) {
      console.log(JSON.stringify(res, null, 2));
    } else {
      if (res.success) {
        console.log(`[✓] Connection ${connectionId} tested HEALTHY (${res.latencyMs}ms)`);
      } else {
        console.log(`[✗] Connection ${connectionId} FAILED: ${res.error}`);
      }
    }
  });

providerCmd
  .command('remove <connectionId>')
  .description('Remove a provider connection')
  .action((connectionId) => {
    const { providerService } = getServices();
    providerService.removeConnection(connectionId);
    console.log(`[-] Connection ${connectionId} removed`);
  });

// -------------------------------------------------------------
// Catalog Commands
// -------------------------------------------------------------
const catalogCmd = program.command('catalog').description('Manage curated catalog');

catalogCmd
  .command('sync')
  .description('Sync curated providers and models seed registries')
  .action(() => {
    const { catalogService } = getServices();
    const res = catalogService.syncCatalog();
    console.log(`[✓] Catalog synced: ${res.providersCount} providers, ${res.modelsCount} models`);
  });

catalogCmd
  .command('show <slug>')
  .description('Show models for provider slug')
  .option('--json', 'Emit output as JSON')
  .action((slug, options) => {
    const { catalogService } = getServices();
    const models = catalogService.getModelsForProvider(slug);
    if (options.json) {
      console.log(JSON.stringify(models, null, 2));
    } else {
      console.table(models.map((m) => ({
        Model: m.model_name,
        Name: m.display_name,
        Context: m.context_window,
        TPS: m.bench_tps,
        TTFT_ms: m.bench_ttft_ms,
      })));
    }
  });

// -------------------------------------------------------------
// Goal Commands
// -------------------------------------------------------------
const goalCmd = program.command('goal').description('Manage goals and solver');

goalCmd
  .command('create')
  .description('Create a goal specification')
  .requiredOption('--name <name>', 'Goal name')
  .option('--task <taskType>', 'Task type: coding_agent, chatbot, batch, research, general', 'coding_agent')
  .option('--requests-per-day <reqs>', 'Target requests per day', (v) => parseInt(v), 4000)
  .option('--tokens-per-day <tokens>', 'Target tokens per day', (v) => parseInt(v), 10000000)
  .option('--latency <latency>', 'Latency preference: instant, relaxed', 'relaxed')
  .option('--budget <budget>', 'Budget preference: free, capped, unlimited', 'free')
  .option('--exhaustion <exhaustion>', 'Exhaustion preference: fill_first, preserve_backup', 'preserve_backup')
  .option('--reliability <reliability>', 'Reliability preference: standard, maximum', 'standard')
  .option('--json', 'Emit output as JSON')
  .action((options) => {
    const { goalService } = getServices();
    const goal = goalService.createGoal({
      name: options.name,
      task_type: options.task as any,
      target_requests_per_day: options.requestsPerDay,
      target_tokens_per_day: options.tokensPerDay,
      latency_pref: options.latency as any,
      budget_pref: options.budget as any,
      budget_cap_usd_monthly: null,
      exhaustion_pref: options.exhaustion as any,
      reliability_pref: options.reliability as any,
      safety_margin_pct: 20.0,
    });

    if (options.json) {
      console.log(JSON.stringify(goal, null, 2));
    } else {
      console.log(`[+] Goal created: '${goal.name}' (ID: ${goal.id})`);
    }
  });

goalCmd
  .command('solve <goalId>')
  .description('Dry-run solve a goal to produce a PoolPlan')
  .option('--json', 'Emit output as JSON')
  .action((goalId, options) => {
    const { goalService } = getServices();
    const plan = goalService.solveGoalById(goalId);
    if (options.json) {
      console.log(JSON.stringify(plan, null, 2));
    } else {
      console.log(`=== Goal Solver Recommendation Plan ===`);
      console.log(`Feasible: ${plan.feasible ? 'YES' : 'NO'} (Confidence: ${(plan.confidenceScore * 100).toFixed(1)}%)`);
      console.log(`Policy: ${plan.policy}`);
      console.log(`Projected Daily Tokens: ${plan.projectedDailyTokenCapacity.toLocaleString()}`);
      console.log(`Estimated Monthly Cost: $${plan.estimatedMonthlyCostUsd.toFixed(2)}`);
      console.log(`\nSteps (${plan.steps.length}):`);
      plan.steps.forEach((s, idx) => {
        console.log(`  ${idx + 1}. [${s.role.toUpperCase()}] ${s.candidate.providerSlug} / ${s.candidate.modelName} — ${s.reason}`);
      });
      if (plan.gapSuggestion) {
        console.log(`\nGap Suggestion: ${plan.gapSuggestion.reason}`);
      }
      if (plan.warnings.length > 0) {
        console.log(`\nWarnings: ${plan.warnings.join('; ')}`);
      }
    }
  });

goalCmd
  .command('list')
  .description('List all goals')
  .option('--json', 'Emit output as JSON')
  .action((options) => {
    const { goalService } = getServices();
    const goals = goalService.listGoals();
    if (options.json) {
      console.log(JSON.stringify(goals, null, 2));
    } else {
      console.table(goals.map((g) => ({
        ID: g.id,
        Name: g.name,
        Task: g.task_type,
        ReqsPerDay: g.target_requests_per_day,
        TokensPerDay: g.target_tokens_per_day,
        Budget: g.budget_pref,
      })));
    }
  });

// -------------------------------------------------------------
// Pool Commands
// -------------------------------------------------------------
const poolCmd = program.command('pool').description('Manage routing pools');

poolCmd
  .command('create')
  .description('Persist a solved goal plan into an active routing pool')
  .requiredOption('--from-goal <goalId>', 'Goal ID to solve and create pool from')
  .option('--name <name>', 'Custom pool name')
  .option('--json', 'Emit output as JSON')
  .action((options) => {
    const { poolService } = getServices();
    const pool = poolService.createPoolFromGoal(options.fromGoal, options.name);
    if (options.json) {
      console.log(JSON.stringify(pool, null, 2));
    } else {
      console.log(`[+] Created active routing pool '${pool.name}' (ID: ${pool.id}) with ${pool.steps.length} target steps`);
    }
  });

poolCmd
  .command('list')
  .description('List active routing pools')
  .option('--json', 'Emit output as JSON')
  .action((options) => {
    const { poolService } = getServices();
    const pools = poolService.listPools();
    if (options.json) {
      console.log(JSON.stringify(pools, null, 2));
    } else {
      console.table(pools.map((p) => ({
        ID: p.id,
        Name: p.name,
        Policy: p.policy,
        Active: p.isActive,
        StepsCount: p.steps.length,
      })));
    }
  });

poolCmd
  .command('show <poolId>')
  .description('Show detailed pool configuration and target steps')
  .option('--json', 'Emit output as JSON')
  .action((poolId, options) => {
    const { poolService } = getServices();
    const pool = poolService.getPool(poolId);
    if (options.json) {
      console.log(JSON.stringify(pool, null, 2));
    } else {
      console.log(`=== Pool: ${pool.name} (${pool.id}) ===`);
      console.log(`Policy: ${pool.policy}`);
      console.log(`Active: ${pool.isActive}`);
      console.log(`Steps (${pool.steps.length}):`);
      pool.steps.forEach((s) => {
        console.log(`  [Order ${s.order_index}] Connection: ${s.connection_id} | Model: ${s.model_id} | Role: ${s.role}`);
      });
    }
  });

// -------------------------------------------------------------
// Live Route Command
// -------------------------------------------------------------
program
  .command('route')
  .description('Dispatch a real LLM request through a routing pool')
  .requiredOption('--pool <poolId>', 'Pool ID to dispatch against')
  .requiredOption('--prompt <promptText>', 'Prompt text to send')
  .option('--json', 'Emit output as JSON')
  .action(async (options) => {
    const { gatewayService } = getServices();
    const result = await gatewayService.dispatch(options.pool, {
      model: 'auto',
      messages: [{ role: 'user', content: options.promptText }],
    });

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`=== Route Dispatch Completed ===`);
      console.log(`Selected Provider: ${result.selectedStep.providerSlug}`);
      console.log(`Selected Model: ${result.selectedStep.modelName}`);
      console.log(`Latency: ${result.latencyMs}ms`);
      console.log(`\nResponse:\n${result.response.choices[0]?.message?.content}`);
      console.log(`\nDecision Trace:`);
      result.decisionTrace.forEach((t) => {
        console.log(`  - [${t.status.toUpperCase()}] ${t.providerSlug}/${t.modelId}: ${t.reason || t.error || ''}`);
      });
    }
  });

// -------------------------------------------------------------
// Observability & Simulation Commands
// -------------------------------------------------------------
program
  .command('status')
  .description('Check health state and quota headroom for all provider connections')
  .action(() => {
    const { connectionRepo, providerRepo, healthRepo } = getServices();
    const connections = connectionRepo.listAll();
    console.table(
      connections.map((c) => {
        const prov = providerRepo.findById(c.provider_id);
        const health = healthRepo.get(c.id);
        return {
          ID: c.id,
          Provider: prov?.slug,
          Label: c.label,
          Status: c.status,
          BreakerState: health ? health.state : 'closed',
          Failures: health ? health.consecutive_failures : 0,
        };
      })
    );
  });

program
  .command('simulate')
  .description('Simulate full day target load against live pool quota state')
  .requiredOption('--pool <poolId>', 'Pool ID to simulate')
  .option('--day', 'Simulate 24-hour cycle')
  .option('--json', 'Emit output as JSON')
  .action((options) => {
    const { simulationService } = getServices();
    const res = simulationService.simulateFullDay(options.pool);
    if (options.json) {
      console.log(JSON.stringify(res, null, 2));
    } else {
      console.log(`=== Full Day Goal Simulation ===`);
      console.log(`Pool: ${res.poolName} (${res.poolId})`);
      console.log(`Would Exhaust Quota: ${res.wouldExhaust ? 'YES' : 'NO'}`);
      console.log(`Summary: ${res.summary}`);
    }
  });

program
  .command('serve')
  .description('Start the GoalRoute Fastify HTTP Server and Gateway endpoint')
  .option('--port <port>', 'Port to listen on', (v) => parseInt(v), 8787)
  .action(async (options) => {
    await startServer(options.port);
  });

program.parse(process.argv);
