import type { FastifyRequest, FastifyReply, onRequestHookHandler } from 'fastify';
import type { AuthService } from '../services/authService.js';
import type { Config } from '../infra/config.js';
import type { TenantRateLimiter } from '../domain/quota/tenantRateLimiter.js';
import { safeCompareTokens } from '../infra/security/constantTime.js';
import { URL } from 'url';

declare module 'fastify' {
  interface FastifyRequest {
    auth?: import('../domain/auth/types.js').AuthContext;
  }
}

export function buildTrafficAuthHook(deps: {
  authService: AuthService;
  config: Config;
  rateLimiter: TenantRateLimiter;
}): onRequestHookHandler {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const authHeader = req.headers['authorization'];
    const xApiKey = req.headers['x-api-key'];
    let token: string | undefined;

    if (authHeader) {
      token = authHeader.replace(/^Bearer\s+/i, '').trim();
    } else if (typeof xApiKey === 'string' && xApiKey.trim()) {
      token = xApiKey.trim();
    }

    const ctx = deps.authService.resolveBearer(token, deps.config.ADMIN_API_TOKEN);

    if (ctx.kind === 'anonymous') {
      const isDevAllowed =
        deps.config.NODE_ENV === 'development' && process.env.ALLOW_ANONYMOUS_DEV === 'true';
      if (!isDevAllowed) {
        return reply.status(401).send({ error: { message: 'Unauthorized', type: 'authentication_error' } });
      }
    }

    req.auth = ctx;

    if (ctx.kind === 'account') {
      try {
        deps.rateLimiter.checkOrThrow(ctx);
      } catch (err: any) {
        if (err && typeof err === 'object' && err.code === 'RATE_LIMIT_EXCEEDED') {
          const retryAfter = err.details?.retryAfterSeconds || 60;
          reply.header('Retry-After', String(retryAfter));
          return reply.status(429).send({
            error: {
              message: err.message || 'Rate limit exceeded',
              type: 'rate_limit_error',
              code: 'RATE_LIMIT_EXCEEDED',
            },
          });
        }
        throw err;
      }
    }

    deps.authService.touch(ctx);
  };
}

export function buildAdminAuthHook(deps: { config: Config }): onRequestHookHandler {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const url = req.url;
    const isGetEndpoints =
      req.method === 'GET' &&
      (url.startsWith('/api/v1/system/endpoints') || url.includes('/system/endpoints'));
    const isLocalhost =
      req.ip === '127.0.0.1' || req.ip === '::1' || req.ip === '::ffff:127.0.0.1';
    if (
      (isGetEndpoints && !deps.config.REMOTE_ACCESS_ENABLED) ||
      url.startsWith('/api/v1/health') ||
      url.startsWith('/api/v1/mcp/settings') ||
      (url.startsWith('/api/v1/system/token') && isLocalhost)
    ) {
      return;
    }

    if (url.startsWith('/api/v1/') || url.startsWith('/mcp/')) {
      const parsedUrl = new URL(req.url, 'http://localhost');
      const queryToken = parsedUrl.searchParams.get('token');

      if (url.startsWith('/api/v1/request-logs/stream')) {
        const isStreamTokenValid = safeCompareTokens(queryToken || '', deps.config.ADMIN_API_TOKEN);
        if (isStreamTokenValid) {
          return;
        }
      }

      const authHeader = req.headers['authorization'];
      const token = authHeader ? authHeader.replace(/^Bearer\s+/i, '').trim() : '';

      const isTokenValid = safeCompareTokens(token, deps.config.ADMIN_API_TOKEN);

      if (!isTokenValid) {
        return reply.status(401).send({ error: { message: 'Unauthorized', type: 'authentication_error' } });
      }
    }
  };
}
