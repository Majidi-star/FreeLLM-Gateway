import { PoolStepInfo, RoutingPolicyFunction } from '../types.js';

export const fillFirstPolicy: RoutingPolicyFunction = (steps: PoolStepInfo[]): PoolStepInfo[] => {
  return [...steps].sort((a, b) => a.orderIndex - b.orderIndex);
};
