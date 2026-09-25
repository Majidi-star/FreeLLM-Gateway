export function computeCostUsd(model: { cost_input_per_1k: number; cost_output_per_1k: number },
                               tokensIn: number, tokensOut: number): number {
  const cost = (tokensIn / 1000) * model.cost_input_per_1k
             + (tokensOut / 1000) * model.cost_output_per_1k;
  return Math.round(cost * 1e8) / 1e8;   // 8dp — free tiers are 0, paid tiers are fractions of a cent
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}