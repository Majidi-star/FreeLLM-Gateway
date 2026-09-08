import { describe, it, expect } from 'vitest';
import { redactSensitiveData } from './logger.js';

describe('Logger Redaction', () => {
  it('redacts sensitive keys in flat objects', () => {
    const input = {
      user: 'alice',
      api_key: 'sk-1234567890abcdef',
      token: 'bearer-xyz',
      password: 'super-secret-pass',
    };

    const redacted = redactSensitiveData(input) as Record<string, unknown>;

    expect(redacted.user).toBe('alice');
    expect(redacted.api_key).toBe('[REDACTED]');
    expect(redacted.token).toBe('[REDACTED]');
    expect(redacted.password).toBe('[REDACTED]');
  });

  it('redacts sensitive keys in deeply nested objects and arrays', () => {
    const input = {
      level1: {
        normal: 'data',
        level2: {
          secret: 'topsecret',
          providers: [
            { slug: 'groq', apiKey: 'gsk_999999' },
            { slug: 'openrouter', bearer: 'or-111111' },
          ],
        },
      },
    };

    const redacted = redactSensitiveData(input) as any;

    expect(redacted.level1.normal).toBe('data');
    expect(redacted.level1.level2.secret).toBe('[REDACTED]');
    expect(redacted.level1.level2.providers[0].apiKey).toBe('[REDACTED]');
    expect(redacted.level1.level2.providers[1].bearer).toBe('[REDACTED]');
  });

  it('redacts Bearer tokens in raw string values', () => {
    const input = {
      authHeader: 'Bearer my-secret-jwt-token-123',
    };

    const redacted = redactSensitiveData(input) as any;

    expect(redacted.authHeader).toBe('[REDACTED]');
  });
});
