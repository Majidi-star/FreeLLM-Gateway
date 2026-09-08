import { describe, it, expect } from 'vitest';
import { CooldownTracker } from './cooldown.js';

describe('CooldownTracker', () => {
  it('computes exponential backoff for API key connections', () => {
    const tracker = new CooldownTracker('api_key', { baseApiKeyMs: 3000, maxCooldownMs: 30000 });
    const now = 100000;

    // Failure 0: 3000 * 2^0 = 3000ms
    let until = tracker.recordFailure(now);
    expect(until).toBe(now + 3000);
    expect(tracker.isActive(now + 2900)).toBe(true);
    expect(tracker.isActive(now + 3000)).toBe(false);

    // Failure 1: 3000 * 2^1 = 6000ms
    until = tracker.recordFailure(now);
    expect(until).toBe(now + 6000);

    // Failure 2: 3000 * 2^2 = 12000ms
    until = tracker.recordFailure(now);
    expect(until).toBe(now + 12000);
  });

  it('overrides computed cooldown with upstream Retry-After header', () => {
    const tracker = new CooldownTracker('api_key');
    const now = 100000;

    // Upstream sends Retry-After: 45 (seconds) -> capped at maxCooldownMs 30000ms
    const until = tracker.recordFailure(now, 10); // 10s = 10000ms
    expect(until).toBe(now + 10000);
  });

  it('resets failureIndex on success', () => {
    const tracker = new CooldownTracker('api_key', { baseApiKeyMs: 3000 });
    const now = 100000;

    tracker.recordFailure(now);
    tracker.recordFailure(now);
    tracker.recordSuccess();

    expect(tracker.isActive(now)).toBe(false);
    const until = tracker.recordFailure(now);
    expect(until).toBe(now + 3000); // Reset back to base 3000ms
  });
});
