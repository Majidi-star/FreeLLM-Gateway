import { describe, it, expect, beforeEach } from 'vitest';
import { CircuitBreaker, TestClock } from './circuitBreaker.js';

describe('CircuitBreaker FSM', () => {
  let clock: TestClock;

  beforeEach(() => {
    clock = new TestClock(100000);
  });

  it('starts in CLOSED state and allows requests', () => {
    const cb = new CircuitBreaker({ failureThreshold: 3 }, clock);
    expect(cb.getState()).toBe('closed');
    expect(cb.allowRequest()).toBe(true);
  });

  it('transitions from CLOSED to OPEN after N consecutive failures', () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, baseCooldownMs: 10000 }, clock);

    cb.recordFailure();
    expect(cb.getState()).toBe('closed');
    cb.recordFailure();
    expect(cb.getState()).toBe('closed');

    cb.recordFailure(); // 3rd failure
    expect(cb.getState()).toBe('open');
    expect(cb.allowRequest()).toBe(false);
  });

  it('transitions from OPEN to HALF_OPEN after cooldown elapses using TestClock', () => {
    const cb = new CircuitBreaker({ failureThreshold: 2, baseCooldownMs: 5000 }, clock);

    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState()).toBe('open');
    expect(cb.allowRequest()).toBe(false);

    // Advance clock by 4000ms (cooldown not yet reached)
    clock.advance(4000);
    expect(cb.getState()).toBe('open');
    expect(cb.allowRequest()).toBe(false);

    // Advance clock by 1001ms (total 5001ms >= 5000ms cooldown)
    clock.advance(1001);
    expect(cb.getState()).toBe('half_open');
    expect(cb.allowRequest()).toBe(true); // Probe request allowed
    expect(cb.allowRequest()).toBe(false); // Second request blocked while probe in flight
  });

  it('transitions HALF_OPEN to CLOSED on successful probe', () => {
    const cb = new CircuitBreaker({ failureThreshold: 2, baseCooldownMs: 5000 }, clock);

    cb.recordFailure();
    cb.recordFailure();
    clock.advance(5000); // Now half_open

    expect(cb.allowRequest()).toBe(true); // Probe request
    cb.recordSuccess(); // Probe succeeded

    expect(cb.getState()).toBe('closed');
    expect(cb.getSnapshot().consecutiveFailures).toBe(0);
    expect(cb.allowRequest()).toBe(true);
  });

  it('transitions HALF_OPEN back to OPEN with doubled exponential cooldown on failed probe', () => {
    const cb = new CircuitBreaker({ failureThreshold: 2, baseCooldownMs: 5000, maxCooldownMs: 60000 }, clock);

    cb.recordFailure();
    cb.recordFailure();
    clock.advance(5000); // Now half_open

    expect(cb.allowRequest()).toBe(true); // Probe request
    cb.recordFailure(); // Probe failed!

    expect(cb.getState()).toBe('open');
    expect(cb.getSnapshot().currentCooldownMs).toBe(10000); // 5000 * 2 = 10000ms

    // Must wait 10,000ms now
    clock.advance(5000);
    expect(cb.getState()).toBe('open');
    clock.advance(5001);
    expect(cb.getState()).toBe('half_open');
  });
});
