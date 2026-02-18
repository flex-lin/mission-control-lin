import { describe, it, expect } from "vitest";
import { computeCost, MODEL_PRICING } from "./pricing";

describe("computeCost", () => {
  const model = "claude-sonnet-4-6"; // input: 3, output: 15, cacheRead: 0.3, cacheCreation: 3.75

  it("computes cost for input and output tokens only", () => {
    const cost = computeCost(model, 1_000_000, 1_000_000);
    // 1M input * $3/M + 1M output * $15/M = $18
    expect(cost).toBeCloseTo(18, 5);
  });

  it("includes cache read tokens in cost", () => {
    const cost = computeCost(model, 0, 0, 500_000, 0);
    // 500k cache_read * $0.3/M = $0.15
    expect(cost).toBeCloseTo(0.15, 5);
  });

  it("includes cache creation tokens in cost", () => {
    const cost = computeCost(model, 0, 0, 0, 400_000);
    // 400k cache_creation * $3.75/M = $1.50
    expect(cost).toBeCloseTo(1.5, 5);
  });

  it("computes cost with all token types", () => {
    const cost = computeCost(model, 100_000, 200_000, 300_000, 50_000);
    // input: 100k * $3/M = $0.30
    // output: 200k * $15/M = $3.00
    // cacheRead: 300k * $0.3/M = $0.09
    // cacheCreation: 50k * $3.75/M = $0.1875
    expect(cost).toBeCloseTo(0.3 + 3.0 + 0.09 + 0.1875, 5);
  });

  it("returns zero cost for zero tokens", () => {
    const cost = computeCost(model, 0, 0, 0, 0);
    expect(cost).toBe(0);
  });

  it("returns zero cost when cache tokens are undefined", () => {
    const cost = computeCost(model, 0, 0, undefined, undefined);
    expect(cost).toBe(0);
  });

  it("handles zero cache tokens (falsy but not undefined)", () => {
    const cost = computeCost(model, 1_000_000, 0, 0, 0);
    // Only input cost: $3
    expect(cost).toBeCloseTo(3, 5);
  });

  it("handles all-cached scenario (no base input, only cache tokens)", () => {
    // Simulates fully cached prompt: input_tokens=0, all via cache
    const cost = computeCost(model, 0, 500_000, 2_000_000, 0);
    // output: 500k * $15/M = $7.50
    // cacheRead: 2M * $0.3/M = $0.60
    expect(cost).toBeCloseTo(7.5 + 0.6, 5);
  });

  it("handles partial cache scenario", () => {
    // Mix of base input and cache tokens
    const cost = computeCost(model, 500_000, 100_000, 1_000_000, 200_000);
    // input: 500k * $3/M = $1.50
    // output: 100k * $15/M = $1.50
    // cacheRead: 1M * $0.3/M = $0.30
    // cacheCreation: 200k * $3.75/M = $0.75
    expect(cost).toBeCloseTo(1.5 + 1.5 + 0.3 + 0.75, 5);
  });

  it("uses default pricing for unknown models", () => {
    // Default pricing is same as sonnet: input=3, output=15
    const cost = computeCost("unknown-model-xyz", 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(18, 5);
  });

  it("correctly prices opus model (higher tier)", () => {
    const opusModel = "claude-opus-4-6"; // input: 15, output: 75
    const cost = computeCost(opusModel, 1_000_000, 1_000_000, 1_000_000, 1_000_000);
    // input: 1M * $15/M = $15
    // output: 1M * $75/M = $75
    // cacheRead: 1M * $1.5/M = $1.50
    // cacheCreation: 1M * $18.75/M = $18.75
    expect(cost).toBeCloseTo(15 + 75 + 1.5 + 18.75, 5);
  });
});

describe("MODEL_PRICING", () => {
  it("has correct cache pricing ratios", () => {
    for (const [model, pricing] of Object.entries(MODEL_PRICING)) {
      expect(pricing.cacheRead).toBeCloseTo(pricing.input * 0.1, 10);
      expect(pricing.cacheCreation).toBeCloseTo(pricing.input * 1.25, 10);
    }
  });

  it("includes all Claude 4.x models", () => {
    expect(MODEL_PRICING["claude-opus-4-6"]).toBeDefined();
    expect(MODEL_PRICING["claude-sonnet-4-6"]).toBeDefined();
    expect(MODEL_PRICING["claude-haiku-4-5-20251001"]).toBeDefined();
  });
});
