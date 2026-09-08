import { describe, it, expect } from 'vitest';
import { computeSlidingWindowUsage, wouldQuotaExceed } from './slidingWindow.js';

describe('Sliding Window Quota Math', () => {
  it('computes usage accurately at window start boundary', () => {
    // 60-second window
    const windowSeconds = 60;
    const windowMs = 60 * 1000;
    const windowStart = 1000 * windowMs; // Exactly on boundary
    const nowMs = windowStart;

    // Previous window used 100 requests, current window used 10 requests so far
    const usage = computeSlidingWindowUsage({
      currentUsage: 10,
      previousUsage: 100,
      windowSeconds,
      nowMs,
    });

    // At t=0 elapsed, weight = 1 - 0 = 1.0 -> 10 + 100 * 1.0 = 110
    expect(usage).toBe(110);
  });

  it('decays previous window usage weight over time', () => {
    const windowSeconds = 60;
    const windowMs = 60 * 1000;
    const windowStart = 1000 * windowMs;

    // At 30 seconds into 60s window (halfway)
    const nowMs = windowStart + 30 * 1000;

    const usage = computeSlidingWindowUsage({
      currentUsage: 10,
      previousUsage: 100,
      windowSeconds,
      nowMs,
    });

    // weight = 1 - 30/60 = 0.5 -> 10 + 100 * 0.5 = 60
    expect(usage).toBe(60);
  });

  it('correctly calculates whether incoming request would exceed limit', () => {
    const windowSeconds = 60;
    const windowMs = 60 * 1000;
    const nowMs = 1000 * windowMs + 45 * 1000; // 75% through window

    // Weight = 1 - 45/60 = 0.25 -> 80 + 100 * 0.25 = 105
    const limitValue = 110;

    const input = {
      currentUsage: 80,
      previousUsage: 100,
      windowSeconds,
      nowMs,
    };

    expect(wouldQuotaExceed(limitValue, input, 4)).toBe(false); // 105 + 4 = 109 <= 110
    expect(wouldQuotaExceed(limitValue, input, 6)).toBe(true);  // 105 + 6 = 111 > 110
  });
});
