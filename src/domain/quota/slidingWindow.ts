export interface QuotaWindowInput {
  currentUsage: number;
  previousUsage: number;
  windowSeconds: number;
  nowMs: number;
}

export function computeSlidingWindowUsage(input: QuotaWindowInput): number {
  const windowMs = input.windowSeconds * 1000;
  const windowStart = Math.floor(input.nowMs / windowMs) * windowMs;
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
