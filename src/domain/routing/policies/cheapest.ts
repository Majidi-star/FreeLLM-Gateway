import { PoolStepInfo, RoutingPolicyFunction } from '../types.js';

export const cheapestPolicy: RoutingPolicyFunction = (steps: PoolStepInfo[]): PoolStepInfo[] => {
  return [...steps].sort((a, b) => a.costPer1kUsd - b.costPer1kUsd);
};
