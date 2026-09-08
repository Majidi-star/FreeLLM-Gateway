import { RoutingPolicyName } from '../../shared/types.js';
import { RoutingPolicyFunction } from './types.js';
import { fillFirstPolicy } from './policies/fillFirst.js';
import { balancedPolicy } from './policies/balanced.js';
import { fastestPolicy } from './policies/fastest.js';
import { cheapestPolicy } from './policies/cheapest.js';
import { autoScorePolicy } from './policies/autoScore.js';

export function resolvePolicyFunction(policyName: RoutingPolicyName): RoutingPolicyFunction {
  switch (policyName) {
    case 'fill_first':
      return fillFirstPolicy;
    case 'balanced':
      return balancedPolicy;
    case 'fastest':
      return fastestPolicy;
    case 'cheapest':
      return cheapestPolicy;
    case 'auto_score':
      return autoScorePolicy;
    default:
      return autoScorePolicy;
  }
}
