export interface CooldownConfig {
  baseApiKeyMs?: number;   // default 3000ms
  baseOAuthMs?: number;    // default 5000ms
  maxCooldownMs?: number;  // default 30000ms
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
    let durationMs: number;

    if (retryAfterSeconds && retryAfterSeconds > 0) {
      durationMs = Math.min(retryAfterSeconds * 1000, this.maxCooldownMs);
    } else {
      const base = this.authType === 'oauth' ? this.baseOAuthMs : this.baseApiKeyMs;
      durationMs = Math.min(base * Math.pow(2, this.failureIndex), this.maxCooldownMs);
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
