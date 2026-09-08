import { describe, it, expect, beforeEach } from 'vitest';
import { encryptCredential, decryptCredential } from './vault.js';
import { VaultError } from '../../shared/errors.js';

describe('Vault AES-256-GCM Credential Encryption', () => {
  const TEST_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  beforeEach(() => {
    process.env.ENCRYPTION_MASTER_KEY = TEST_KEY;
  });

  it('encrypts and decrypts strings correctly in a round-trip', () => {
    const plaintext = 'gsk_test_api_key_123456789';
    const encrypted = encryptCredential(plaintext, TEST_KEY);

    expect(encrypted.ciphertext).toBeInstanceOf(Buffer);
    expect(encrypted.iv).toBeInstanceOf(Buffer);
    expect(encrypted.tag).toBeInstanceOf(Buffer);
    expect(encrypted.iv.length).toBe(12);

    const decrypted = decryptCredential(encrypted, TEST_KEY);
    expect(decrypted).toBe(plaintext);
  });

  it('fails decryption with wrong key', () => {
    const plaintext = 'gsk_test_api_key_123456789';
    const encrypted = encryptCredential(plaintext, TEST_KEY);

    const WRONG_KEY = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
    expect(() => decryptCredential(encrypted, WRONG_KEY)).toThrow(VaultError);
  });

  it('fails encryption when key is invalid length', () => {
    const SHORT_KEY = '123456';
    expect(() => encryptCredential('secret', SHORT_KEY)).toThrow(VaultError);
  });
});
