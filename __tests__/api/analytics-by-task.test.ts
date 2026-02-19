import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Tests for GET /api/analytics/by-task
 *
 * This endpoint aggregates token usage per task by correlating
 * file-based task data (active + archived teams) with proxy log records.
 */

// ── Mock Prisma DB ───────────────────────────────────────────────────────────

const mockGroupBy = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    proxyLog: {
      groupBy: (...args: unknown[]) => mockGroupBy(...args),
    },
  },
}));

// ── Mock claude-files ────────────────────────────────────────────────────────

const mockListTeams = vi.fn();
const mockReadTaskList = vi.fn();

vi.mock("@/lib/claude-files", () => ({
  listTeams: (...args: unknown[]) => mockListTeams(...args),
  readTaskList: (...args: unknown[]) => mockReadTaskList(...args),
}));

// ── Mock fs for archived teams ───────────────────────────────────────────────

const mockExistsSync = vi.fn();
const mockReaddirSync = vi.fn();
const mockReadFileSync = vi.fn();

vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs");
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: (...args: unknown[]) => mockExistsSync(...args),
      readdirSync: (...args: unknown[]) => mockReaddirSync(...args),
      readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
    },
  };
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeRequest(period?: string) {
  const url = period
    ? `http://localhost:31777/api/analytics/by-task?period=${period}`
    : "http://localhost:31777/api/analytics/by-task";
  return new NextRequest(new URL(url));
}

async function callGET(period?: string) {
  vi.resetModules();
  const mod = await import("@/app/api/analytics/by-task/route");
  const res = await mod.GET(makeRequest(period));
  return { status: res.status, body: await res.json() };
}

function makeProxyLogRow(overrides: Record<string, unknown>) {
  return {
    teamName: "my-team",
    memberName: "dev",
    model: "claude-sonnet-4-6",
    _sum: {
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    },
    _count: { id: 1 },
    ...overrides,
  };
}

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  // Default: no active teams, no archived teams, no proxy logs
  mockListTeams.mockReturnValue([]);
  mockReadTaskList.mockReturnValue([]);
  mockGroupBy.mockResolvedValue([]);
  // fs mocks: no archive directory by default
  mockExistsSync.mockReturnValue(false);
  mockReaddirSync.mockReturnValue([]);
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe("GET /api/analytics/by-task", () => {
  it("returns empty array when no teams exist", async () => {
    const { status, body } = await callGET();

    expect(status).toBe(200);
    expect(body.data).toEqual([]);
    expect(body.meta.count).toBe(0);
  });

  it("returns task entries with correct token aggregation", async () => {
    mockListTeams.mockReturnValue([{ name: "my-team" }]);
    mockReadTaskList.mockReturnValue([
      { id: "1", subject: "Build API", status: "completed", owner: "dev" },
    ]);
    mockGroupBy.mockResolvedValue([
      makeProxyLogRow({
        teamName: "my-team",
        memberName: "dev",
        model: "claude-sonnet-4-6",
        _sum: {
          inputTokens: 5000,
          outputTokens: 2000,
          cacheReadTokens: 1000,
          cacheCreationTokens: 500,
        },
        _count: { id: 3 },
      }),
    ]);

    const { status, body } = await callGET();

    expect(status).toBe(200);
    expect(body.data).toHaveLength(1);

    const entry = body.data[0];
    expect(entry.taskId).toBe("1");
    expect(entry.subject).toBe("Build API");
    expect(entry.status).toBe("completed");
    expect(entry.owner).toBe("dev");
    expect(entry.teamName).toBe("my-team");
    // input = baseInput(5000) + cacheRead(1000) + cacheCreate(500) = 6500
    expect(entry.totalInput).toBe(6500);
    expect(entry.totalOutput).toBe(2000);
    expect(entry.totalTokens).toBe(8500);
    expect(entry.requests).toBe(3);
    expect(entry.estimatedCost).toBeGreaterThan(0);
  });

  it("respects period filter — passes period to groupBy where clause", async () => {
    mockListTeams.mockReturnValue([{ name: "team-a" }]);
    mockReadTaskList.mockReturnValue([
      { id: "1", subject: "Task 1", status: "pending" },
    ]);
    mockGroupBy.mockResolvedValue([]);

    // Test 7d (default)
    await callGET("7d");
    let whereArg = mockGroupBy.mock.calls[0][0].where;
    const cutoff7d = whereArg.timestamp.gte;
    expect(cutoff7d).toBeInstanceOf(Date);

    vi.clearAllMocks();
    mockListTeams.mockReturnValue([{ name: "team-a" }]);
    mockReadTaskList.mockReturnValue([
      { id: "1", subject: "Task 1", status: "pending" },
    ]);
    mockGroupBy.mockResolvedValue([]);

    // Test 30d
    await callGET("30d");
    whereArg = mockGroupBy.mock.calls[0][0].where;
    const cutoff30d = whereArg.timestamp.gte;
    expect(cutoff30d).toBeInstanceOf(Date);
    // 30d cutoff should be earlier than 7d cutoff
    expect(cutoff30d.getTime()).toBeLessThan(cutoff7d.getTime());

    vi.clearAllMocks();
    mockListTeams.mockReturnValue([{ name: "team-a" }]);
    mockReadTaskList.mockReturnValue([
      { id: "1", subject: "Task 1", status: "pending" },
    ]);
    mockGroupBy.mockResolvedValue([]);

    // Test "all"
    await callGET("all");
    whereArg = mockGroupBy.mock.calls[0][0].where;
    const cutoffAll = whereArg.timestamp.gte;
    expect(cutoffAll.getTime()).toBeLessThan(cutoff30d.getTime());
  });

  it("handles tasks with no matching proxy logs — returns zeros", async () => {
    mockListTeams.mockReturnValue([{ name: "team-x" }]);
    mockReadTaskList.mockReturnValue([
      { id: "1", subject: "No logs task", status: "in_progress", owner: "dev" },
      { id: "2", subject: "Unowned task", status: "pending" },
    ]);
    mockGroupBy.mockResolvedValue([]); // no proxy logs at all

    const { status, body } = await callGET();

    expect(status).toBe(200);
    expect(body.data).toHaveLength(2);

    for (const entry of body.data) {
      expect(entry.totalInput).toBe(0);
      expect(entry.totalOutput).toBe(0);
      expect(entry.totalTokens).toBe(0);
      expect(entry.estimatedCost).toBe(0);
      expect(entry.requests).toBe(0);
    }
  });

  it("handles archived teams", async () => {
    // No active teams
    mockListTeams.mockReturnValue([]);

    // Archived teams exist
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockImplementation((dirPath: string, opts?: unknown) => {
      if (typeof dirPath === "string" && dirPath.includes("tasks-archive")) {
        // Check if called with withFileTypes option
        if (opts && typeof opts === "object" && (opts as Record<string, unknown>).withFileTypes) {
          return [{ name: "archived-team", isDirectory: () => true }];
        }
        // Called for files inside the archived team dir
        return ["1.json", "2.json"];
      }
      return [];
    });
    mockReadFileSync.mockImplementation((filePath: string) => {
      if (filePath.includes("1.json")) {
        return JSON.stringify({
          id: "1",
          subject: "Archived task 1",
          status: "completed",
          owner: "dev",
        });
      }
      if (filePath.includes("2.json")) {
        return JSON.stringify({
          id: "2",
          subject: "Archived task 2",
          status: "completed",
          owner: "dev",
        });
      }
      return "{}";
    });

    mockGroupBy.mockResolvedValue([
      makeProxyLogRow({
        teamName: "archived-team",
        memberName: "dev",
        _sum: {
          inputTokens: 3000,
          outputTokens: 1500,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
        },
        _count: { id: 5 },
      }),
    ]);

    const { status, body } = await callGET();

    expect(status).toBe(200);
    expect(body.data).toHaveLength(2);

    const archivedEntries = body.data.filter(
      (e: Record<string, unknown>) => e.teamName === "archived-team"
    );
    expect(archivedEntries).toHaveLength(2);
    // Both tasks owned by "dev" share the same proxy log aggregate
    expect(archivedEntries[0].totalInput).toBe(3000);
    expect(archivedEntries[0].requests).toBe(5);
  });

  it("correctly correlates memberName with task owner", async () => {
    mockListTeams.mockReturnValue([{ name: "multi-team" }]);
    mockReadTaskList.mockReturnValue([
      { id: "1", subject: "Backend work", status: "completed", owner: "backend-dev" },
      { id: "2", subject: "Frontend work", status: "completed", owner: "frontend-dev" },
      { id: "3", subject: "Unowned work", status: "pending" },
    ]);
    mockGroupBy.mockResolvedValue([
      makeProxyLogRow({
        teamName: "multi-team",
        memberName: "backend-dev",
        _sum: {
          inputTokens: 10000,
          outputTokens: 5000,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
        },
        _count: { id: 10 },
      }),
      makeProxyLogRow({
        teamName: "multi-team",
        memberName: "frontend-dev",
        _sum: {
          inputTokens: 8000,
          outputTokens: 3000,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
        },
        _count: { id: 7 },
      }),
    ]);

    const { status, body } = await callGET();

    expect(status).toBe(200);
    expect(body.data).toHaveLength(3);

    const backendTask = body.data.find(
      (e: Record<string, unknown>) => e.owner === "backend-dev"
    );
    expect(backendTask.totalInput).toBe(10000);
    expect(backendTask.totalOutput).toBe(5000);
    expect(backendTask.requests).toBe(10);

    const frontendTask = body.data.find(
      (e: Record<string, unknown>) => e.owner === "frontend-dev"
    );
    expect(frontendTask.totalInput).toBe(8000);
    expect(frontendTask.totalOutput).toBe(3000);
    expect(frontendTask.requests).toBe(7);

    // Unowned task should have zero tokens
    const unownedTask = body.data.find(
      (e: Record<string, unknown>) => e.owner === null
    );
    expect(unownedTask.totalInput).toBe(0);
    expect(unownedTask.totalOutput).toBe(0);
    expect(unownedTask.requests).toBe(0);
  });

  it("aggregates multiple proxy log rows for same team:member", async () => {
    mockListTeams.mockReturnValue([{ name: "agg-team" }]);
    mockReadTaskList.mockReturnValue([
      { id: "1", subject: "Multi-model task", status: "completed", owner: "dev" },
    ]);
    // Two different models for the same team:member
    mockGroupBy.mockResolvedValue([
      makeProxyLogRow({
        teamName: "agg-team",
        memberName: "dev",
        model: "claude-sonnet-4-6",
        _sum: {
          inputTokens: 2000,
          outputTokens: 1000,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
        },
        _count: { id: 2 },
      }),
      makeProxyLogRow({
        teamName: "agg-team",
        memberName: "dev",
        model: "claude-haiku-4-5-20251001",
        _sum: {
          inputTokens: 3000,
          outputTokens: 500,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
        },
        _count: { id: 4 },
      }),
    ]);

    const { status, body } = await callGET();

    expect(status).toBe(200);
    expect(body.data).toHaveLength(1);

    const entry = body.data[0];
    // Aggregated across both models: 2000+3000=5000 input, 1000+500=1500 output
    expect(entry.totalInput).toBe(5000);
    expect(entry.totalOutput).toBe(1500);
    expect(entry.totalTokens).toBe(6500);
    expect(entry.requests).toBe(6);
    expect(entry.estimatedCost).toBeGreaterThan(0);
  });

  it("uses default 7d period when no period param provided", async () => {
    mockListTeams.mockReturnValue([]);
    mockGroupBy.mockResolvedValue([]);

    await callGET(); // no period param

    expect(mockGroupBy).toHaveBeenCalledOnce();
    const whereArg = mockGroupBy.mock.calls[0][0].where;
    const cutoff = whereArg.timestamp.gte;
    // Should be ~7 days ago
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    // Allow 1 second tolerance
    expect(Math.abs(cutoff.getTime() - sevenDaysAgo.getTime())).toBeLessThan(1000);
  });

  it("returns correct response shape for each entry", async () => {
    mockListTeams.mockReturnValue([{ name: "shape-team" }]);
    mockReadTaskList.mockReturnValue([
      { id: "42", subject: "Verify shape", status: "in_progress", owner: "tester" },
    ]);
    mockGroupBy.mockResolvedValue([]);

    const { status, body } = await callGET();

    expect(status).toBe(200);
    const entry = body.data[0];

    // Verify all expected fields are present
    expect(entry).toHaveProperty("taskId", "42");
    expect(entry).toHaveProperty("subject", "Verify shape");
    expect(entry).toHaveProperty("status", "in_progress");
    expect(entry).toHaveProperty("owner", "tester");
    expect(entry).toHaveProperty("teamName", "shape-team");
    expect(entry).toHaveProperty("totalInput");
    expect(entry).toHaveProperty("totalOutput");
    expect(entry).toHaveProperty("totalTokens");
    expect(entry).toHaveProperty("estimatedCost");
    expect(entry).toHaveProperty("requests");
  });
});
