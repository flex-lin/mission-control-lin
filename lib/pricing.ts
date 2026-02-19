/** Per-1M-token pricing (USD) for Anthropic models */
export interface ModelPricing {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
}

function pricing(input: number, output: number): ModelPricing {
  return {
    input,
    output,
    cacheRead: input * 0.1,
    cacheCreation: input * 1.25,
  };
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  // Claude 4.x family
  "claude-opus-4-6": pricing(15, 75),
  "claude-opus-4-6-20250219": pricing(15, 75),
  "claude-sonnet-4-6": pricing(3, 15),
  "claude-sonnet-4-6-20250219": pricing(3, 15),
  "claude-haiku-4-5-20251001": pricing(0.8, 4),
  "claude-haiku-4-5-latest": pricing(0.8, 4),

  // Claude 4.5 family
  "claude-opus-4-5-20250219": pricing(15, 75),
  "claude-sonnet-4-5-20241022": pricing(3, 15),

  // Claude 3.5 family
  "claude-3-5-sonnet-20241022": pricing(3, 15),
  "claude-3-5-sonnet-latest": pricing(3, 15),
  "claude-3-5-haiku-20241022": pricing(0.8, 4),
  "claude-3-5-haiku-latest": pricing(0.8, 4),

  // Claude 3 family
  "claude-3-opus-20240229": pricing(15, 75),
  "claude-3-opus-latest": pricing(15, 75),
  "claude-3-sonnet-20240229": pricing(3, 15),
  "claude-3-haiku-20240307": pricing(0.25, 1.25),
};

const DEFAULT_PRICING = pricing(3, 15);
const warnedModels = new Set<string>();

export function computeCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens?: number,
  cacheCreationTokens?: number,
): number {
  let p = MODEL_PRICING[model];
  if (!p) {
    if (!warnedModels.has(model)) {
      console.warn(`[pricing] Unknown model: "${model}", using default pricing`);
      warnedModels.add(model);
    }
    p = DEFAULT_PRICING;
  }

  let cost =
    (inputTokens / 1_000_000) * p.input +
    (outputTokens / 1_000_000) * p.output;

  if (cacheReadTokens) {
    cost += (cacheReadTokens / 1_000_000) * p.cacheRead;
  }
  if (cacheCreationTokens) {
    cost += (cacheCreationTokens / 1_000_000) * p.cacheCreation;
  }

  return cost;
}
