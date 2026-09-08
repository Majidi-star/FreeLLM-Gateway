import { PoolStepInfo, RoutingPolicyFunction } from '../types.js';

export const balancedPolicy: RoutingPolicyFunction = (steps: PoolStepInfo[]): PoolStepInfo[] => {
  // Sort primary role steps by remaining quota percentage * weight descending, followed by backups
  return [...steps].sort((a, b) => {
    if (a.role !== b.role) {
      if (a.role === 'primary') return -1;
      if (b.role === 'primary') return 1;
    }
    const scoreA = a.quotaRemainingPct * a.weight;
    const scoreB = b.quotaRemainingPct * b.weight;
    return scoreB - scoreA;
  });
};
