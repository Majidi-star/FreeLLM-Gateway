import Fastify from 'fastify';
import cors from '@fastify/cors';
import { once } from 'events';
import crypto from 'node:crypto';
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
import { ModelSyncService } from '../catalog/modelSyncService.js';
import { GoalService } from '../services/goalService.js';
import { PoolService } from '../services/poolService.js';
import { GatewayService } from '../services/gatewayService.js';
import { McpService } from '../services/mcpService.js';
import { generateId } from '../shared/ids.js';
import { AppError } from '../shared/errors.js';

function safeCompareTokens(provided: string, expected: string): boolean {
  if (!provided || !expected) return false;
  const hashA = crypto.createHash('sha256').update(provided).digest();
  const hashB = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

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
  const providerService = new ProviderService(providerRepo, connectionRepo, quotaRepo);
  const catalogService = new CatalogService(providerRepo, modelRepo);
  const modelSyncService = new ModelSyncService(providerRepo, connectionRepo, modelRepo);
  const goalService = new GoalService(goalRepo, connectionRepo, providerRepo, modelRepo, healthRepo, quotaRepo);
  const poolService = new PoolService(poolRepo, goalService);
  const gatewayService = new GatewayService(poolRepo, connectionRepo, modelRepo, providerRepo, healthRepo, quotaRepo, logRepo);
  const mcpService = new McpService(quotaRepo, healthRepo, connectionRepo, providerRepo, goalService, poolService, providerService);

  // Auto-sync catalog on server boot
  catalogService.syncCatalog();

  const fastify = Fastify({
    logger: false, // Use our Pino redacting logger
    genReqId: () => generateId('req'),
    requestTimeout: 30000,
    connectionTimeout: 30000,
    keepAliveTimeout: 65000,
  });

  await fastify.register(cors, {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      try {
        const { hostname } = new URL(origin);
        if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname.endsWith('.localhost')) {
          return cb(null, true);
        }
      } catch {}
      return cb(null, false);
    },
  });

  // Global Request Logging & Authentication Middleware
  fastify.addHook('onRequest', async (req, reply) => {
    logger.info({ reqId: req.id, method: req.method, url: req.url }, 'Incoming HTTP request');

    const url = req.url;
    if (url.startsWith('/api/v1/')) {
      if (url.startsWith('/api/v1/health') || url.startsWith('/api/v1/mcp/settings')) {
        return;
      }
      if (url.startsWith('/api/v1/request-logs/stream') && safeCompareTokens((req.query as any)?.token, config.ADMIN_API_TOKEN)) {
        return;
      }
      const authHeader = req.headers['authorization'];
      if (!authHeader) {
        return reply.status(401).send({ error: { message: 'Unauthorized', type: 'authentication_error' } });
      }
      const token = authHeader.replace(/^Bearer\s+/i, '').trim();
      if (!safeCompareTokens(token, config.ADMIN_API_TOKEN)) {
        return reply.status(401).send({ error: { message: 'Unauthorized', type: 'authentication_error' } });
      }
    } else if (url.startsWith('/v1/chat/completions')) {
      const authHeader = req.headers['authorization'];
      if (authHeader) {
        const token = authHeader.replace(/^Bearer\s+/i, '').trim();
        if (!safeCompareTokens(token, config.ADMIN_API_TOKEN)) {
          return reply.status(401).send({ error: { message: 'Unauthorized', type: 'authentication_error' } });
        }
      } else {
        const isDevAllowed = config.NODE_ENV === 'development' && (safeCompareTokens(config.ADMIN_API_TOKEN, 'dev-admin-secret-token') || process.env.ALLOW_ANONYMOUS_DEV === 'true');
        if (!isDevAllowed) {
          return reply.status(401).send({ error: { message: 'Unauthorized', type: 'authentication_error' } });
        }
      }
    }
  });

  // Centralized Error Handler (Principle 2: Never fail-opaque)
  fastify.setErrorHandler((error, req, reply) => {
    if (reply.raw.headersSent) {
      if (!reply.raw.writableEnded && !reply.raw.destroyed) {
        reply.raw.end();
      }
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
  fastify.get('/api/v1/health', async (req) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader ? authHeader.replace(/^Bearer\s+/i, '').trim() : '';
    const isAuthenticated = safeCompareTokens(token, config.ADMIN_API_TOKEN);

    if (!isAuthenticated) {
      return { status: 'ok', timestamp: Date.now() };
    }

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

        reply.raw.on('error', () => {});

        for await (const chunk of dispatchResult.stream) {
          const canWriteMore = reply.raw.write(chunk);
          if (!canWriteMore) {
            await Promise.race([once(reply.raw, 'drain'), once(reply.raw, 'close')]);
            if (reply.raw.destroyed) break;
          }
        }
        streamFinished = true;
      } catch (err: any) {
        if (reply.raw.headersSent && !reply.raw.writableEnded && !reply.raw.destroyed) {
          reply.raw.write('data: {"id":"chatcmpl-err","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n');
          reply.raw.write('event: error\ndata: {"error":"Upstream provider stream disconnected"}\n\n');
          reply.raw.write('data: [DONE]\n\n');
        } else if (!reply.raw.headersSent) {
          throw err;
        }
      } finally {
        req.raw.removeListener('close', onClose);
        if (reply.raw.headersSent && !reply.raw.writableEnded && !reply.raw.destroyed) {
          reply.raw.end();
        }
      }
      return reply;
    }

    const abortController = new AbortController();
    let isFinished = false;
    const onClose = () => {
      if (!isFinished) {
        abortController.abort();
      }
    };
    req.raw.on('close', onClose);

    try {
      const dispatchResult = await gatewayService.dispatch(targetPoolId, body, abortController.signal);
      isFinished = true;

      reply.header('x-goalroute-provider', dispatchResult.selectedStep.providerSlug);
      reply.header('x-goalroute-model', dispatchResult.selectedStep.modelName);
      reply.header('x-goalroute-latency-ms', dispatchResult.latencyMs);

      return reply.send(dispatchResult.response);
    } finally {
      req.raw.removeListener('close', onClose);
    }
  });

  // Management Routes
  fastify.get('/api/v1/providers', async () => providerService.getProvidersWithConnections());
  fastify.post('/api/v1/providers', async (req) => providerService.addConnection(req.body as any));
  fastify.post('/api/v1/providers/keys', async (req) => providerService.addConnection(req.body as any));
  fastify.post('/api/v1/providers/:id/test', async (req) => providerService.testConnection((req.params as any).id));
  fastify.delete('/api/v1/providers/:id', async (req) => providerService.revokeConnection((req.params as any).id, healthRepo));

  fastify.get('/api/v1/catalog/models', async () => catalogService.getAllModels());

  fastify.post('/api/v1/catalog/sync', async () => {
    const { syncedProviders, totalModels } = await modelSyncService.syncAllConfiguredProviders();
    return { success: true, syncedProviders, totalModels };
  });

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
    const limit = Math.min(Math.max(1, Math.floor(Number(q?.limit)) || 50), 500);
    return logRepo.query({ poolId: q?.poolId, limit });
  });

  fastify.get('/api/v1/request-logs/stream', async (req, reply) => {
    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.write(': ok\n\n');

    const onLogEvent = (eventData: any) => {
      if (!reply.raw.writableEnded) {
        reply.raw.write(`data: ${JSON.stringify(eventData)}\n\n`);
      }
    };

    gatewayService.on('log', onLogEvent);

    const cleanup = () => {
      gatewayService.removeListener('log', onLogEvent);
      if (!reply.raw.writableEnded) {
        reply.raw.end();
      }
    };

    req.raw.on('close', cleanup);

    if ((req.query as any)?.once === 'true') {
      cleanup();
    }

    return reply;
  });

  // MCP Remote Transports & Settings Routes
  fastify.get('/mcp/sse', async (req, reply) => {
    return mcpService.handleSseConnection(req, reply);
  });

  fastify.post('/mcp/messages', async (req, reply) => {
    return mcpService.handleSseMessage(req, reply);
  });

  fastify.get('/api/v1/mcp/settings', async () => {
    return {
      isSafeMode: mcpService.getSafeMode(),
      tools: [
        { name: 'check_quota', safe: true, description: 'Reads provider quota levels' },
        { name: 'solve_routing_goal', safe: true, description: 'Picks the fastest free route' },
        { name: 'probe_provider_keys', safe: true, description: 'Tests key latency, read-only' },
        { name: 'mutate_pools', safe: false, description: 'Adds or removes routing pools' },
      ],
    };
  });

  fastify.post('/api/v1/mcp/settings', async (req) => {
    const body = req.body as any;
    const isSafeMode = typeof body?.isSafeMode === 'boolean' ? body.isSafeMode : Boolean(body?.safeMode);
    mcpService.setSafeMode(isSafeMode);
    return { isSafeMode: mcpService.getSafeMode(), success: true };
  });

  return fastify;
}

export async function startServer(port?: number) {
  const config = getConfig();
  const listenPort = port || config.PORT;

  try {
    const app = await buildApp();
    const address = await app.listen({ port: listenPort, host: '0.0.0.0' });
    logger.info({ address, port: listenPort }, 'GoalRoute HTTP server listening');
    return app;
  } catch (err) {
    logger.fatal({ err }, 'Failed to start GoalRoute HTTP server');
    process.exit(1);
  }
}
