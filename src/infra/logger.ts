import pino from 'pino';

export const SENSITIVE_KEYS = [
  'api_key',
  'api-key',
  'x-api-key',
  'x-goog-api-key',
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

export function redactSensitiveData(obj: unknown, seen = new WeakSet()): unknown {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === 'string') {
    let result = obj;

    if (/bearer\s+[a-zA-Z0-9_\-\.]+/i.test(result)) {
      result = result.replace(/(bearer\s+)[a-zA-Z0-9_\-\.]+/gi, '$1[REDACTED]');
    }

    if (/sk-ant-[A-Za-z0-9_-]{20,}/.test(result)) {
      result = result.replace(/sk-ant-[A-Za-z0-9_-]{20,}/g, 'sk-ant-[REDACTED]');
    }

    if (/sk-[A-Za-z0-9_-]{16,}/.test(result)) {
      result = result.replace(/sk-[A-Za-z0-9_-]{16,}/g, 'sk-[REDACTED]');
    }

    if (/AIza[0-9A-Za-z_-]{30,}/.test(result)) {
      result = result.replace(/AIza[0-9A-Za-z_-]{30,}/g, 'AIza[REDACTED]');
    }

    if (/gsk_[A-Za-z0-9]{20,}/.test(result)) {
      result = result.replace(/gsk_[A-Za-z0-9]{20,}/g, 'gsk_[REDACTED]');
    }

    if (/hf_[A-Za-z0-9]{20,}/.test(result)) {
      result = result.replace(/hf_[A-Za-z0-9]{20,}/g, 'hf_[REDACTED]');
    }

    if (/(?:[?&]|%26)?(?:api_key|key|token|auth)(?:=|%3D)[^&\s]+/i.test(result)) {
      result = result.replace(/((?:[?&]|%26)?(?:api_key|key|token|auth)(?:=|%3D))[^&\s]+/gi, '$1[REDACTED]');
    }

    return result;
  }

  if (typeof obj !== 'object') {
    return obj;
  }

  if (seen.has(obj)) {
    return '[CIRCULAR]';
  }
  seen.add(obj);

  if (Array.isArray(obj)) {
    return obj.map((item) => redactSensitiveData(item, seen));
  }

  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const lowerKey = key.toLowerCase();
    const isSensitive = SENSITIVE_KEYS.some((sensitive) => lowerKey.includes(sensitive));

    if (isSensitive) {
      redacted[key] = '[REDACTED]';
    } else {
      redacted[key] = redactSensitiveData(value, seen);
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
