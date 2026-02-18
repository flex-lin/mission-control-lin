import { describe, it, expect } from "vitest";
import { computeCost, MODEL_PRICING } from "../lib/pricing";

describe("MODEL_PRICING", () => {
  it("contains expected model entries", () => {
    expect(MODEL_PRICING["claude-opus-4-6"]).toBeDefined();
    expect(MODEL_PRICING["claude-sonnet-4-6"]).toBeDefined();
    expect(MODEL_PRICING["claude-haiku-4-5-20251001"]).toBeDefined();
  });

  it("has correct pricing for claude-opus-4-6", () => {
    const p = MODEL_PRICING["claude-opus-4-6"];
    expect(p.input).toBe(15);
    expect(p.output).toBe(75);
    expect(p.cacheRead).toBe(15 * 0.1); // 1.5
    expect(p.cacheCreation).toBe(15 * 1.25); // 18.75
  });

  it("has correct pricing for claude-sonnet-4-6", () => {
    const p = MODEL_PRICING["claude-sonnet-4-6"];
    expect(p.input).toBe(3);
    expect(p.output).toBe(15);
    expect(p.cacheRead).toBeCloseTo(0.3);
    expect(p.cacheCreation).toBeCloseTo(3.75);
  });

  it("has correct pricing for claude-haiku-4-5", () => {
    const p = MODEL_PRICING["claude-haiku-4-5-20251001"];
    expect(p.input).toBe(0.8);
    expect(p.output).toBe(4);
    expect(p.cacheRead).toBeCloseTo(0.08);
    expect(p.cacheCreation).toBeCloseTo(1.0);
  });
});

describe("computeCost", () => {
  it("computes cost for input + output tokens only", () => {
    // 1M input tokens at $15/M + 1M output tokens at $75/M = $90
    const cost = computeCost("claude-opus-4-6", 1_000_000, 1_000_000);
    expect(cost).toBe(90);
  });

  it("computes cost with zero tokens", () => {
    const cost = computeCost("claude-opus-4-6", 0, 0);
    expect(cost).toBe(0);
  });

  it("includes cache read tokens in cost", () => {
    // Cache read for opus: $1.5/M
    // 1M cache read tokens = $1.5
    const cost = computeCost("claude-opus-4-6", 0, 0, 1_000_000, 0);
    expect(cost).toBeCloseTo(1.5);
  });

  it("includes cache creation tokens in cost", () => {
    // Cache creation for opus: $18.75/M
    // 1M cache creation tokens = $18.75
    const cost = computeCost("claude-opus-4-6", 0, 0, 0, 1_000_000);
    expect(cost).toBeCloseTo(18.75);
  });

  it("combines all token types correctly", () => {
    // 500K input ($7.50) + 200K output ($15) + 1M cache read ($1.50) + 100K cache creation ($1.875)
    const cost = computeCost(
      "claude-opus-4-6",
      500_000,
      200_000,
      1_000_000,
      100_000,
    );
    expect(cost).toBeCloseTo(7.5 + 15 + 1.5 + 1.875);
  });

  it("uses default pricing for unknown model", () => {
    // Default pricing is (3, 15) — same as sonnet
    const cost = computeCost("unknown-model", 1_000_000, 1_000_000);
    expect(cost).toBe(3 + 15); // $18
  });

  it("handles undefined cache tokens (optional params)", () => {
    const cost = computeCost("claude-opus-4-6", 1_000_000, 0, undefined, undefined);
    expect(cost).toBe(15);
  });

  it("handles small token counts correctly", () => {
    // 1 input token at $15/M = $0.000015
    const cost = computeCost("claude-opus-4-6", 1, 0);
    expect(cost).toBeCloseTo(0.000015);
  });

  it("computes correct cost for a realistic Claude Code session", () => {
    // Typical session: 50K input, 2K output, 100K cache read, 10K cache creation
    // Sonnet pricing: input=$3/M, output=$15/M, cache_read=$0.3/M, cache_creation=$3.75/M
    const cost = computeCost(
      "claude-sonnet-4-6",
      50_000,
      2_000,
      100_000,
      10_000,
    );
    const expected =
      (50_000 / 1_000_000) * 3 +      // $0.15
      (2_000 / 1_000_000) * 15 +       // $0.03
      (100_000 / 1_000_000) * 0.3 +    // $0.03
      (10_000 / 1_000_000) * 3.75;     // $0.0375
    expect(cost).toBeCloseTo(expected);
  });
});
