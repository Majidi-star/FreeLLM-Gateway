import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { StatsService, Filters } from '../../services/statsService.js';
import { AppError } from '../../shared/errors.js';

const statsQuerySchema = z.object({
  accountId: z.string().optional(),
  apiKeyId: z.string().optional(),
  poolId: z.string().optional(),
  provider: z.string().optional(),
  model: z.string().optional(),
  from: z.coerce.number().int().optional(),
  to: z.coerce.number().int().optional(),
  granularity: z.enum(['hour', 'day']).optional(),
});

const breakdownQuerySchema = statsQuerySchema.extend({
  dimension: z.enum(['provider', 'model', 'key', 'pool', 'account']),
});

const requestLogsQuerySchema = z.object({
  accountId: z.string().optional(),
  apiKeyId: z.string().optional(),
  poolId: z.string().optional(),
  provider: z.string().optional(),
  model: z.string().optional(),
  status: z.string().optional(),
  from: z.coerce.number().int().optional(),
  to: z.coerce.number().int().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

const defaultWindow = (): { from: number; to: number } => {
  const to = Date.now();
  const from = to - 24 * 60 * 60 * 1000;
  return { from, to };
};

function parseFilters(query: z.infer<typeof statsQuerySchema>): Filters {
  return {
    accountId: query.accountId,
    apiKeyId: query.apiKeyId,
    poolId: query.poolId,
    provider: query.provider,
    model: query.model,
  };
}

export function registerStatsRoutes(app: FastifyInstance, statsService: StatsService): void {
  // GET /api/v1/stats/summary
  app.get('/api/v1/stats/summary', async (req, reply) => {
    const query = statsQuerySchema.parse(req.query);
    const { from, to } = query.from !== undefined && query.to !== undefined
      ? { from: query.from, to: query.to }
      : defaultWindow();
    const filters = parseFilters(query);
    return statsService.summary(filters, from, to, query.granularity);
  });

  // GET /api/v1/stats/timeseries
  app.get('/api/v1/stats/timeseries', async (req, reply) => {
    const query = statsQuerySchema.parse(req.query);
    const { from, to } = query.from !== undefined && query.to !== undefined
      ? { from: query.from, to: query.to }
      : defaultWindow();
    const filters = parseFilters(query);
    return statsService.timeseries(filters, from, to, query.granularity);
  });

  // GET /api/v1/stats/breakdown
  app.get('/api/v1/stats/breakdown', async (req, reply) => {
    let query: any;
    try {
      query = breakdownQuerySchema.parse(req.query);
    } catch (err: any) {
      throw new AppError('dimension query parameter is required and must be valid', 'VALIDATION_ERROR', 400);
    }
    const { from, to } = query.from !== undefined && query.to !== undefined
      ? { from: query.from, to: query.to }
      : defaultWindow();
    const filters = parseFilters(query);
    return statsService.breakdown(filters, from, to, query.dimension, query.granularity);
  });

  // GET /api/v1/stats/accounts/:id/overview
  app.get('/api/v1/stats/accounts/:id/overview', async (req, reply) => {
    const { id } = req.params as { id: string };
    return statsService.accountOverview(id);
  });

  // GET /api/v1/request-logs (keyset pagination)
  app.get('/api/v1/request-logs', async (req, reply) => {
    const query = requestLogsQuerySchema.parse(req.query);
    const { from, to } = query.from !== undefined && query.to !== undefined
      ? { from: query.from, to: query.to }
      : defaultWindow();
    if (from >= to) {
      throw new AppError('from must be less than to', 'VALIDATION_ERROR', 400);
    }
    const maxWindowMs = 366 * 24 * 60 * 60 * 1000;
    if (to - from > maxWindowMs) {
      throw new AppError('Window exceeds maximum of 366 days', 'VALIDATION_ERROR', 400);
    }
    return statsService.requestLogs({
      accountId: query.accountId,
      apiKeyId: query.apiKeyId,
      poolId: query.poolId,
      provider: query.provider,
      model: query.model,
      status: query.status,
      from,
      to,
      cursor: query.cursor,
      limit: query.limit,
    });
  });

  // GET /api/v1/request-logs/:id
  app.get('/api/v1/request-logs/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const result = statsService.requestLogById(id);
    if (!result) {
      throw new AppError('Request log not found', 'NOT_FOUND', 404);
    }
    return result;
  });
}