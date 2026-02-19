/**
 * Integration tests for the Anthropic Usage API integration.
 *
 * Tests:
 * 1. Mock data factories (sanity checks)
 * 2. lib/anthropic-usage.ts — fetchUsageReport, fetchCostReport, fetchClaudeCodeReport
 * 3. lib/anthropic-usage.ts — getAdminApiKey
 * 4. Data transformation and edge cases
 * 5. Response shape validation
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  makeUsageResponse,
  makeUsageBucket,
  makeUsageResult,
  makeCostResponse,
  makeCostBucket,
  makeCostResult,
  makeWeeklyUsageResponse,
  makeWeeklyCostResponse,
  makeAnthropicErrorResponse,
  makePaginatedUsageResponse,
} from "./helpers/usage-api-mocks";

// ═══════════════════════════════════════════════════════════════════════════════
// 1. Mock data factory sanity checks
// ═══════════════════════════════════════════════════════════════════════════════

describe("usage-api mock helpers", () => {
  it("makeUsageResult returns valid default structure", () => {
    const result = makeUsageResult();
    expect(result.model).toBe("claude-sonnet-4-6");
    expect(result.uncached_input_tokens).toBe(50000);
    expect(result.output_tokens).toBe(2000);
    expect(result.cache_read_input_tokens).toBe(100000);
    expect(result.cache_creation.ephemeral_5m_input_tokens).toBe(10000);
    expect(result.cache_creation.ephemeral_1h_input_tokens).toBe(0);
    expect(result.server_tool_use.web_search_requests).toBe(0);
  });

  it("makeUsageResult accepts overrides", () => {
    const result = makeUsageResult({
      model: "claude-opus-4-6",
      uncached_input_tokens: 999,
      output_tokens: 111,
    });
    expect(result.model).toBe("claude-opus-4-6");
    expect(result.uncached_input_tokens).toBe(999);
    expect(result.output_tokens).toBe(111);
    expect(result.cache_read_input_tokens).toBe(100000);
  });

  it("makeUsageBucket creates bucket with results", () => {
    const bucket = makeUsageBucket("2026-02-10T00:00:00Z", "2026-02-11T00:00:00Z", [
      { model: "claude-opus-4-6" },
      { model: "claude-sonnet-4-6" },
    ]);
    expect(bucket.starting_at).toBe("2026-02-10T00:00:00Z");
    expect(bucket.ending_at).toBe("2026-02-11T00:00:00Z");
    expect(bucket.results).toHaveLength(2);
    expect(bucket.results[0].model).toBe("claude-opus-4-6");
    expect(bucket.results[1].model).toBe("claude-sonnet-4-6");
  });

  it("makeUsageResponse wraps buckets with pagination", () => {
    const bucket = makeUsageBucket("2026-02-10T00:00:00Z", "2026-02-11T00:00:00Z");
    const response = makeUsageResponse([bucket], true, "next_page_token");
    expect(response.data).toHaveLength(1);
    expect(response.has_more).toBe(true);
    expect(response.next_page).toBe("next_page_token");
  });

  it("makeCostResult returns valid default structure", () => {
    const result = makeCostResult();
    expect(result.amount).toBe("15.00");
    expect(result.currency).toBe("USD");
    expect(result.cost_type).toBe("tokens");
    expect(result.model).toBe("claude-sonnet-4-6");
  });

  it("makeWeeklyUsageResponse creates 7 days of data with 2 models", () => {
    const response = makeWeeklyUsageResponse();
    expect(response.data).toHaveLength(7);
    expect(response.has_more).toBe(false);
    for (const bucket of response.data) {
      expect(bucket.results).toHaveLength(2);
    }
  });

  it("makeWeeklyCostResponse creates 7 days of cost data", () => {
    const response = makeWeeklyCostResponse();
    expect(response.data).toHaveLength(7);
    expect(response.has_more).toBe(false);
    for (const bucket of response.data) {
      expect(bucket.results.length).toBeGreaterThan(0);
      for (const result of bucket.results) {
        expect(result.currency).toBe("USD");
        expect(parseFloat(result.amount)).toBeGreaterThan(0);
      }
    }
  });

  it("makePaginatedUsageResponse generates correct pagination", () => {
    const page0 = makePaginatedUsageResponse(0, 3);
    expect(page0.has_more).toBe(true);
    expect(page0.next_page).toBe("page_token_1");

    const page1 = makePaginatedUsageResponse(1, 3);
    expect(page1.has_more).toBe(true);
    expect(page1.next_page).toBe("page_token_2");

    const page2 = makePaginatedUsageResponse(2, 3);
    expect(page2.has_more).toBe(false);
    expect(page2.next_page).toBeNull();
  });

  it("makeAnthropicErrorResponse creates auth error for 401", () => {
    const error = makeAnthropicErrorResponse(401, "Invalid API key");
    expect(error.type).toBe("error");
    expect(error.error.type).toBe("authentication_error");
    expect(error.error.message).toBe("Invalid API key");
  });

  it("makeAnthropicErrorResponse creates rate limit error for 429", () => {
    const error = makeAnthropicErrorResponse(429, "Rate limited");
    expect(error.error.type).toBe("rate_limit_error");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. lib/anthropic-usage.ts — API client functions
// ═══════════════════════════════════════════════════════════════════════════════

// Mock the db module to prevent actual SQLite access in tests
vi.mock("@/lib/db", () => ({
  db: {
    preference: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
    usageSyncCursor: {
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      upsert: vi.fn().mockResolvedValue({}),
    },
    usageRecord: {
      upsert: vi.fn().mockResolvedValue({}),
      findMany: vi.fn().mockResolvedValue([]),
      groupBy: vi.fn().mockResolvedValue([]),
    },
    costRecord: {
      upsert: vi.fn().mockResolvedValue({}),
      findMany: vi.fn().mockResolvedValue([]),
      groupBy: vi.fn().mockResolvedValue([]),
    },
    claudeCodeDailyMetric: {
      upsert: vi.fn().mockResolvedValue({}),
      findMany: vi.fn().mockResolvedValue([]),
    },
    proxyLog: {
      findMany: vi.fn().mockResolvedValue([]),
      groupBy: vi.fn().mockResolvedValue([]),
      aggregate: vi.fn().mockResolvedValue({ _count: { id: 0 } }),
    },
  },
}));

import {
  getAdminApiKey,
  fetchUsageReport,
  fetchCostReport,
  fetchClaudeCodeReport,
  syncUsageData,
} from "@/lib/anthropic-usage";
import { db } from "@/lib/db";

describe("lib/anthropic-usage — getAdminApiKey", () => {
  const originalEnv = process.env.ANTHROPIC_ADMIN_API_KEY;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.ANTHROPIC_ADMIN_API_KEY = originalEnv;
    } else {
      delete process.env.ANTHROPIC_ADMIN_API_KEY;
    }
    vi.restoreAllMocks();
  });

  it("returns env var when set", async () => {
    process.env.ANTHROPIC_ADMIN_API_KEY = "sk-ant-admin-test-key-123";
    const key = await getAdminApiKey();
    expect(key).toBe("sk-ant-admin-test-key-123");
  });

  it("falls back to Preference table when env var not set", async () => {
    delete process.env.ANTHROPIC_ADMIN_API_KEY;
    vi.mocked(db.preference.findUnique).mockResolvedValueOnce({
      key: "anthropic_admin_api_key",
      value: "sk-ant-admin-from-db",
    });

    const key = await getAdminApiKey();
    expect(key).toBe("sk-ant-admin-from-db");
    expect(db.preference.findUnique).toHaveBeenCalledWith({
      where: { key: "anthropic_admin_api_key" },
    });
  });

  it("returns null when neither env var nor db preference exists", async () => {
    delete process.env.ANTHROPIC_ADMIN_API_KEY;
    vi.mocked(db.preference.findUnique).mockResolvedValueOnce(null);

    const key = await getAdminApiKey();
    expect(key).toBeNull();
  });

  it("env var takes precedence over db preference", async () => {
    process.env.ANTHROPIC_ADMIN_API_KEY = "sk-ant-admin-env-key";
    vi.mocked(db.preference.findUnique).mockClear();
    vi.mocked(db.preference.findUnique).mockResolvedValueOnce({
      key: "anthropic_admin_api_key",
      value: "sk-ant-admin-db-key",
    });

    const key = await getAdminApiKey();
    expect(key).toBe("sk-ant-admin-env-key");
    // Should NOT query db since env var is set
    expect(db.preference.findUnique).not.toHaveBeenCalled();
  });
});

describe("lib/anthropic-usage — fetchUsageReport", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("calls Anthropic usage endpoint with correct URL and headers", async () => {
    const mockResp = makeUsageResponse([
      makeUsageBucket("2026-02-10T00:00:00Z", "2026-02-11T00:00:00Z"),
    ]);

    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(mockResp), { status: 200 })
    );

    await fetchUsageReport("sk-ant-admin-test", {
      startingAt: "2026-02-10T00:00:00Z",
      endingAt: "2026-02-11T00:00:00Z",
      bucketWidth: "1d",
      groupBy: ["model"],
    });

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [callUrl, callOpts] = vi.mocked(globalThis.fetch).mock.calls[0];
    expect(String(callUrl)).toContain("/v1/organizations/usage_report/messages");
    expect(String(callUrl)).toContain("starting_at=");
    expect(String(callUrl)).toContain("bucket_width=1d");
    expect((callOpts as RequestInit).headers).toEqual(
      expect.objectContaining({
        "x-api-key": "sk-ant-admin-test",
        "anthropic-version": "2023-06-01",
      })
    );
  });

  it("returns flattened array of buckets", async () => {
    const mockResp = makeUsageResponse([
      makeUsageBucket("2026-02-10T00:00:00Z", "2026-02-11T00:00:00Z", [
        { model: "claude-opus-4-6" },
      ]),
      makeUsageBucket("2026-02-11T00:00:00Z", "2026-02-12T00:00:00Z", [
        { model: "claude-sonnet-4-6" },
      ]),
    ]);

    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(mockResp), { status: 200 })
    );

    const result = await fetchUsageReport("sk-ant-admin-test", {
      startingAt: "2026-02-10T00:00:00Z",
    });

    expect(result).toHaveLength(2);
    expect(result[0].results[0].model).toBe("claude-opus-4-6");
    expect(result[1].results[0].model).toBe("claude-sonnet-4-6");
  });

  it("handles pagination automatically", async () => {
    const page1 = makePaginatedUsageResponse(0, 2);
    const page2 = makePaginatedUsageResponse(1, 2);

    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify(page1), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(page2), { status: 200 }));

    const result = await fetchUsageReport("sk-ant-admin-test", {
      startingAt: "2026-02-10T00:00:00Z",
    });

    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(2);

    // Second call should include page parameter
    const secondCallUrl = String(vi.mocked(globalThis.fetch).mock.calls[1][0]);
    expect(secondCallUrl).toContain("page=page_token_1");
  });

  it("throws on 401 authentication error", async () => {
    const errorBody = makeAnthropicErrorResponse(401, "Invalid admin API key");

    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(errorBody), { status: 401 })
    );

    await expect(
      fetchUsageReport("sk-bad-key", { startingAt: "2026-02-10T00:00:00Z" })
    ).rejects.toThrow(/401/);
  });

  it("throws on 429 rate limit error", async () => {
    const errorBody = makeAnthropicErrorResponse(429, "Rate limit exceeded");

    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(errorBody), { status: 429 })
    );

    await expect(
      fetchUsageReport("sk-ant-admin-test", { startingAt: "2026-02-10T00:00:00Z" })
    ).rejects.toThrow(/429/);
  });

  it("throws on 500 server error", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response("Internal Server Error", { status: 500 })
    );

    await expect(
      fetchUsageReport("sk-ant-admin-test", { startingAt: "2026-02-10T00:00:00Z" })
    ).rejects.toThrow(/500/);
  });

  it("handles empty response (no data for period)", async () => {
    const mockResp = makeUsageResponse([]);

    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(mockResp), { status: 200 })
    );

    const result = await fetchUsageReport("sk-ant-admin-test", {
      startingAt: "2026-02-10T00:00:00Z",
    });

    expect(result).toEqual([]);
  });

  it("passes model filter parameters", async () => {
    const mockResp = makeUsageResponse([]);

    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(mockResp), { status: 200 })
    );

    await fetchUsageReport("sk-ant-admin-test", {
      startingAt: "2026-02-10T00:00:00Z",
      models: ["claude-opus-4-6", "claude-sonnet-4-6"],
    });

    const callUrl = String(vi.mocked(globalThis.fetch).mock.calls[0][0]);
    expect(callUrl).toContain("models");
  });
});

describe("lib/anthropic-usage — fetchCostReport", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("calls the cost report endpoint with correct URL", async () => {
    const mockResp = makeCostResponse([
      makeCostBucket("2026-02-10T00:00:00Z", "2026-02-11T00:00:00Z"),
    ]);

    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(mockResp), { status: 200 })
    );

    await fetchCostReport("sk-ant-admin-test", {
      startingAt: "2026-02-10T00:00:00Z",
      endingAt: "2026-02-11T00:00:00Z",
      groupBy: ["description"],
    });

    const callUrl = String(vi.mocked(globalThis.fetch).mock.calls[0][0]);
    expect(callUrl).toContain("/v1/organizations/cost_report");
    expect(callUrl).toContain("bucket_width=1d");
  });

  it("returns flattened cost buckets", async () => {
    const mockResp = makeCostResponse([
      makeCostBucket("2026-02-10T00:00:00Z", "2026-02-11T00:00:00Z", [
        { model: "claude-opus-4-6", amount: "100.00" },
        { model: "claude-sonnet-4-6", amount: "20.00" },
      ]),
    ]);

    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(mockResp), { status: 200 })
    );

    const result = await fetchCostReport("sk-ant-admin-test", {
      startingAt: "2026-02-10T00:00:00Z",
    });

    expect(result).toHaveLength(1);
    expect(result[0].results).toHaveLength(2);
    expect(result[0].results[0].amount).toBe("100.00");
  });

  it("handles empty cost data", async () => {
    const mockResp = makeCostResponse([]);

    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(mockResp), { status: 200 })
    );

    const result = await fetchCostReport("sk-ant-admin-test", {
      startingAt: "2026-02-10T00:00:00Z",
    });

    expect(result).toEqual([]);
  });

  it("handles pagination for cost report", async () => {
    const page1 = makeCostResponse(
      [makeCostBucket("2026-02-10T00:00:00Z", "2026-02-11T00:00:00Z")],
      true,
      "cost_page_2",
    );
    const page2 = makeCostResponse(
      [makeCostBucket("2026-02-11T00:00:00Z", "2026-02-12T00:00:00Z")],
      false,
      null,
    );

    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify(page1), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(page2), { status: 200 }));

    const result = await fetchCostReport("sk-ant-admin-test", {
      startingAt: "2026-02-10T00:00:00Z",
    });

    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(2);
  });
});

describe("lib/anthropic-usage — fetchClaudeCodeReport", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("calls the Claude Code analytics endpoint", async () => {
    const mockResp = { data: [], has_more: false, next_page: null };

    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(mockResp), { status: 200 })
    );

    await fetchClaudeCodeReport("sk-ant-admin-test", {
      startingAt: "2026-02-10",
    });

    const callUrl = String(vi.mocked(globalThis.fetch).mock.calls[0][0]);
    expect(callUrl).toContain("/v1/organizations/usage_report/claude_code");
    expect(callUrl).toContain("starting_at=2026-02-10");
  });

  it("returns flattened Claude Code records", async () => {
    const mockRecord = {
      date: "2026-02-10T00:00:00Z",
      actor: { type: "user_actor", email_address: "dev@example.com" },
      organization_id: "org_123",
      customer_type: "api",
      terminal_type: "vscode",
      core_metrics: {
        num_sessions: 5,
        lines_of_code: { added: 200, removed: 50 },
        commits_by_claude_code: 3,
        pull_requests_by_claude_code: 1,
      },
      tool_actions: {
        edit_tool: { accepted: 10, rejected: 2 },
        multi_edit_tool: { accepted: 3, rejected: 0 },
        write_tool: { accepted: 5, rejected: 1 },
        notebook_edit_tool: { accepted: 0, rejected: 0 },
      },
      model_breakdown: [
        {
          model: "claude-sonnet-4-6",
          tokens: { input: 50000, output: 2000, cache_read: 80000, cache_creation: 8000 },
          estimated_cost: { currency: "USD", amount: 45.5 },
        },
      ],
    };

    const mockResp = { data: [mockRecord], has_more: false, next_page: null };

    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(mockResp), { status: 200 })
    );

    const result = await fetchClaudeCodeReport("sk-ant-admin-test", {
      startingAt: "2026-02-10",
    });

    expect(result).toHaveLength(1);
    expect(result[0].actor.type).toBe("user_actor");
    expect(result[0].core_metrics.num_sessions).toBe(5);
    expect(result[0].model_breakdown).toHaveLength(1);
  });

  it("defaults limit to 1000", async () => {
    const mockResp = { data: [], has_more: false, next_page: null };

    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(mockResp), { status: 200 })
    );

    await fetchClaudeCodeReport("sk-ant-admin-test", {
      startingAt: "2026-02-10",
    });

    const callUrl = String(vi.mocked(globalThis.fetch).mock.calls[0][0]);
    expect(callUrl).toContain("limit=1000");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. syncUsageData — orchestrator tests
// ═══════════════════════════════════════════════════════════════════════════════

describe("lib/anthropic-usage — syncUsageData", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
    vi.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("syncs usage data and upserts to database", async () => {
    const usageResp = makeUsageResponse([
      makeUsageBucket("2026-02-10T00:00:00Z", "2026-02-11T00:00:00Z", [
        { model: "claude-sonnet-4-6", uncached_input_tokens: 50000, output_tokens: 2000 },
      ]),
    ]);

    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(usageResp), { status: 200 })
    );

    const result = await syncUsageData("sk-ant-admin-test", {
      sources: ["usage"],
      startDate: "2026-02-10T00:00:00Z",
      endDate: "2026-02-11T00:00:00Z",
    });

    expect(result.usage).not.toBeNull();
    expect(result.usage!.synced).toBe(1);
    expect(result.cost).toBeNull();
    expect(result.claudeCode).toBeNull();

    // Verify upsert was called
    expect(db.usageRecord.upsert).toHaveBeenCalledTimes(1);
    expect(db.usageSyncCursor.upsert).toHaveBeenCalled();
  });

  it("syncs cost data and parses amounts correctly", async () => {
    const costResp = makeCostResponse([
      makeCostBucket("2026-02-10T00:00:00Z", "2026-02-11T00:00:00Z", [
        { model: "claude-opus-4-6", amount: "150.75", cost_type: "tokens", token_type: "uncached_input_tokens" },
        { model: "claude-opus-4-6", amount: "375.00", cost_type: "tokens", token_type: "output_tokens" },
      ]),
    ]);

    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(costResp), { status: 200 })
    );

    const result = await syncUsageData("sk-ant-admin-test", {
      sources: ["cost"],
      startDate: "2026-02-10T00:00:00Z",
      endDate: "2026-02-11T00:00:00Z",
    });

    expect(result.cost).not.toBeNull();
    expect(result.cost!.synced).toBe(2);

    // Verify amount was parsed from string to float
    const upsertCall = vi.mocked(db.costRecord.upsert).mock.calls[0][0];
    expect(upsertCall.create.amountCents).toBeCloseTo(150.75);
  });

  it("syncs all sources by default", async () => {
    const usageResp = makeUsageResponse([]);
    const costResp = makeCostResponse([]);
    const ccResp = { data: [], has_more: false, next_page: null };

    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify(usageResp), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(costResp), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(ccResp), { status: 200 }));

    const result = await syncUsageData("sk-ant-admin-test", {
      startDate: "2026-02-10T00:00:00Z",
      endDate: "2026-02-10T00:00:00Z",
    });

    // All three sources should have been synced
    expect(result.usage).not.toBeNull();
    expect(result.cost).not.toBeNull();
    expect(result.claudeCode).not.toBeNull();
  });

  it("uses sync cursor when no startDate provided", async () => {
    vi.mocked(db.usageSyncCursor.findUnique).mockResolvedValueOnce({
      id: "usage",
      lastSyncAt: new Date("2026-02-15T00:00:00Z"),
      updatedAt: new Date(),
    });

    const usageResp = makeUsageResponse([]);
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(usageResp), { status: 200 })
    );

    await syncUsageData("sk-ant-admin-test", {
      sources: ["usage"],
    });

    // Should query the cursor
    expect(db.usageSyncCursor.findUnique).toHaveBeenCalledWith({
      where: { id: "usage" },
    });
  });

  it("updates sync cursor after successful sync", async () => {
    const usageResp = makeUsageResponse([]);
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(usageResp), { status: 200 })
    );

    await syncUsageData("sk-ant-admin-test", {
      sources: ["usage"],
      startDate: "2026-02-10T00:00:00Z",
      endDate: "2026-02-11T00:00:00Z",
    });

    expect(db.usageSyncCursor.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "usage" },
      })
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. Route handler tests (with mocked DB)
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /api/usage/status — route handler", () => {
  it("returns configuration status with correct shape", async () => {
    const { GET } = await import("@/app/api/usage/status/route");

    // getAdminApiKey will return null (env not set, db mock returns null)
    delete process.env.ANTHROPIC_ADMIN_API_KEY;

    const req = new Request("http://localhost:3777/api/usage/status");
    const res = await GET();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toBeDefined();
    expect(typeof body.data.configured).toBe("boolean");
    expect(body.data.lastSync).toHaveProperty("usage");
    expect(body.data.lastSync).toHaveProperty("cost");
    expect(body.data.lastSync).toHaveProperty("claudeCode");
  });

  it("returns keyPrefix as null when no key configured", async () => {
    const { GET } = await import("@/app/api/usage/status/route");
    delete process.env.ANTHROPIC_ADMIN_API_KEY;

    const res = await GET();
    const body = await res.json();
    expect(body.data.configured).toBe(false);
    expect(body.data.keyPrefix).toBeNull();
  });

  it("returns keyPrefix when key is configured via env", async () => {
    process.env.ANTHROPIC_ADMIN_API_KEY = "sk-ant-admin-test-123456";
    const { GET } = await import("@/app/api/usage/status/route");

    const res = await GET();
    const body = await res.json();
    expect(body.data.configured).toBe(true);
    expect(body.data.keyPrefix).toBe("sk-ant-a…");

    delete process.env.ANTHROPIC_ADMIN_API_KEY;
  });
});

describe("POST /api/usage/sync — route handler", () => {
  afterEach(() => {
    delete process.env.ANTHROPIC_ADMIN_API_KEY;
  });

  it("returns 400 when no API key is configured", async () => {
    delete process.env.ANTHROPIC_ADMIN_API_KEY;
    vi.mocked(db.preference.findUnique).mockResolvedValueOnce(null);

    const { POST } = await import("@/app/api/usage/sync/route");

    const req = new Request("http://localhost:3777/api/usage/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }) as any;
    // NextRequest needs nextUrl
    Object.defineProperty(req, "nextUrl", {
      get: () => new URL("http://localhost:3777/api/usage/sync"),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Admin API key");
    expect(body.code).toBe("NO_API_KEY");
  });
});

describe("GET /api/usage/summary — route handler", () => {
  it("returns 200 with empty data when no records exist", async () => {
    const { GET } = await import("@/app/api/usage/summary/route");

    const req = new Request("http://localhost:3777/api/usage/summary?period=7d");
    Object.defineProperty(req, "nextUrl", {
      get: () => new URL("http://localhost:3777/api/usage/summary?period=7d"),
    });

    const res = await GET(req as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toBeDefined();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.meta).toBeDefined();
    expect(body.meta.period).toBe("7d");
    expect(body.meta.totalCostCents).toBe(0);
    expect(body.meta.totalInputTokens).toBe(0);
    expect(body.meta.totalOutputTokens).toBe(0);
  });
});

describe("GET /api/usage/by-model — route handler", () => {
  it("returns 200 with empty data when no records", async () => {
    const { GET } = await import("@/app/api/usage/by-model/route");

    const req = new Request("http://localhost:3777/api/usage/by-model?period=7d");
    Object.defineProperty(req, "nextUrl", {
      get: () => new URL("http://localhost:3777/api/usage/by-model?period=7d"),
    });

    const res = await GET(req as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toBeDefined();
    expect(Array.isArray(body.data)).toBe(true);
  });
});

describe("GET /api/usage/by-workspace — route handler", () => {
  it("returns 200 with empty data when no records", async () => {
    const { GET } = await import("@/app/api/usage/by-workspace/route");

    const req = new Request("http://localhost:3777/api/usage/by-workspace?period=7d");
    Object.defineProperty(req, "nextUrl", {
      get: () => new URL("http://localhost:3777/api/usage/by-workspace?period=7d"),
    });

    const res = await GET(req as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toBeDefined();
    expect(Array.isArray(body.data)).toBe(true);
  });
});

describe("GET /api/usage/claude-code — route handler", () => {
  it("returns 200 with zeroed summary when no data", async () => {
    const { GET } = await import("@/app/api/usage/claude-code/route");

    const req = new Request("http://localhost:3777/api/usage/claude-code?period=7d");
    Object.defineProperty(req, "nextUrl", {
      get: () => new URL("http://localhost:3777/api/usage/claude-code?period=7d"),
    });

    const res = await GET(req as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toBeDefined();
    expect(body.data.summary.totalSessions).toBe(0);
    expect(body.data.summary.totalLinesAdded).toBe(0);
    expect(body.data.summary.avgEditAcceptRate).toBe(0);
    expect(body.data.summary.avgWriteAcceptRate).toBe(0);
    expect(body.data.daily).toEqual([]);
    expect(body.data.byUser).toEqual([]);
    expect(body.data.byModel).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. Data transformation and edge case tests
// ═══════════════════════════════════════════════════════════════════════════════

describe("Usage data transformation edge cases", () => {
  it("handles zero-token usage buckets", () => {
    const result = makeUsageResult({
      uncached_input_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 },
      output_tokens: 0,
    });
    const totalInput =
      result.uncached_input_tokens +
      result.cache_read_input_tokens +
      result.cache_creation.ephemeral_5m_input_tokens +
      result.cache_creation.ephemeral_1h_input_tokens;
    expect(totalInput).toBe(0);
    expect(result.output_tokens).toBe(0);
  });

  it("handles very large token counts without overflow", () => {
    const result = makeUsageResult({
      uncached_input_tokens: 100_000_000,
      cache_read_input_tokens: 500_000_000,
      cache_creation: { ephemeral_5m_input_tokens: 10_000_000, ephemeral_1h_input_tokens: 0 },
      output_tokens: 50_000_000,
    });
    const total =
      result.uncached_input_tokens +
      result.cache_read_input_tokens +
      result.cache_creation.ephemeral_5m_input_tokens +
      result.output_tokens;
    expect(total).toBe(660_000_000);
  });

  it("handles cost amounts as string decimals correctly", () => {
    const result = makeCostResult({ amount: "0.01" });
    const cents = parseFloat(result.amount);
    expect(cents).toBeCloseTo(0.01);
    expect(cents).toBeGreaterThan(0);
  });

  it("handles null model in non-grouped usage response", () => {
    const result = makeUsageResult({ model: null });
    expect(result.model).toBeNull();
  });

  it("handles null workspace_id for default workspace", () => {
    const result = makeUsageResult({ workspace_id: null });
    expect(result.workspace_id).toBeNull();
  });

  it("aggregates multiple cost types for same model correctly", () => {
    const costs = [
      makeCostResult({ model: "claude-opus-4-6", token_type: "uncached_input_tokens", amount: "100.00" }),
      makeCostResult({ model: "claude-opus-4-6", token_type: "output_tokens", amount: "200.00" }),
      makeCostResult({ model: "claude-opus-4-6", token_type: "cache_read_input_tokens", amount: "10.00" }),
      makeCostResult({ model: "claude-opus-4-6", token_type: "cache_creation.ephemeral_5m_input_tokens", amount: "50.00" }),
    ];

    const totalCents = costs.reduce((sum, c) => sum + parseFloat(c.amount), 0);
    expect(totalCents).toBeCloseTo(360.0);
  });

  it("handles web_search cost type", () => {
    const result = makeCostResult({
      cost_type: "web_search",
      token_type: null,
      model: null,
      amount: "5.00",
    });
    expect(result.cost_type).toBe("web_search");
    expect(result.token_type).toBeNull();
  });

  it("handles code_execution cost type", () => {
    const result = makeCostResult({
      cost_type: "code_execution",
      token_type: null,
      model: null,
      amount: "2.50",
    });
    expect(result.cost_type).toBe("code_execution");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. Response shape validation
// ═══════════════════════════════════════════════════════════════════════════════

describe("Anthropic API response shape validation", () => {
  it("usage report matches expected schema", () => {
    const response = makeWeeklyUsageResponse();

    expect(response).toHaveProperty("data");
    expect(response).toHaveProperty("has_more");
    expect(response).toHaveProperty("next_page");
    expect(typeof response.has_more).toBe("boolean");

    for (const bucket of response.data) {
      expect(typeof bucket.starting_at).toBe("string");
      expect(typeof bucket.ending_at).toBe("string");
      expect(Array.isArray(bucket.results)).toBe(true);
      expect(() => new Date(bucket.starting_at)).not.toThrow();
      expect(() => new Date(bucket.ending_at)).not.toThrow();

      for (const result of bucket.results) {
        expect(typeof result.uncached_input_tokens).toBe("number");
        expect(typeof result.cache_read_input_tokens).toBe("number");
        expect(typeof result.output_tokens).toBe("number");
        expect(result.cache_creation).toBeDefined();
        expect(typeof result.cache_creation.ephemeral_5m_input_tokens).toBe("number");
        expect(result.server_tool_use).toBeDefined();
      }
    }
  });

  it("cost report matches expected schema", () => {
    const response = makeWeeklyCostResponse();

    expect(response).toHaveProperty("data");
    expect(response).toHaveProperty("has_more");

    for (const bucket of response.data) {
      for (const result of bucket.results) {
        expect(typeof result.amount).toBe("string");
        expect(typeof result.currency).toBe("string");
        expect(isNaN(parseFloat(result.amount))).toBe(false);
      }
    }
  });

  it("all token counts are non-negative", () => {
    const response = makeWeeklyUsageResponse();
    for (const bucket of response.data) {
      for (const result of bucket.results) {
        expect(result.uncached_input_tokens).toBeGreaterThanOrEqual(0);
        expect(result.cache_read_input_tokens).toBeGreaterThanOrEqual(0);
        expect(result.cache_creation.ephemeral_5m_input_tokens).toBeGreaterThanOrEqual(0);
        expect(result.output_tokens).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("bucket time ranges are chronologically ordered", () => {
    const response = makeWeeklyUsageResponse();
    for (let i = 1; i < response.data.length; i++) {
      const prev = new Date(response.data[i - 1].starting_at);
      const curr = new Date(response.data[i].starting_at);
      expect(curr.getTime()).toBeGreaterThan(prev.getTime());
    }
  });

  it("bucket end time is after start time", () => {
    const response = makeWeeklyUsageResponse();
    for (const bucket of response.data) {
      const start = new Date(bucket.starting_at);
      const end = new Date(bucket.ending_at);
      expect(end.getTime()).toBeGreaterThan(start.getTime());
    }
  });
});
