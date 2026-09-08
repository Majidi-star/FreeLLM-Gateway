export interface QuotaWindowInput {
  currentUsage: number;
  previousUsage: number;
  windowSeconds: number;
  nowMs: number;
}

export function getWindowStart(nowMs: number, windowSeconds: number): number {
  const windowMs = windowSeconds * 1000;
  return Math.floor(nowMs / windowMs) * windowMs;
}

export function computeSlidingWindowUsage(input: QuotaWindowInput): number {
  const windowMs = input.windowSeconds * 1000;
  const windowStart = getWindowStart(input.nowMs, input.windowSeconds);
  const elapsedIntoWindow = input.nowMs - windowStart;

  const weight = Math.max(0, 1 - elapsedIntoWindow / windowMs);
  const usage = input.currentUsage + input.previousUsage * weight;

  return Math.max(0, usage);
}

export function wouldQuotaExceed(
  limitValue: number,
  input: QuotaWindowInput,
  incomingAmount: number
): boolean {
  const projectedUsage = computeSlidingWindowUsage(input) + incomingAmount;
  return projectedUsage > limitValue;
}
