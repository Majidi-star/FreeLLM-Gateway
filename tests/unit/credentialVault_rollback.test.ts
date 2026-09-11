import { formatCleanError } from '../../src/web/components/vault/CredentialVault';

describe('CredentialVault rollback utilities', () => {
  test('formatCleanError returns default message for empty input', () => {
    expect(formatCleanError(undefined)).toBe('Verification failed');
    expect(formatCleanError(null)).toBe('Verification failed');
    expect(formatCleanError('')).toBe('Verification failed');
  });

  test('formatCleanError trims and returns string for non‑empty input', () => {
    const raw = '  [PROVIDER_ERROR] status=401 type=JSON snippet={"msg":"Invalid API key"}  ';
    const cleaned = formatCleanError(raw);
    expect(cleaned).toContain('Invalid API key');
    expect(cleaned).not.toContain('PROVIDER_ERROR');
  });
});
