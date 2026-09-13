import dotenv from 'dotenv';
import { z } from 'zod';
import { ConfigError } from '../shared/errors.js';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(8787),
  PORT_OPENAI: z.coerce.number().default(8788),
  PORT_ANTHROPIC: z.coerce.number().default(8789),
  PORT_MCP: z.coerce.number().default(8790),
  HOST: z.string().default('127.0.0.1'),
  REMOTE_ACCESS_ENABLED: z.coerce.boolean().default(false),
  DATABASE_PATH: z.string().default('./data/goalroute.db'),
  ENCRYPTION_MASTER_KEY: z.string().refine(
    (val) => {
      if (!/^[0-9a-fA-F]{64}$/.test(val)) return false;
      const bytePairs = val.toLowerCase().match(/.{2}/g) || [];
      const uniqueByteValues = new Set(bytePairs).size;
      return uniqueByteValues >= 8;
    },
    {
      message:
        'ENCRYPTION_MASTER_KEY must be a 64-character hex string (32 bytes) with sufficient randomness. ' +
        'Generate one with: openssl rand -hex 32',
    }
  ),
  ADMIN_API_TOKEN: z.string().min(1).default('dev-admin-secret-token'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  LOG_RETENTION_DAYS: z.coerce.number().positive().default(30),
  DEFAULT_PROVIDER_TIMEOUT_MS: z.coerce.number().default(30000),
  CIRCUIT_BREAKER_FAILURE_THRESHOLD: z.coerce.number().default(5),
  CIRCUIT_BREAKER_BASE_COOLDOWN_MS: z.coerce.number().default(30000),
});

export type Config = z.infer<typeof envSchema>;

function loadConfig(): Config {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const formattedErrors = result.error.errors
      .map((err) => `${err.path.join('.')}: ${err.message}`)
      .join('; ');
    throw new ConfigError(`Configuration validation failed: ${formattedErrors}`);
  }

  const config = result.data;
  if (config.NODE_ENV === 'production' && config.ADMIN_API_TOKEN === 'dev-admin-secret-token') {
    throw new ConfigError('ADMIN_API_TOKEN must be explicitly configured in production environment');
  }

  return config;
}

let cachedConfig: Config | null = null;

export function getConfig(): Config {
  if (!cachedConfig) {
    cachedConfig = loadConfig();
  }
  return cachedConfig;
}

export function resetConfigForTest(override?: Partial<Config>): Config {
  if (override) {
    cachedConfig = envSchema.parse({ ...process.env, ...override });
  } else {
    cachedConfig = null;
  }
  return getConfig();
}
