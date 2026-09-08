import { PoolStepInfo, RoutingPolicyFunction } from '../types.js';

export const fastestPolicy: RoutingPolicyFunction = (steps: PoolStepInfo[]): PoolStepInfo[] => {
  return [...steps].sort((a, b) => {
    const ttftA = a.benchTtftMs || 1000;
    const ttftB = b.benchTtftMs || 1000;
    return ttftA - ttftB;
  });
};
