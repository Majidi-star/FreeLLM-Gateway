import { describe, it, expect, beforeEach } from 'vitest';
import { resetConfigForTest } from '../../src/infra/config.js';

describe('Remote access / default token guard', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_MASTER_KEY =
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  });

  it('throws when REMOTE_ACCESS_ENABLED=true and ADMIN_API_TOKEN is left at the default', () => {
    expect(() =>
      resetConfigForTest({
        NODE_ENV: 'development',
        REMOTE_ACCESS_ENABLED: true,
        ADMIN_API_TOKEN: 'dev-admin-secret-token',
      })
    ).toThrow(/REMOTE_ACCESS_ENABLED=true requires a non-default ADMIN_API_TOKEN/);
  });

  it('allows REMOTE_ACCESS_ENABLED=true when a non-default ADMIN_API_TOKEN is set', () => {
    expect(() =>
      resetConfigForTest({
        NODE_ENV: 'development',
        REMOTE_ACCESS_ENABLED: true,
        ADMIN_API_TOKEN: 'a-real-generated-secret-token-value',
      })
    ).not.toThrow();
  });
});
