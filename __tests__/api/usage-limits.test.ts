import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Tests for GET/PUT /api/settings/usage-limits
 *
 * Stores limits as Preference key-value pairs (usage_limit_daily_tokens, etc.).
 * GET returns UsageLimits with null defaults; PUT validates and upserts.
 */

// ── Mock Prisma DB ───────────────────────────────────────────────────────────

const mockFindMany = vi.fn();
const mockUpsert = vi.fn();
const mockDeleteMany = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    preference: {
      findMany: (...args: unknown[]) => mockFindMany(...args),
      upsert: (...args: unknown[]) => mockUpsert(...args),
      deleteMany: (...args: unknown[]) => mockDeleteMany(...args),
    },
  },
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeRequest(body?: Record<string, unknown>) {
  return new NextRequest(
    new URL("http://localhost:31777/api/settings/usage-limits"),
    body
      ? { method: "PUT", body: JSON.stringify(body) }
      : undefined
  );
}

async function callGET() {
  vi.resetModules();
  const mod = await import("@/app/api/settings/usage-limits/route");
  const res = await mod.GET();
  return { status: res.status, body: await res.json() };
}

async function callPUT(body: Record<string, unknown>) {
  vi.resetModules();
  const mod = await import("@/app/api/settings/usage-limits/route");
  const req = makeRequest(body);
  const res = await mod.PUT(req);
  return { status: res.status, body: await res.json() };
}

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockFindMany.mockResolvedValue([]);
  mockUpsert.mockResolvedValue({});
  mockDeleteMany.mockResolvedValue({ count: 0 });
});

// ── GET /api/settings/usage-limits ──────────────────────────────────────────

describe("GET /api/settings/usage-limits", () => {
  it("returns all-null limits when no preferences are configured", async () => {
    mockFindMany.mockResolvedValue([]);

    const { status, body } = await callGET();

    expect(status).toBe(200);
    expect(body.data).toEqual({
      dailyTokens: null,
      dailyCost: null,
      monthlyTokens: null,
      monthlyCost: null,
    });
  });

  it("returns saved limits from preferences", async () => {
    mockFindMany.mockResolvedValue([
      { key: "usage_limit_daily_tokens", value: "1000000" },
      { key: "usage_limit_monthly_cost", value: "50.5" },
    ]);

    const { status, body } = await callGET();

    expect(status).toBe(200);
    expect(body.data.dailyTokens).toBe(1000000);
    expect(body.data.dailyCost).toBeNull();
    expect(body.data.monthlyTokens).toBeNull();
    expect(body.data.monthlyCost).toBe(50.5);
  });

  it("returns null for non-numeric stored values", async () => {
    mockFindMany.mockResolvedValue([
      { key: "usage_limit_daily_tokens", value: "not-a-number" },
    ]);

    const { status, body } = await callGET();

    expect(status).toBe(200);
    expect(body.data.dailyTokens).toBeNull();
  });

  it("queries preferences with startsWith filter", async () => {
    mockFindMany.mockResolvedValue([]);

    await callGET();

    expect(mockFindMany).toHaveBeenCalledWith({
      where: { key: { startsWith: "usage_limit_" } },
    });
  });
});

// ── PUT /api/settings/usage-limits ──────────────────────────────────────────

describe("PUT /api/settings/usage-limits", () => {
  it("saves valid limits via upsert", async () => {
    const { status, body } = await callPUT({
      dailyTokens: 500000,
      monthlyCost: 100,
    });

    expect(status).toBe(200);
    expect(body.data).toEqual({ saved: true });
    expect(mockUpsert).toHaveBeenCalledTimes(2);
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: "usage_limit_daily_tokens" },
        update: { value: "500000" },
        create: { key: "usage_limit_daily_tokens", value: "500000" },
      })
    );
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: "usage_limit_monthly_cost" },
        update: { value: "100" },
        create: { key: "usage_limit_monthly_cost", value: "100" },
      })
    );
  });

  it("removes limit when value is null", async () => {
    const { status } = await callPUT({ dailyTokens: null });

    expect(status).toBe(200);
    expect(mockDeleteMany).toHaveBeenCalledWith({
      where: { key: "usage_limit_daily_tokens" },
    });
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("rejects negative numbers", async () => {
    const { status, body } = await callPUT({ dailyTokens: -100 });

    expect(status).toBe(400);
    expect(body.code).toBe("INVALID_LIMIT");
    expect(body.error).toContain("dailyTokens");
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("rejects non-number values", async () => {
    const { status, body } = await callPUT({ monthlyCost: "abc" });

    expect(status).toBe(400);
    expect(body.code).toBe("INVALID_LIMIT");
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("accepts zero as a valid limit", async () => {
    const { status, body } = await callPUT({ dailyTokens: 0 });

    expect(status).toBe(200);
    expect(body.data).toEqual({ saved: true });
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: "usage_limit_daily_tokens" },
        update: { value: "0" },
        create: { key: "usage_limit_daily_tokens", value: "0" },
      })
    );
  });

  it("ignores unknown fields silently", async () => {
    const { status, body } = await callPUT({
      unknownField: 999,
      dailyTokens: 100,
    });

    expect(status).toBe(200);
    expect(body.data).toEqual({ saved: true });
    // Only dailyTokens should be upserted
    expect(mockUpsert).toHaveBeenCalledTimes(1);
  });

  it("handles empty body without errors", async () => {
    const { status, body } = await callPUT({});

    expect(status).toBe(200);
    expect(body.data).toEqual({ saved: true });
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(mockDeleteMany).not.toHaveBeenCalled();
  });

  it("saves all four limit fields at once", async () => {
    const { status } = await callPUT({
      dailyTokens: 1000000,
      dailyCost: 10,
      monthlyTokens: 30000000,
      monthlyCost: 300,
    });

    expect(status).toBe(200);
    expect(mockUpsert).toHaveBeenCalledTimes(4);
  });
});
