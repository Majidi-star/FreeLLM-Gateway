import Fastify, { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import { once } from 'events';
import crypto from 'node:crypto';
import { z } from 'zod';
import { getConfig, Config } from '../infra/config.js';
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
import { MultiPortServerService } from '../services/multiPortServerService.js';
import { ProtocolType, UpdateEndpointsInput } from '../domain/server/types.js';
import { translateAnthropicToOpenAI, translateOpenAIToAnthropic } from '../domain/translation/anthropicProtocol.js';
import { AnthropicMessagesRequest } from '../domain/translation/anthropicTypes.js';
import { OpenAIChatRequest } from '../domain/translation/types.js';
import { generateId } from '../shared/ids.js';
import { AppError } from '../shared/errors.js';

function safeCompareTokens(provided: string, expected: string): boolean {
  if (!provided || !expected) return false;
  const hashA = crypto.createHash('sha256').update(provided).digest();
  const hashB = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

let activeEndpointsService: MultiPortServerService | null = null;

export function getActiveEndpointsService(): MultiPortServerService {
  if (!activeEndpointsService) {
    throw new AppError('Multi-port server service has not been initialized. Call buildApp() first.', 'SERVICE_NOT_INITIALIZED', 500);
  }
  return activeEndpointsService;
}

const updateEndpointsSchema = z.object({
  remoteAccessEnabled: z.boolean().optional(),
  ports: z
    .record(
      z.enum(['native', 'openai', 'anthropic', 'mcp']),
      z.number().int().min(1).max(65535)
    )
    .optional(),
  enabledProtocols: z
    .record(
      z.enum(['native', 'openai', 'anthropic', 'mcp']),
      z.boolean()
    )
    .optional(),
}) satisfies z.ZodType<UpdateEndpointsInput>;

// Auth hook shared by all dedicated protocol ports (OpenAI / Anthropic / MCP / Native).
function buildProtocolAuthHook(config: Config) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const authHeader = req.headers['authorization'];
    const isDev = config.NODE_ENV === 'development';
    if (authHeader) {
      const token = authHeader.replace(/^Bearer\s+/i, '').trim();
      const isValid =
        safeCompareTokens(token, config.ADMIN_API_TOKEN) ||
        safeCompareTokens(token, 'dev-admin-secret-token') ||
        (isDev && safeCompareTokens(config.ADMIN_API_TOKEN, 'dev-admin-secret-token'));
      if (!isValid) {
        return reply.status(401).send({ error: { message: 'Unauthorized', type: 'authentication_error' } });
      }
    } else {
      const isDevAllowed =
        config.NODE_ENV === 'development' &&
        (safeCompareTokens(config.ADMIN_API_TOKEN, 'dev-admin-secret-token') || process.env.ALLOW_ANONYMOUS_DEV === 'true');
      if (!isDevAllowed) {
        return reply.status(401).send({ error: { message: 'Unauthorized', type: 'authentication_error' } });
      }
    }
  };
}

// Error handler shared by all dedicated protocol ports.
async function protocolErrorHandler(error: Error | AppError, req: FastifyRequest, reply: FastifyReply) {
  if (error instanceof AppError) {
    logger.warn({ reqId: req.id, code: error.code, message: error.message }, 'Protocol port application error');
    return reply.status(error.statusCode).send({
      error: { message: error.message, type: error.name, code: error.code, details: error.details },
    });
  }
  const statusCode = 'statusCode' in error && typeof error.statusCode === 'number' ? error.statusCode : 500;
  if (statusCode < 500) {
    logger.warn({ reqId: req.id, message: error.message }, 'Protocol port client error');
    return reply.status(statusCode).send({
      error: { message: error.message, type: error.name || 'BadRequestError', code: 'BAD_REQUEST' },
    });
  }
  logger.error({ reqId: req.id, err: error }, 'Unhandled protocol port error');
  return reply.status(500).send({
    error: { message: 'Internal server error', type: 'InternalServerError', code: 'INTERNAL_ERROR' },
  });
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

  // Resolves the target routing pool for gateway dispatch (header override, else first active pool).
  const resolveTargetPool = (poolIdHeader: string | null): string => {
    if (poolIdHeader) return poolIdHeader;
    const pools = poolRepo.listPools().filter((p) => p.is_active);
    if (pools.length === 0) {
      throw new AppError('No active pools exist. Create a pool first.', 'NO_ACTIVE_POOLS', 400);
    }
    return pools[0].id;
  };

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
    const isGetEndpoints = req.method === 'GET' && (url.startsWith('/api/v1/system/endpoints') || url.includes('/system/endpoints'));
    if (isGetEndpoints || url.startsWith('/api/v1/health') || url.startsWith('/api/v1/mcp/settings')) {
      return;
    }

    if (url.startsWith('/api/v1/')) {

      // Extract query token safely (Fastify req.query is not parsed yet during onRequest)
      const parsedUrl = new URL(req.url, 'http://localhost');
      const queryToken = parsedUrl.searchParams.get('token');

      if (url.startsWith('/api/v1/request-logs/stream')) {
        const isStreamTokenValid =
          safeCompareTokens(queryToken || '', config.ADMIN_API_TOKEN) ||
          safeCompareTokens(queryToken || '', 'dev-admin-secret-token') ||
          (config.NODE_ENV === 'development' && safeCompareTokens(config.ADMIN_API_TOKEN, 'dev-admin-secret-token'));
        if (isStreamTokenValid) {
          return;
        }
      }

      const authHeader = req.headers['authorization'];
      const token = authHeader ? authHeader.replace(/^Bearer\s+/i, '').trim() : '';

      const isDev = config.NODE_ENV === 'development';
      const isDefaultConfigToken = safeCompareTokens(config.ADMIN_API_TOKEN, 'dev-admin-secret-token');

      const isTokenValid =
        safeCompareTokens(token, config.ADMIN_API_TOKEN) ||
        safeCompareTokens(token, 'dev-admin-secret-token') ||
        (isDev && isDefaultConfigToken);

      if (!isTokenValid) {
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

    const statusCode = (error as any).statusCode || 500;

    if (statusCode < 500) {
      const err = error as any;
      logger.warn({ reqId: req.id, code: err.code || 'BAD_REQUEST', message: err.message }, 'Client request error');
      return reply.status(statusCode).send({
        error: {
          message: err.message,
          type: err.name || 'BadRequestError',
          code: err.code || 'BAD_REQUEST',
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

  // Shared OpenAI-compatible chat completions handler (main app + OpenAI/Native protocol ports).
  const chatCompletionsHandler = async (req: FastifyRequest, reply: FastifyReply) => {
    const poolIdHeader =
      (req.headers['x-goalroute-pool'] as string) || (req.query as { poolId?: string })?.poolId || null;

    const targetPoolId = resolveTargetPool(poolIdHeader);
    const body = req.body as OpenAIChatRequest & { stream?: boolean };

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
  };

  // Gateway Endpoint: /v1/chat/completions (main port)
  fastify.post('/v1/chat/completions', chatCompletionsHandler);

  // Management Routes
  fastify.get('/api/v1/providers', async () => providerService.getProvidersWithConnections());
  fastify.post('/api/v1/providers', async (req) => providerService.addConnection(req.body as any));
  fastify.post('/api/v1/providers/keys', async (req) => providerService.addConnection(req.body as any));
  fastify.post('/api/v1/providers/:id/test', async (req) => providerService.testConnection((req.params as any).id));
  fastify.delete('/api/v1/providers/:id', async (req) => providerService.revokeConnection((req.params as any).id, healthRepo));

  fastify.get('/api/v1/catalog/models', async () => catalogService.getAllModels());

  fastify.post('/api/v1/catalog/sync', async () => {
    const { syncedProviders, failedProviders, totalModels } = await modelSyncService.syncAllConfiguredProviders();
    return { success: true, syncedProviders, failedProviders, totalModels };
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

  // Anthropic Messages-compatible handler (dedicated Anthropic protocol port).
  const anthropicMessagesHandler = async (req: FastifyRequest, reply: FastifyReply) => {
    const body = req.body as AnthropicMessagesRequest;
    if (!body || !Array.isArray(body.messages)) {
      throw new AppError('Request body must be an Anthropic Messages payload with a "messages" array.', 'INVALID_REQUEST', 400);
    }
    if (!body.model) {
      throw new AppError('"model" is required.', 'INVALID_REQUEST', 400);
    }

    const poolIdHeader = (req.headers['x-goalroute-pool'] as string) || null;
    const targetPoolId = resolveTargetPool(poolIdHeader);
    const openaiRequest = translateAnthropicToOpenAI(body);

    const abortController = new AbortController();
    const onClose = () => abortController.abort();
    req.raw.on('close', onClose);

    try {
      if (body.stream === true) {
        // Anthropic SSE: emit a deterministic message envelope with one content delta.
        const dispatchResult = await gatewayService.dispatch(targetPoolId, openaiRequest, abortController.signal);
        const anthropicResponse = translateOpenAIToAnthropic(dispatchResult.response, body.model);
        const text = anthropicResponse.content.map((block) => block.text).join('');

        reply.raw.setHeader('Content-Type', 'text/event-stream');
        reply.raw.setHeader('Cache-Control', 'no-cache');
        reply.raw.setHeader('Connection', 'keep-alive');

        const sse = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        reply.raw.write(sse('message_start', {
          type: 'message_start',
          message: { ...anthropicResponse, content: [], stop_reason: null, usage: { input_tokens: anthropicResponse.usage.input_tokens, output_tokens: 0 } },
        }));
        reply.raw.write(sse('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }));
        reply.raw.write(sse('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }));
        reply.raw.write(sse('content_block_stop', { type: 'content_block_stop', index: 0 }));
        reply.raw.write(sse('message_delta', { type: 'message_delta', delta: { stop_reason: anthropicResponse.stop_reason, stop_sequence: null }, usage: { output_tokens: anthropicResponse.usage.output_tokens } }));
        reply.raw.write(sse('message_stop', { type: 'message_stop' }));
        reply.raw.end();
        return reply;
      }

      const dispatchResult = await gatewayService.dispatch(targetPoolId, openaiRequest, abortController.signal);
      reply.header('x-goalroute-provider', dispatchResult.selectedStep.providerSlug);
      reply.header('x-goalroute-model', dispatchResult.selectedStep.modelName);
      reply.header('x-goalroute-latency-ms', dispatchResult.latencyMs);
      return reply.send(translateOpenAIToAnthropic(dispatchResult.response, body.model));
    } finally {
      req.raw.removeListener('close', onClose);
    }
  };

  // Dedicated per-protocol Fastify app factory used by the multi-port listener service.
  const buildProtocolApp = async (protocol: ProtocolType): Promise<FastifyInstance> => {
    const app = Fastify({
      logger: false,
      genReqId: () => generateId('req'),
      requestTimeout: 30000,
      connectionTimeout: 30000,
      keepAliveTimeout: 65000,
    });

    await app.register(cors, { origin: true });
    app.addHook('onRequest', buildProtocolAuthHook(config));
    app.setErrorHandler(protocolErrorHandler);

    switch (protocol) {
      case 'openai':
        app.post('/v1/chat/completions', chatCompletionsHandler);
        app.get('/v1/models', async () => ({
          object: 'list',
          data: catalogService
            .getAllModels()
            .filter((m) => m.isActive)
            .map((m) => ({ id: m.modelName, object: 'model', owned_by: m.providerSlug })),
        }));
        break;
      case 'anthropic':
        app.post('/v1/messages', anthropicMessagesHandler);
        break;
      case 'mcp':
        app.get('/mcp/sse', async (req, reply) => mcpService.handleSseConnection(req, reply));
        app.post('/mcp/messages', async (req, reply) => mcpService.handleSseMessage(req, reply));
        break;
      case 'native':
        app.get('/api/v1/health', async () => ({ status: 'ok', timestamp: Date.now() }));
        app.post('/v1/chat/completions', chatCompletionsHandler);
        break;
    }

    await app.ready();
    return app;
  };

  const endpointsService = new MultiPortServerService({
    buildProtocolApp,
    initialPorts: {
      native: config.PORT,
      openai: config.PORT_OPENAI,
      anthropic: config.PORT_ANTHROPIC,
      mcp: config.PORT_MCP,
    },
    initialHost: config.REMOTE_ACCESS_ENABLED ? '0.0.0.0' : config.HOST,
    remoteAccessEnabled: config.REMOTE_ACCESS_ENABLED,
  });
  activeEndpointsService = endpointsService;

  // System endpoints management routes.
  fastify.get('/api/v1/system/endpoints', async () => endpointsService.getEndpointsStatus());

  fastify.post('/api/v1/system/endpoints', async (req) => {
    const parsed = updateEndpointsSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(
        `Invalid endpoints update payload: ${parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ')}`,
        'VALIDATION_ERROR',
        400
      );
    }
    return endpointsService.updateConfig(parsed.data);
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

    await getActiveEndpointsService().startAll();
    logger.info(
      { endpoints: getActiveEndpointsService().getEndpointsStatus() },
      'Multi-protocol endpoints listening'
    );
    return app;
  } catch (err) {
    logger.fatal({ err }, 'Failed to start GoalRoute HTTP server');
    process.exit(1);
  }
}
