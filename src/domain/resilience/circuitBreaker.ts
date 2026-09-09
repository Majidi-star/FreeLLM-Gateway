import { HealthState } from '../../shared/types.js';

export interface Clock {
  now(): number;
}

export class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }
}

export class TestClock implements Clock {
  private currentTime: number;

  constructor(initialTime = 1000000000000) {
    this.currentTime = initialTime;
  }

  now(): number {
    return this.currentTime;
  }

  advance(ms: number): void {
    this.currentTime += ms;
  }

  set(time: number): void {
    this.currentTime = time;
  }
}

export interface CircuitBreakerConfig {
  failureThreshold?: number; // default 5
  baseCooldownMs?: number;   // default 30,000ms
  maxCooldownMs?: number;    // default 300,000ms
}

export interface CircuitBreakerSnapshot {
  state: HealthState;
  consecutiveFailures: number;
  openedAt: number | null;
  currentCooldownMs: number;
}

export class CircuitBreaker {
  private state: HealthState = 'closed';
  private consecutiveFailures = 0;
  private openedAt: number | null = null;
  private currentCooldownMs: number;
  private failureThreshold: number;
  private maxCooldownMs: number;
  private halfOpenProbeActive = false;

  constructor(
    config?: CircuitBreakerConfig,
    private clock: Clock = new SystemClock(),
    initialState?: Partial<CircuitBreakerSnapshot>
  ) {
    this.failureThreshold = config?.failureThreshold ?? 5;
    this.currentCooldownMs = config?.baseCooldownMs ?? 30000;
    this.maxCooldownMs = config?.maxCooldownMs ?? 300000;

    if (initialState) {
      this.state = initialState.state ?? 'closed';
      this.consecutiveFailures = initialState.consecutiveFailures ?? 0;
      this.openedAt = initialState.openedAt ?? null;
      if (initialState.currentCooldownMs) {
        this.currentCooldownMs = initialState.currentCooldownMs;
      }
    }
  }

  public getState(): HealthState {
    const now = this.clock.now();
    if (this.state === 'open' && this.openedAt !== null) {
      if (now >= this.openedAt + this.currentCooldownMs) {
        this.state = 'half_open';
        this.halfOpenProbeActive = false;
      }
    }
    return this.state;
  }

  public allowRequest(): boolean {
    const currentState = this.getState();
    if (currentState === 'closed') {
      return true;
    }
    if (currentState === 'half_open') {
      // Allow exactly one probe request
      if (!this.halfOpenProbeActive) {
        this.halfOpenProbeActive = true;
        return true;
      }
      return false; // Skip secondary requests while probe in flight
    }
    return false; // State is OPEN
  }

  public releaseProbe(): void {
    if (this.state === 'half_open') {
      this.halfOpenProbeActive = false;
    }
  }

  public recordSuccess(): void {
    this.state = 'closed';
    this.consecutiveFailures = 0;
    this.openedAt = null;
    this.halfOpenProbeActive = false;
  }

  public recordFailure(): void {
    const currentState = this.getState();

    if (currentState === 'half_open') {
      // Probe failed -> return to OPEN, double cooldown
      this.state = 'open';
      this.openedAt = this.clock.now();
      this.currentCooldownMs = Math.min(this.currentCooldownMs * 2, this.maxCooldownMs);
      this.halfOpenProbeActive = false;
      return;
    }

    if (currentState === 'closed') {
      this.consecutiveFailures += 1;
      if (this.consecutiveFailures >= this.failureThreshold) {
        this.state = 'open';
        this.openedAt = this.clock.now();
      }
    }
  }

  public getSnapshot(): CircuitBreakerSnapshot {
    return {
      state: this.getState(),
      consecutiveFailures: this.consecutiveFailures,
      openedAt: this.openedAt,
      currentCooldownMs: this.currentCooldownMs,
    };
  }
}
