import Fastify from 'fastify';
import cors from '@fastify/cors';
import { getConfig } from '../infra/config.js';
import { logger } from '../infra/logger.js';
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
import { generateId } from '../shared/ids.js';
import { AppError } from '../shared/errors.js';

export async function buildApp() {
  const config = getConfig();
  const db = getDatabase();
  runMigrations(db);

  // Initialize Repositories
  const providerRepo = new ProviderRepository(db);
  const connectionRepo = new ConnectionRepository(db);
  const modelRepo = new ModelRepository(db);
  const goalRepo = new GoalRepository(db);
  const poolRepo = new PoolRepository(db);
  const healthRepo = new HealthRepository(db);
  const quotaRepo = new QuotaRepository(db);
  const logRepo = new RequestLogRepository(db);

  // Initialize Services
  const providerService = new ProviderService(providerRepo, connectionRepo);
  const catalogService = new CatalogService(providerRepo, modelRepo);
  const goalService = new GoalService(goalRepo, connectionRepo, providerRepo, modelRepo, healthRepo, quotaRepo);
  const poolService = new PoolService(poolRepo, goalService);
  const gatewayService = new GatewayService(poolRepo, connectionRepo, modelRepo, providerRepo, healthRepo, quotaRepo, logRepo);

  // Auto-sync catalog on server boot
  catalogService.syncCatalog();

  const fastify = Fastify({
    logger: false, // Use our Pino redacting logger
    genReqId: () => generateId('req'),
  });

  await fastify.register(cors);

  // Global Request Logging & RequestId Middleware
  fastify.addHook('onRequest', async (req, reply) => {
    logger.info({ reqId: req.id, method: req.method, url: req.url }, 'Incoming HTTP request');
  });

  // Centralized Error Handler (Principle 2: Never fail-opaque)
  fastify.setErrorHandler((error, req, reply) => {
    if (reply.raw.headersSent) {
      return;
    }

    if (error instanceof AppError) {
      logger.warn({ reqId: req.id, code: error.code, message: error.message }, 'Application error');
      return reply.status(error.statusCode).send({
        error: {
          message: error.message,
          type: error.name,
          code: error.code,
          details: error.details,
        },
      });
    }

    logger.error({ reqId: req.id, err: error }, 'Unhandled server error');
    return reply.status(500).send({
      error: {
        message: 'Internal server error',
        type: 'InternalServerError',
        code: 'INTERNAL_ERROR',
      },
    });
  });

  // Health probe endpoint
  fastify.get('/api/v1/health', async () => {
    const connections = connectionRepo.listAll();
    const summary = connections.map((c) => {
      const p = providerRepo.findById(c.provider_id);
      const h = healthRepo.get(c.id);
      return {
        connectionId: c.id,
        provider: p?.slug,
        label: c.label,
        status: c.status,
        circuitBreaker: h ? h.state : 'closed',
      };
    });
    return { status: 'healthy', timestamp: Date.now(), connections: summary };
  });

  // Gateway Endpoint: /v1/chat/completions
  fastify.post('/v1/chat/completions', async (req, reply) => {
    const poolIdHeader = (req.headers['x-goalroute-pool'] as string) || (req.query as any)?.poolId;
    
    // Default to first active pool if no pool specified
    let targetPoolId = poolIdHeader;
    if (!targetPoolId) {
      const pools = poolRepo.listPools().filter((p) => p.is_active);
      if (pools.length === 0) {
        return reply.status(400).send({ error: { message: 'No active pools exist. Create a pool first.', code: 'NO_ACTIVE_POOLS' } });
      }
      targetPoolId = pools[0].id;
    }

    const body = req.body as any;
    if (body?.stream) {
      const abortController = new AbortController();
      let streamFinished = false;

      const onClose = () => {
        if (!streamFinished) {
          abortController.abort();
        }
      };
      req.raw.on('close', onClose);

      try {
        const dispatchResult = await gatewayService.dispatchStream(targetPoolId, body, abortController.signal);

        reply.raw.setHeader('Content-Type', 'text/event-stream');
        reply.raw.setHeader('Cache-Control', 'no-cache');
        reply.raw.setHeader('Connection', 'keep-alive');
        reply.raw.setHeader('x-goalroute-provider', dispatchResult.selectedStep.providerSlug);
        reply.raw.setHeader('x-goalroute-model', dispatchResult.selectedStep.modelName);
        reply.raw.setHeader('x-goalroute-latency-ms', String(dispatchResult.latencyMs));

        for await (const chunk of dispatchResult.stream) {
          reply.raw.write(chunk);
        }
        streamFinished = true;
      } catch (err: any) {
        if (reply.raw.headersSent) {
          reply.raw.write('data: {"id":"chatcmpl-err","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n');
          reply.raw.write('event: error\ndata: {"error":"Upstream provider stream disconnected"}\n\n');
          reply.raw.write('data: [DONE]\n\n');
        } else {
          throw err;
        }
      } finally {
        req.raw.removeListener('close', onClose);
        if (reply.raw.headersSent) {
          reply.raw.end();
        }
      }
      return reply;
    }

    const dispatchResult = await gatewayService.dispatch(targetPoolId, body);

    reply.header('x-goalroute-provider', dispatchResult.selectedStep.providerSlug);
    reply.header('x-goalroute-model', dispatchResult.selectedStep.modelName);
    reply.header('x-goalroute-latency-ms', dispatchResult.latencyMs);

    return reply.send(dispatchResult.response);
  });

  // Management Routes
  fastify.get('/api/v1/providers', async () => providerService.listConnections());
  fastify.post('/api/v1/providers', async (req) => providerService.addConnection(req.body as any));
  fastify.post('/api/v1/providers/:id/test', async (req) => providerService.testConnection((req.params as any).id));

  fastify.get('/api/v1/goals', async () => goalService.listGoals());
  fastify.post('/api/v1/goals', async (req) => goalService.createGoal(req.body as any));
  fastify.post('/api/v1/goals/:id/solve', async (req) => goalService.solveGoalById((req.params as any).id));

  fastify.get('/api/v1/pools', async () => poolService.listPools());
  fastify.post('/api/v1/pools', async (req) => {
    const body = req.body as any;
    return poolService.createPoolFromGoal(body.goalId, body.name);
  });

  fastify.get('/api/v1/request-logs', async (req) => {
    const q = req.query as any;
    return logRepo.query({ poolId: q?.poolId, limit: q?.limit ? Number(q.limit) : 50 });
  });

  return fastify;
}

export async function startServer(port?: number) {
  const config = getConfig();
  const listenPort = port || config.PORT;
  const app = await buildApp();

  try {
    const address = await app.listen({ port: listenPort, host: '0.0.0.0' });
    logger.info({ address, port: listenPort }, 'GoalRoute HTTP server listening');
    return app;
  } catch (err) {
    logger.fatal({ err }, 'Failed to start GoalRoute HTTP server');
    process.exit(1);
  }
}
