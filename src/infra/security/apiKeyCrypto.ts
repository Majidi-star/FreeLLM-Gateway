import { Buffer } from 'buffer';
import crypto from 'crypto';
import { getConfig } from '../config.js';

// Why HMAC and not bcrypt/argon2?
// The key is 256 bits of CSPRNG entropy — it is not guessable by brute force,
// so a slow KDF buys nothing and would add ~100ms to every single gateway request.
// The pepper (derived from the master key, which is not in the DB) is what protects
// against an offline DB-only leak.

export const KEY_PREFIX_LIVE = 'gr_live_';
export const LOOKUP_LEN = 16; // includes the 'gr_live_' prefix

let pepper: Buffer | null = null;

function getPepper(): Buffer {
  if (pepper) return pepper;
  const config = getConfig();
  const masterKey = Buffer.from(config.ENCRYPTION_MASTER_KEY, 'hex') as unknown as Buffer;
  pepper = crypto.hkdfSync('sha256', masterKey, Buffer.alloc(0), Buffer.from('goalroute-api-key-pepper-v1'), 32) as unknown as Buffer;
  return pepper;
}

export function resetPepperForTest(): void {
  pepper = null;
}

export function generateApiKey(): { plaintext: string; lookup: string; hint: string } {
  const random = crypto.randomBytes(32);
  const base64url = random.toString('base64url'); // Node's base64url omits padding.
  const plaintext = KEY_PREFIX_LIVE + base64url;
  const lookup = plaintext.slice(0, LOOKUP_LEN);
  const hint = plaintext.slice(0, 12) + '…' + plaintext.slice(-4);
  return { plaintext, lookup, hint };
}

export function hashApiKey(plaintext: string): string {
  const pepperBuf = getPepper();
  const hmac = crypto.createHmac('sha256', pepperBuf);
  hmac.update(plaintext, 'utf-8');
  return hmac.digest('hex');
}

export function verifyApiKeyHash(plaintext: string, storedHash: string): boolean {
  if (typeof plaintext !== 'string' || typeof storedHash !== 'string') return false;
  const computed = hashApiKey(plaintext);
  if (computed.length !== storedHash.length) return false;
  // timingSafeEqual requires Buffers of same length
  const buf1 = Buffer.from(computed, 'hex');
  const buf2 = Buffer.from(storedHash, 'hex');
  return crypto.timingSafeEqual(buf1, buf2);
}

export function extractLookup(plaintext: string): string | null {
  if (!plaintext || !plaintext.startsWith(KEY_PREFIX_LIVE)) return null;
  if (plaintext.length < LOOKUP_LEN) return null;
  return plaintext.slice(0, LOOKUP_LEN);
}