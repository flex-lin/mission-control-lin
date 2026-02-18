import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for GET /api/analytics/usage-summary
 *
 * Returns current daily/monthly usage (tokens + cost) vs configured limits.
 * Aggregates from ProxyLog + Preference tables. No percentages — the frontend
 * computes those from tokenLimit/costLimit fields.
 */

// ── Mock Prisma DB ───────────────────────────────────────────────────────────

const mockPrefFindMany = vi.fn();
const mockProxyLogFindMany = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    preference: {
      findMany: (...args: unknown[]) => mockPrefFindMany(...args),
    },
    proxyLog: {
      findMany: (...args: unknown[]) => mockProxyLogFindMany(...args),
    },
  },
}));

// ── Mock pricing ─────────────────────────────────────────────────────────────

vi.mock("@/lib/pricing", () => ({
  computeCost: vi.fn(
    (
      _model: string,
      input: number,
      output: number,
      cacheRead: number,
      cacheCreation: number
    ) => {
      // Simplified cost: $3/1M input, $15/1M output for testing
      return (
        ((input + cacheRead + cacheCreation) * 3 + output * 15) / 1_000_000
      );
    }
  ),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

async function callGET() {
  vi.resetModules();
  const mod = await import("@/app/api/analytics/usage-summary/route");
  const res = await mod.GET();
  return { status: res.status, body: await res.json() };
}

function makeProxyLog(overrides: Record<string, unknown> = {}) {
  return {
    model: "claude-sonnet-4-6",
    inputTokens: 1000,
    outputTokens: 500,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    ...overrides,
  };
}

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  // Default: no limits, no logs
  mockPrefFindMany.mockResolvedValue([]);
  mockProxyLogFindMany.mockResolvedValue([]);
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe("GET /api/analytics/usage-summary", () => {
  it("returns zero usage and null limits when nothing is configured", async () => {
    const { status, body } = await callGET();

    expect(status).toBe(200);
    expect(body.data.daily.tokens).toBe(0);
    expect(body.data.daily.cost).toBe(0);
    expect(body.data.daily.tokenLimit).toBeNull();
    expect(body.data.daily.costLimit).toBeNull();
    expect(body.data.monthly.tokens).toBe(0);
    expect(body.data.monthly.cost).toBe(0);
    expect(body.data.monthly.tokenLimit).toBeNull();
    expect(body.data.monthly.costLimit).toBeNull();
  });

  it("returns correct usage totals from proxy logs", async () => {
    const log = makeProxyLog({
      inputTokens: 5000,
      outputTokens: 2000,
      cacheReadTokens: 1000,
      cacheCreationTokens: 500,
    });
    // Same logs returned for both daily and monthly queries
    mockProxyLogFindMany.mockResolvedValue([log]);

    const { status, body } = await callGET();

    expect(status).toBe(200);
    // totalTokens = (5000 + 1000 + 500) + 2000 = 8500
    expect(body.data.daily.tokens).toBe(8500);
    expect(body.data.monthly.tokens).toBe(8500);
    expect(body.data.daily.cost).toBeGreaterThan(0);
  });

  it("returns limits from preferences", async () => {
    mockPrefFindMany.mockResolvedValue([
      { key: "usage_limit_daily_tokens", value: "1000000" },
      { key: "usage_limit_daily_cost", value: "10" },
      { key: "usage_limit_monthly_tokens", value: "30000000" },
      { key: "usage_limit_monthly_cost", value: "300" },
    ]);

    const { status, body } = await callGET();

    expect(status).toBe(200);
    expect(body.data.daily.tokenLimit).toBe(1000000);
    expect(body.data.daily.costLimit).toBe(10);
    expect(body.data.monthly.tokenLimit).toBe(30000000);
    expect(body.data.monthly.costLimit).toBe(300);
  });

  it("handles partial limits (only some configured)", async () => {
    mockPrefFindMany.mockResolvedValue([
      { key: "usage_limit_daily_tokens", value: "500000" },
    ]);

    const { status, body } = await callGET();

    expect(status).toBe(200);
    expect(body.data.daily.tokenLimit).toBe(500000);
    expect(body.data.daily.costLimit).toBeNull();
    expect(body.data.monthly.tokenLimit).toBeNull();
    expect(body.data.monthly.costLimit).toBeNull();
  });

  it("handles multiple proxy log entries", async () => {
    mockProxyLogFindMany.mockResolvedValue([
      makeProxyLog({ inputTokens: 1000, outputTokens: 500, cacheReadTokens: 0, cacheCreationTokens: 0 }),
      makeProxyLog({ inputTokens: 2000, outputTokens: 1000, cacheReadTokens: 0, cacheCreationTokens: 0 }),
      makeProxyLog({ inputTokens: 3000, outputTokens: 1500, cacheReadTokens: 0, cacheCreationTokens: 0 }),
    ]);

    const { status, body } = await callGET();

    expect(status).toBe(200);
    // Total tokens = (1000+500) + (2000+1000) + (3000+1500) = 9000
    expect(body.data.daily.tokens).toBe(9000);
  });

  it("has correct response shape", async () => {
    const { status, body } = await callGET();

    expect(status).toBe(200);
    expect(body.data).toHaveProperty("daily");
    expect(body.data).toHaveProperty("monthly");
    expect(body.data.daily).toHaveProperty("tokens");
    expect(body.data.daily).toHaveProperty("cost");
    expect(body.data.daily).toHaveProperty("tokenLimit");
    expect(body.data.daily).toHaveProperty("costLimit");
    expect(body.data.monthly).toHaveProperty("tokens");
    expect(body.data.monthly).toHaveProperty("cost");
    expect(body.data.monthly).toHaveProperty("tokenLimit");
    expect(body.data.monthly).toHaveProperty("costLimit");
  });

  it("queries proxy logs with correct time-based cutoffs", async () => {
    await callGET();

    // Should be called twice: once for daily, once for monthly
    expect(mockProxyLogFindMany).toHaveBeenCalledTimes(2);

    const dailyCall = mockProxyLogFindMany.mock.calls[0][0];
    const monthlyCall = mockProxyLogFindMany.mock.calls[1][0];

    // Both should have a gte timestamp filter
    expect(dailyCall.where.timestamp.gte).toBeInstanceOf(Date);
    expect(monthlyCall.where.timestamp.gte).toBeInstanceOf(Date);

    // Monthly cutoff should be earlier than or equal to daily cutoff
    expect(monthlyCall.where.timestamp.gte.getTime()).toBeLessThanOrEqual(
      dailyCall.where.timestamp.gte.getTime()
    );
  });

  it("returns null limits for non-numeric stored values", async () => {
    mockPrefFindMany.mockResolvedValue([
      { key: "usage_limit_daily_tokens", value: "not-a-number" },
    ]);

    const { status, body } = await callGET();

    expect(status).toBe(200);
    expect(body.data.daily.tokenLimit).toBeNull();
  });
});
