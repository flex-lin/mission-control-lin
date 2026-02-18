import { describe, it, expect } from "vitest";
import { computeCost, MODEL_PRICING } from "@/lib/pricing";

describe("MODEL_PRICING", () => {
  it("contains expected models", () => {
    expect(MODEL_PRICING["claude-opus-4-6"]).toBeDefined();
    expect(MODEL_PRICING["claude-sonnet-4-6"]).toBeDefined();
    expect(MODEL_PRICING["claude-haiku-4-5-20251001"]).toBeDefined();
    expect(MODEL_PRICING["claude-3-opus-20240229"]).toBeDefined();
  });

  it("has correct pricing for claude-opus-4-6", () => {
    const p = MODEL_PRICING["claude-opus-4-6"];
    expect(p.input).toBe(15);
    expect(p.output).toBe(75);
    expect(p.cacheRead).toBeCloseTo(1.5); // 15 * 0.1
    expect(p.cacheCreation).toBeCloseTo(18.75); // 15 * 1.25
  });

  it("derives cache pricing from input price", () => {
    for (const [, pricing] of Object.entries(MODEL_PRICING)) {
      expect(pricing.cacheRead).toBeCloseTo(pricing.input * 0.1);
      expect(pricing.cacheCreation).toBeCloseTo(pricing.input * 1.25);
    }
  });
});

describe("computeCost", () => {
  it("computes basic input + output cost", () => {
    // 1M input tokens at $15/M + 1M output tokens at $75/M = $90
    const cost = computeCost("claude-opus-4-6", 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(90);
  });

  it("computes cost with fractional token counts", () => {
    // 500 input tokens at $15/M + 1000 output tokens at $75/M
    const cost = computeCost("claude-opus-4-6", 500, 1000);
    expect(cost).toBeCloseTo(500 / 1_000_000 * 15 + 1000 / 1_000_000 * 75);
  });

  it("includes cache read tokens in cost", () => {
    const baseCost = computeCost("claude-opus-4-6", 1_000_000, 0);
    const withCache = computeCost("claude-opus-4-6", 1_000_000, 0, 1_000_000);
    // Cache read adds 1.5 per 1M tokens
    expect(withCache - baseCost).toBeCloseTo(1.5);
  });

  it("includes cache creation tokens in cost", () => {
    const baseCost = computeCost("claude-opus-4-6", 1_000_000, 0);
    const withCreation = computeCost("claude-opus-4-6", 1_000_000, 0, 0, 1_000_000);
    // Cache creation adds 18.75 per 1M tokens
    expect(withCreation - baseCost).toBeCloseTo(18.75);
  });

  it("handles zero tokens", () => {
    expect(computeCost("claude-opus-4-6", 0, 0)).toBe(0);
    expect(computeCost("claude-opus-4-6", 0, 0, 0, 0)).toBe(0);
  });

  it("uses default pricing for unknown models", () => {
    // Default is sonnet-level: $3 input, $15 output
    const cost = computeCost("unknown-model-xyz", 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(3 + 15);
  });

  it("computes correctly for haiku (cheaper model)", () => {
    // Haiku: $0.8 input, $4 output
    const cost = computeCost("claude-haiku-4-5-20251001", 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(0.8 + 4);
  });
});
