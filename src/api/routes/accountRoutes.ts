import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../shared/errors.js';
import { AccountService, AccountDTO, CreatedKeyDTO, ApiKeyDTO } from '../../services/accountService.js';
import { PoolService } from '../../services/poolService.js';
import { MultiPortServerService } from '../../services/multiPortServerService.js';
import { buildEndpointDescriptors } from '../../services/endpointDiscoveryService.js';
import type { Config } from '../../infra/config.js';

const createAccountSchema = z.object({
  name: z.string().min(1).max(64).regex(/^[A-Za-z0-9 ._-]+$/),
  description: z.string().optional().nullable(),
  defaultPoolId: z.string().optional().nullable(),
  defaultGoalId: z.string().optional().nullable(),
  monthlyBudgetUsd: z.number().nullable().optional(),
  rateLimitRpm: z.number().nullable().optional(),
  rateLimitTpm: z.number().nullable().optional(),
  maxKeys: z.number().int().positive().optional(),
});

const updateAccountSchema = z.object({
  name: z.string().min(1).max(64).regex(/^[A-Za-z0-9 ._-]+$/).optional(),
  description: z.string().optional().nullable(),
  status: z.enum(['active', 'suspended', 'deleted']).optional(),
  defaultPoolId: z.string().optional().nullable(),
  defaultGoalId: z.string().optional().nullable(),
  monthlyBudgetUsd: z.number().nullable().optional(),
  rateLimitRpm: z.number().nullable().optional(),
  rateLimitTpm: z.number().nullable().optional(),
  maxKeys: z.number().int().positive().optional(),
});

const createKeySchema = z.object({
  name: z.string().min(1).max(64),
  scopes: z.array(z.string()).optional(),
  poolId: z.string().optional().nullable(),
  expiresAt: z.number().int().positive().optional().nullable(),
});

const rotateKeySchema = z.object({
  graceSeconds: z.number().int().nonnegative().optional(),
});

export function registerAccountRoutes(app: FastifyInstance, deps: { accountService: AccountService; poolService: PoolService; endpointsService: MultiPortServerService; config: Config }): void {
  const { accountService, poolService, endpointsService, config } = deps;

  const validate = (schema: z.ZodSchema, data: unknown) => {
    try {
      return schema.parse(data);
    } catch (e) {
      throw new AppError('Validation failed', 'VALIDATION_ERROR', 400);
    }
  };

  app.get('/api/v1/accounts', async () => {
    return accountService.listAccounts();
  });

  app.post('/api/v1/accounts', async (req, reply) => {
    const data = validate(createAccountSchema, req.body);
    const account = accountService.createAccount(data);
    return account;
  });

  app.get('/api/v1/accounts/:id', async (req) => {
    const { id } = req.params as { id: string };
    return accountService.getAccount(id);
  });

  app.patch('/api/v1/accounts/:id', async (req) => {
    const { id } = req.params as { id: string };
    const data = validate(updateAccountSchema, req.body);
    return accountService.updateAccount(id, data);
  });

  app.delete('/api/v1/accounts/:id', async (req) => {
    const { id } = req.params as { id: string };
    accountService.deleteAccount(id);
    return { ok: true };
  });

  app.get('/api/v1/accounts/:id/keys', async (req) => {
    const { id } = req.params as { id: string };
    const query = req.query as { includeRevoked?: string };
    const includeRevoked = query.includeRevoked === 'true';
    const keys = accountService.listKeys(id, includeRevoked);
    return keys;
  });

  app.post('/api/v1/accounts/:id/keys', async (req, reply) => {
    const { id } = req.params as { id: string };
    const data = validate(createKeySchema, req.body);
    const created = accountService.createKey(id, data);
    reply.header('Cache-Control', 'no-store');
    return created;
  });

  app.post('/api/v1/accounts/:id/keys/:keyId/rotate', async (req, reply) => {
    const { id, keyId } = req.params as { id: string; keyId: string };
    const data = validate(rotateKeySchema, req.body);
    // Ensure key belongs to account
    const key = accountService.listKeys(id, true).find(k => k.id === keyId);
    if (!key) {
      throw new AppError('Key not found', 'NOT_FOUND', 404);
    }
    const rotated = accountService.rotateKey(keyId, data);
    reply.header('Cache-Control', 'no-store');
    return rotated;
  });

  app.delete('/api/v1/accounts/:id/keys/:keyId', async (req) => {
    const { id, keyId } = req.params as { id: string; keyId: string };
    const keys = accountService.listKeys(id, true);
    if (!keys.find(k => k.id === keyId)) {
      throw new AppError('Key not found', 'NOT_FOUND', 404);
    }
    accountService.revokeKey(keyId);
    return { ok: true };
  });

  app.get('/api/v1/accounts/:id/endpoints', async (req) => {
    const { id } = req.params as { id: string };
    const account = accountService.getAccount(id);
    const status = endpointsService.getEndpointsStatus();
    // Determine host: use config? Fallback to localhost
    const host = config.HOST || 'localhost';
    const descriptors = buildEndpointDescriptors(status, { host, poolId: account.defaultPoolId });
    const pools = poolService.listPools()
      .filter((p: any) => p.account_id === id || !p.account_id)
      .map(p => ({ id: p.id, name: p.name }));
    return {
      endpoints: descriptors,
      defaultPoolId: account.defaultPoolId,
      pools,
    };
  });
}
