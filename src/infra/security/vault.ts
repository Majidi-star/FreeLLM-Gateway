import crypto from 'crypto';
import { getConfig } from '../config.js';
import { VaultError } from '../../shared/errors.js';

export interface EncryptedPayload {
  ciphertext: Buffer;
  iv: Buffer;
  tag: Buffer;
}

export function encryptCredential(plaintext: string, masterKeyHex?: string): EncryptedPayload {
  try {
    const keyHex = masterKeyHex || getConfig().ENCRYPTION_MASTER_KEY;
    const key = Buffer.from(keyHex, 'hex');

    if (key.length !== 32) {
      throw new VaultError('Master encryption key must be exactly 32 bytes (64 hex characters)');
    }

    const iv = crypto.randomBytes(12); // 96-bit IV for AES-GCM
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf-8'),
      cipher.final(),
    ]);

    const tag = cipher.getAuthTag();

    return { ciphertext, iv, tag };
  } catch (err: any) {
    if (err instanceof VaultError) throw err;
    throw new VaultError(`Failed to encrypt credential: ${err.message}`);
  }
}

export function decryptCredential(payload: EncryptedPayload, masterKeyHex?: string): string {
  try {
    const keyHex = masterKeyHex || getConfig().ENCRYPTION_MASTER_KEY;
    const key = Buffer.from(keyHex, 'hex');

    if (key.length !== 32) {
      throw new VaultError('Master encryption key must be exactly 32 bytes (64 hex characters)');
    }

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, payload.iv);
    decipher.setAuthTag(payload.tag);

    const plaintext = Buffer.concat([
      decipher.update(payload.ciphertext),
      decipher.final(),
    ]).toString('utf-8');

    return plaintext;
  } catch (err: any) {
    if (err instanceof VaultError) throw err;
    throw new VaultError(`Failed to decrypt credential (invalid key or corrupted ciphertext): ${err.message}`);
  }
}
