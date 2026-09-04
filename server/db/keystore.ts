/**
 * AES-256-GCM envelope encryption for provider API keys at rest.
 *
 * The master key is generated once (32 random bytes) and stored with 0600
 * permissions next to the SQLite database. Every secret is encrypted with a
 * fresh per-value IV + GCM auth tag, so a leaked database by itself reveals
 * nothing. Keys are NEVER written to logs.
 *
 * Env overrides let tests point at an ephemeral data dir / key file.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;      // 96-bit IV — optimal for GCM
const TAG_LEN = 16;     // 128-bit auth tag
const KEY_LEN = 32;     // 256-bit key

function dataDir(): string {
  return process.env.GATEWAY_DATA_DIR ?? path.join(process.cwd(), 'data');
}
function keyFile(): string {
  return process.env.GATEWAY_MASTER_KEY_PATH ?? path.join(dataDir(), '.gateway-master-key');
}

const cache_ = new Map<string, Buffer>();

/** Resolve (and on first run, securely create) the local master key. */
export function masterKey(): Buffer {
  const kf = keyFile();
  const hit = cache_.get(kf);
  if (hit) return hit;
  fs.mkdirSync(path.dirname(kf), { recursive: true });
  if (fs.existsSync(kf)) {
    const raw = fs.readFileSync(kf);
    if (raw.length !== KEY_LEN) {
      throw new Error(`Master key file ${kf} is corrupted (length=${raw.length}). Refusing to guess — aborting.`);
    }
    cache_.set(kf, raw);
    return raw;
  }
  const key = crypto.randomBytes(KEY_LEN);
  const tmp = `${kf}.tmp`;
  fs.writeFileSync(tmp, key, { mode: 0o600 });
  fs.renameSync(tmp, kf);
  try { fs.chmodSync(kf, 0o600); } catch { /* best-effort; some FS ignore chmod */ }
  cache_.set(kf, key);
  return key;
}

export function encryptSecret(plaintext: string | null | undefined): string | null {
  if (!plaintext) return null;
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, masterKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

export function decryptSecret(blob: string | null | undefined): string {
  if (!blob) return '';
  const buf = Buffer.from(blob, 'base64');
  if (buf.length < IV_LEN + TAG_LEN) return '';
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const enc = buf.subarray(IV_LEN + TAG_LEN);
  const de = crypto.createDecipheriv(ALGO, masterKey(), iv);
  de.setAuthTag(tag);
  return Buffer.concat([de.update(enc), de.final()]).toString('utf8');
}

/** True when a blob survives a round-trip (sanity helper for tests). */
export function isEncrypted(blob: string | null | undefined): boolean {
  if (!blob) return false;
  try { return decryptSecret(blob).length > 0; } catch { return false; }
}
