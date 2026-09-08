export interface CooldownConfig {
  baseApiKeyMs?: number;   // default 3000ms
  baseOAuthMs?: number;    // default 5000ms
  maxCooldownMs?: number;  // default 30000ms
}

export function calculateCooldownMs(
  authType: 'api_key' | 'oauth' | 'keyless' = 'api_key',
  failureIndex: number = 0,
  retryAfterSeconds?: number,
  config?: CooldownConfig
): number {
  const baseApiKeyMs = config?.baseApiKeyMs ?? 3000;
  const baseOAuthMs = config?.baseOAuthMs ?? 5000;
  const maxCooldownMs = config?.maxCooldownMs ?? 30000;

  if (retryAfterSeconds && retryAfterSeconds > 0) {
    return Math.min(retryAfterSeconds * 1000, maxCooldownMs);
  }

  const base = authType === 'oauth' ? baseOAuthMs : baseApiKeyMs;
  return Math.min(base * Math.pow(2, failureIndex), maxCooldownMs);
}

export class CooldownTracker {
  private failureIndex = 0;
  private cooldownUntil = 0;
  private baseApiKeyMs: number;
  private baseOAuthMs: number;
  private maxCooldownMs: number;

  constructor(
    private authType: 'api_key' | 'oauth' | 'keyless' = 'api_key',
    config?: CooldownConfig
  ) {
    this.baseApiKeyMs = config?.baseApiKeyMs ?? 3000;
    this.baseOAuthMs = config?.baseOAuthMs ?? 5000;
    this.maxCooldownMs = config?.maxCooldownMs ?? 30000;
  }

  public recordFailure(now: number, retryAfterSeconds?: number): number {
    const durationMs = calculateCooldownMs(this.authType, this.failureIndex, retryAfterSeconds, {
      baseApiKeyMs: this.baseApiKeyMs,
      baseOAuthMs: this.baseOAuthMs,
      maxCooldownMs: this.maxCooldownMs,
    });

    if (!retryAfterSeconds || retryAfterSeconds <= 0) {
      this.failureIndex += 1;
    }

    this.cooldownUntil = now + durationMs;
    return this.cooldownUntil;
  }

  public recordSuccess(): void {
    this.failureIndex = 0;
    this.cooldownUntil = 0;
  }

  public isActive(now: number): boolean {
    return now < this.cooldownUntil;
  }

  public getRemainingMs(now: number): number {
    return Math.max(0, this.cooldownUntil - now);
  }
}
