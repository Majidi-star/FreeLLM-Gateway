import pino from 'pino';

export const SENSITIVE_KEYS = [
  'api_key',
  'apikey',
  'key',
  'token',
  'secret',
  'password',
  'authorization',
  'auth',
  'bearer',
  'credential',
  'credential_enc',
  'master_key',
  'encryption_master_key',
  'private_key',
];

export function redactSensitiveData(obj: unknown): unknown {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === 'string') {
    // Redact bearer tokens or API key-like patterns in raw strings if needed
    if (/bearer\s+[a-zA-Z0-9_\-\.]+/i.test(obj)) {
      return obj.replace(/(bearer\s+)[a-zA-Z0-9_\-\.]+/gi, '$1[REDACTED]');
    }
    return obj;
  }

  if (typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => redactSensitiveData(item));
  }

  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const lowerKey = key.toLowerCase();
    const isSensitive = SENSITIVE_KEYS.some((sensitive) => lowerKey.includes(sensitive));

    if (isSensitive) {
      redacted[key] = '[REDACTED]';
    } else {
      redacted[key] = redactSensitiveData(value);
    }
  }

  return redacted;
}

export function createLogger(level: string = process.env.LOG_LEVEL || 'info') {
  return pino({
    level,
    redact: {
      paths: [
        '*.apiKey',
        '*.api_key',
        '*.key',
        '*.token',
        '*.secret',
        '*.password',
        '*.authorization',
        '*.auth',
        '*.credential',
        '*.credential_enc',
        'headers.authorization',
        'headers.cookie',
        'query.key',
        'query.token',
        'query.api_key',
      ],
      censor: '[REDACTED]',
    },
    serializers: {
      err: pino.stdSerializers.err,
      req: pino.stdSerializers.req,
      res: pino.stdSerializers.res,
    },
    formatters: {
      log(object) {
        return redactSensitiveData(object) as Record<string, unknown>;
      },
    },
  });
}

export const logger = createLogger();
