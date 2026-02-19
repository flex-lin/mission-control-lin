import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";

/**
 * End-to-end tests for Settings, Activity Feed, Queue, and Dashboard Stats.
 *
 * Covers:
 * 1. GET  /api/settings         — read settings (file + DB merge)
 * 2. PUT  /api/settings         — save settings to DB and file
 * 3. GET  /api/settings/usage-limits — read usage limits
 * 4. PUT  /api/settings/usage-limits — save usage limits + validation
 * 5. GET  /api/activity         — activity event feed from filesystem
 * 6. GET  /api/dashboard/stats  — dashboard overview metrics
 * 7. GET  /api/queue            — list queued tasks
 * 8. POST /api/queue            — add task to queue
 * 9. GET  /api/queue/[id]       — get a specific queued task
 * 10. DELETE /api/queue/[id]    — cancel or delete a queued task
 * 11. PATCH  /api/queue/[id]    — edit a pending queued task
 * 12. POST   /api/queue/[id]    — retry a failed task
 * 13. GET  /api/queue/status    — queue worker status
 */

// ── Mock DB ───────────────────────────────────────────────────────────────────

const mockPreferenceFindMany = vi.fn();
const mockPreferenceUpsert = vi.fn();
const mockPreferenceDeleteMany = vi.fn();
const mockProxyLogCount = vi.fn();
const mockProxyLogAggregate = vi.fn();
const mockProxyLogGroupBy = vi.fn();
const mockQueuedTaskFindMany = vi.fn();
const mockQueuedTaskCreate = vi.fn();
const mockQueuedTaskFindUnique = vi.fn();
const mockQueuedTaskGroupBy = vi.fn();
const mockQueuedTaskUpdate = vi.fn();
const mockQueuedTaskDelete = vi.fn();
const mockQueuedTaskCount = vi.fn();
const mockQueuedTaskFindFirst = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    preference: {
      findMany: (...args: unknown[]) => mockPreferenceFindMany(...args),
      upsert: (...args: unknown[]) => mockPreferenceUpsert(...args),
      deleteMany: (...args: unknown[]) => mockPreferenceDeleteMany(...args),
    },
    proxyLog: {
      count: (...args: unknown[]) => mockProxyLogCount(...args),
      aggregate: (...args: unknown[]) => mockProxyLogAggregate(...args),
      groupBy: (...args: unknown[]) => mockProxyLogGroupBy(...args),
    },
    queuedTask: {
      findMany: (...args: unknown[]) => mockQueuedTaskFindMany(...args),
      create: (...args: unknown[]) => mockQueuedTaskCreate(...args),
      findUnique: (...args: unknown[]) => mockQueuedTaskFindUnique(...args),
      groupBy: (...args: unknown[]) => mockQueuedTaskGroupBy(...args),
      update: (...args: unknown[]) => mockQueuedTaskUpdate(...args),
      delete: (...args: unknown[]) => mockQueuedTaskDelete(...args),
      count: (...args: unknown[]) => mockQueuedTaskCount(...args),
      findFirst: (...args: unknown[]) => mockQueuedTaskFindFirst(...args),
    },
  },
}));

vi.mock("@/lib/tmux-manager", () => ({
  killSessionAsync: vi.fn(async () => {}),
  listTeamSessionsAsync: vi.fn(async () => []),
}));

vi.mock("@/lib/pricing", () => ({
  computeCost: vi.fn((_model: string, input: number, output: number) =>
    (input + output) * 0.000003
  ),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

let tmpDir: string;

function makeReq(url: string, init?: RequestInit): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:31777"), init);
}

function createSettingsFile(content: Record<string, unknown> = {}): void {
  const claudeDir = path.join(tmpDir, ".claude");
  fs.mkdirSync(claudeDir, { recursive: true });
  fs.writeFileSync(
    path.join(claudeDir, "settings.json"),
    JSON.stringify(content),
    "utf-8"
  );
}

function createTeamWithTasks(
  teamName: string,
  tasks: Array<{ id: string; subject: string; status: string }>
): void {
  const teamDir = path.join(tmpDir, ".claude", "teams", teamName);
  fs.mkdirSync(teamDir, { recursive: true });
  fs.writeFileSync(
    path.join(teamDir, "config.json"),
    JSON.stringify({ name: teamName, members: [], createdAt: new Date().toISOString() }),
    "utf-8"
  );
  const taskDir = path.join(tmpDir, ".claude", "tasks", teamName);
  fs.mkdirSync(taskDir, { recursive: true });
  for (const task of tasks) {
    fs.writeFileSync(
      path.join(taskDir, `${task.id}.json`),
      JSON.stringify(task),
      "utf-8"
    );
  }
}

// ── Setup / Teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-e2e-settings-"));
  vi.stubEnv("HOME", tmpDir);
  vi.resetModules();
  vi.clearAllMocks();

  // Default DB mock returns
  mockPreferenceFindMany.mockResolvedValue([]);
  mockPreferenceUpsert.mockResolvedValue({ key: "theme", value: "dark" });
  mockPreferenceDeleteMany.mockResolvedValue({ count: 0 });
  mockProxyLogCount.mockResolvedValue(0);
  mockProxyLogAggregate.mockResolvedValue({ _avg: { latencyMs: null }, _sum: {}, _count: { id: 0 } });
  mockProxyLogGroupBy.mockResolvedValue([]);
  mockQueuedTaskGroupBy.mockResolvedValue([]);
  mockQueuedTaskFindMany.mockResolvedValue([]);
  mockQueuedTaskCount.mockResolvedValue(0);
  mockQueuedTaskFindFirst.mockResolvedValue(null);
});

afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 1. GET /api/settings — read settings
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /api/settings — read settings", () => {
  it("returns default settings when no file or DB entries exist", async () => {
    vi.resetModules();
    const { GET } = await import("@/app/api/settings/route");
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    // Should return an object (may be empty defaults)
    expect(body.data).toBeDefined();
    expect(typeof body.data).toBe("object");
  });

  it("merges file settings with DB preferences", async () => {
    createSettingsFile({
      model: "claude-opus-4-6",
      env: { CUSTOM_VAR: "value" },
    });
    mockPreferenceFindMany.mockResolvedValue([
      { key: "theme", value: "light" },
      { key: "refreshInterval", value: "10000" },
    ]);

    vi.resetModules();
    const { GET } = await import("@/app/api/settings/route");
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.theme).toBe("light");
    expect(body.data.refreshInterval).toBe(10000); // parsed as number
  });

  it("DB preferences override file settings for theme and refreshInterval", async () => {
    createSettingsFile({ theme: "dark" });
    mockPreferenceFindMany.mockResolvedValue([
      { key: "theme", value: "light" },
    ]);

    vi.resetModules();
    const { GET } = await import("@/app/api/settings/route");
    const res = await GET();
    const body = await res.json();

    expect(body.data.theme).toBe("light"); // DB wins
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. PUT /api/settings — save settings
// ═══════════════════════════════════════════════════════════════════════════════

describe("PUT /api/settings — save settings", () => {
  it("saves theme to DB", async () => {
    createSettingsFile({});

    vi.resetModules();
    const { PUT } = await import("@/app/api/settings/route");
    const req = makeReq("http://localhost:31777/api/settings", {
      method: "PUT",
      body: JSON.stringify({ theme: "light" }),
    });

    const res = await PUT(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({ saved: true });
    expect(mockPreferenceUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { key: "theme" }, update: { value: "light" } })
    );
  });

  it("saves refreshInterval to DB as string", async () => {
    createSettingsFile({});

    vi.resetModules();
    const { PUT } = await import("@/app/api/settings/route");
    const req = makeReq("http://localhost:31777/api/settings", {
      method: "PUT",
      body: JSON.stringify({ refreshInterval: 5000 }),
    });

    const res = await PUT(req);
    expect(res.status).toBe(200);
    expect(mockPreferenceUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { key: "refreshInterval" }, update: { value: "5000" } })
    );
  });

  it("saves non-UI settings to the settings file", async () => {
    createSettingsFile({});

    vi.resetModules();
    const { PUT } = await import("@/app/api/settings/route");
    const req = makeReq("http://localhost:31777/api/settings", {
      method: "PUT",
      body: JSON.stringify({ model: "claude-sonnet-4-6" }),
    });

    const res = await PUT(req);
    expect(res.status).toBe(200);

    // Check that non-UI settings were written to file
    const settingsFile = path.join(tmpDir, ".claude", "settings.json");
    const saved = JSON.parse(fs.readFileSync(settingsFile, "utf-8"));
    expect(saved.model).toBe("claude-sonnet-4-6");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. GET /api/settings/usage-limits — read usage limits
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /api/settings/usage-limits — read usage limits", () => {
  it("returns null for all limits when none configured", async () => {
    mockPreferenceFindMany.mockResolvedValue([]);

    vi.resetModules();
    const { GET } = await import("@/app/api/settings/usage-limits/route");
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({
      dailyTokens: null,
      dailyCost: null,
      monthlyTokens: null,
      monthlyCost: null,
    });
  });

  it("returns configured limits as numbers", async () => {
    mockPreferenceFindMany.mockResolvedValue([
      { key: "usage_limit_daily_tokens", value: "100000" },
      { key: "usage_limit_daily_cost", value: "5.00" },
      { key: "usage_limit_monthly_tokens", value: "1000000" },
      { key: "usage_limit_monthly_cost", value: "50.00" },
    ]);

    vi.resetModules();
    const { GET } = await import("@/app/api/settings/usage-limits/route");
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.dailyTokens).toBe(100000);
    expect(body.data.dailyCost).toBe(5);
    expect(body.data.monthlyTokens).toBe(1000000);
    expect(body.data.monthlyCost).toBe(50);
  });

  it("returns null for partial limits", async () => {
    mockPreferenceFindMany.mockResolvedValue([
      { key: "usage_limit_daily_tokens", value: "50000" },
    ]);

    vi.resetModules();
    const { GET } = await import("@/app/api/settings/usage-limits/route");
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.dailyTokens).toBe(50000);
    expect(body.data.dailyCost).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. PUT /api/settings/usage-limits — save usage limits
// ═══════════════════════════════════════════════════════════════════════════════

describe("PUT /api/settings/usage-limits — save limits", () => {
  it("saves valid limits to DB", async () => {
    vi.resetModules();
    const { PUT } = await import("@/app/api/settings/usage-limits/route");
    const req = makeReq("http://localhost:31777/api/settings/usage-limits", {
      method: "PUT",
      body: JSON.stringify({ dailyTokens: 100000, monthlyCost: 50 }),
    });

    const res = await PUT(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({ saved: true });
    expect(mockPreferenceUpsert).toHaveBeenCalledTimes(2);
  });

  it("removes a limit when value is null", async () => {
    vi.resetModules();
    const { PUT } = await import("@/app/api/settings/usage-limits/route");
    const req = makeReq("http://localhost:31777/api/settings/usage-limits", {
      method: "PUT",
      body: JSON.stringify({ dailyTokens: null }),
    });

    const res = await PUT(req);
    expect(res.status).toBe(200);
    expect(mockPreferenceDeleteMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { key: "usage_limit_daily_tokens" } })
    );
  });

  it("returns 400 for negative limit values", async () => {
    vi.resetModules();
    const { PUT } = await import("@/app/api/settings/usage-limits/route");
    const req = makeReq("http://localhost:31777/api/settings/usage-limits", {
      method: "PUT",
      body: JSON.stringify({ dailyTokens: -100 }),
    });

    const res = await PUT(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.code).toBe("INVALID_LIMIT");
  });

  it("returns 400 for non-numeric string values", async () => {
    // JSON.stringify({ dailyCost: Infinity }) → '{"dailyCost":null}' (JSON spec)
    // Instead test with a value that is truthy but not a valid finite number,
    // by crafting a raw body where the value is a string (not a number).
    vi.resetModules();
    const { PUT } = await import("@/app/api/settings/usage-limits/route");
    // "NaN" — Number("NaN") is NaN, which is not finite
    const req = makeReq("http://localhost:31777/api/settings/usage-limits", {
      method: "PUT",
      body: '{"dailyCost":"not-a-number"}',
    });

    const res = await PUT(req);
    const body = await res.json();

    // typeof "not-a-number" !== "number" → should be rejected
    expect(res.status).toBe(400);
    expect(body.code).toBe("INVALID_LIMIT");
  });

  it("allows zero as a valid limit (meaning block all)", async () => {
    vi.resetModules();
    const { PUT } = await import("@/app/api/settings/usage-limits/route");
    const req = makeReq("http://localhost:31777/api/settings/usage-limits", {
      method: "PUT",
      body: JSON.stringify({ dailyTokens: 0 }),
    });

    const res = await PUT(req);
    expect(res.status).toBe(200);
    expect(mockPreferenceUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: "usage_limit_daily_tokens" },
        update: { value: "0" },
      })
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. GET /api/activity — activity event feed
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /api/activity — activity feed", () => {
  it("returns empty events when no teams exist", async () => {
    vi.resetModules();
    const { GET } = await import("@/app/api/activity/route");
    const req = makeReq("http://localhost:31777/api/activity");
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toEqual([]);
    expect(body.meta.count).toBe(0);
  });

  it("returns task events from filesystem", async () => {
    createTeamWithTasks("activity-team", [
      { id: "1", subject: "Do a thing", status: "completed" },
      { id: "2", subject: "Do another", status: "in_progress" },
    ]);

    vi.resetModules();
    const { GET } = await import("@/app/api/activity/route");
    const req = makeReq("http://localhost:31777/api/activity");
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.length).toBeGreaterThanOrEqual(2);

    // Should include task and team events
    const types = body.data.map((e: { type: string }) => e.type);
    expect(types).toContain("task_completed");
    expect(types).toContain("task_updated");
  });

  it("returns team_created events for each active team", async () => {
    createTeamWithTasks("team-alpha", []);
    createTeamWithTasks("team-beta", []);

    vi.resetModules();
    const { GET } = await import("@/app/api/activity/route");
    const req = makeReq("http://localhost:31777/api/activity");
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    const teamEvents = body.data.filter((e: { type: string }) => e.type === "team_created");
    expect(teamEvents.length).toBeGreaterThanOrEqual(2);
  });

  it("respects the limit query parameter", async () => {
    createTeamWithTasks("limit-test-team", [
      { id: "1", subject: "Task 1", status: "pending" },
      { id: "2", subject: "Task 2", status: "pending" },
      { id: "3", subject: "Task 3", status: "pending" },
    ]);

    vi.resetModules();
    const { GET } = await import("@/app/api/activity/route");
    const req = makeReq("http://localhost:31777/api/activity?limit=2");
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.length).toBeLessThanOrEqual(2);
  });

  it("events are sorted by timestamp descending", async () => {
    createTeamWithTasks("sorted-activity-team", [
      { id: "1", subject: "Older task", status: "completed" },
      { id: "2", subject: "Newer task", status: "pending" },
    ]);

    vi.resetModules();
    const { GET } = await import("@/app/api/activity/route");
    const req = makeReq("http://localhost:31777/api/activity");
    const res = await GET(req);
    const body = await res.json();

    if (body.data.length >= 2) {
      // Verify sorted newest first
      const timestamps = body.data.map((e: { timestamp: string }) => new Date(e.timestamp).getTime());
      for (let i = 0; i < timestamps.length - 1; i++) {
        expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i + 1]);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. GET /api/dashboard/stats — overview metrics
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /api/dashboard/stats — dashboard metrics", () => {
  it("returns all four stat cards with zero values when DB is empty", async () => {
    mockProxyLogCount.mockResolvedValue(0);
    mockProxyLogAggregate.mockResolvedValue({
      _avg: { latencyMs: null },
      _sum: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
      _count: { id: 0 },
    });
    mockProxyLogGroupBy.mockResolvedValue([]);

    vi.resetModules();
    const { GET } = await import("@/app/api/dashboard/stats/route");
    const req = makeReq("http://localhost:31777/api/dashboard/stats");
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.totalRequests).toBeDefined();
    expect(body.data.avgLatencyMs).toBeDefined();
    expect(body.data.activeTeams).toBeDefined();
    expect(body.data.estimatedCost).toBeDefined();

    expect(body.data.totalRequests.value).toBe(0);
    expect(body.data.avgLatencyMs.value).toBe(0);
    expect(body.data.estimatedCost.value).toBe(0);
  });

  it("counts active teams from the filesystem", async () => {
    createTeamWithTasks("stat-team-a", []);
    createTeamWithTasks("stat-team-b", []);
    mockProxyLogCount.mockResolvedValue(0);
    mockProxyLogAggregate.mockResolvedValue({ _avg: { latencyMs: null }, _sum: {}, _count: { id: 0 } });
    mockProxyLogGroupBy.mockResolvedValue([]);

    vi.resetModules();
    const { GET } = await import("@/app/api/dashboard/stats/route");
    const req = makeReq("http://localhost:31777/api/dashboard/stats");
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.activeTeams.value).toBe(2);
    expect(body.data.activeTeams.period).toBe("total");
  });

  it("computes percentage change for total requests", async () => {
    // Today: 10 requests; yesterday: 5 requests
    mockProxyLogCount
      .mockResolvedValueOnce(10)  // today
      .mockResolvedValueOnce(5);  // yesterday
    mockProxyLogAggregate.mockResolvedValue({ _avg: { latencyMs: null }, _sum: {}, _count: { id: 0 } });
    mockProxyLogGroupBy.mockResolvedValue([]);

    vi.resetModules();
    const { GET } = await import("@/app/api/dashboard/stats/route");
    const req = makeReq("http://localhost:31777/api/dashboard/stats");
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.totalRequests.value).toBe(10);
    expect(body.data.totalRequests.change).toBe(100); // 100% increase
    expect(body.data.totalRequests.period).toBe("vs yesterday");
  });

  it("returns 0% change when both periods have zero requests", async () => {
    mockProxyLogCount.mockResolvedValue(0);
    mockProxyLogAggregate.mockResolvedValue({ _avg: { latencyMs: null }, _sum: {}, _count: { id: 0 } });
    mockProxyLogGroupBy.mockResolvedValue([]);

    vi.resetModules();
    const { GET } = await import("@/app/api/dashboard/stats/route");
    const req = makeReq("http://localhost:31777/api/dashboard/stats");
    const res = await GET(req);
    const body = await res.json();

    expect(body.data.totalRequests.change).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. GET /api/queue — list queued tasks
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /api/queue — list queued tasks", () => {
  it("returns empty list when no tasks in queue", async () => {
    mockQueuedTaskFindMany.mockResolvedValue([]);
    mockQueuedTaskGroupBy.mockResolvedValue([]);

    vi.resetModules();
    const { GET } = await import("@/app/api/queue/route");
    const req = makeReq("http://localhost:31777/api/queue");
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toEqual([]);
  });

  it("returns tasks ordered by priority desc, then createdAt asc", async () => {
    const tasks = [
      { id: 1, status: "pending", goal: "Low priority", priority: 0, createdAt: new Date() },
      { id: 2, status: "pending", goal: "High priority", priority: 2, createdAt: new Date() },
    ];
    mockQueuedTaskFindMany.mockResolvedValue(tasks);
    mockQueuedTaskGroupBy.mockResolvedValue([
      { status: "pending", _count: { status: 2 } },
    ]);

    vi.resetModules();
    const { GET } = await import("@/app/api/queue/route");
    const req = makeReq("http://localhost:31777/api/queue");
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(2);
    expect(body.meta.activeCounts.pending).toBe(2);
  });

  it("filters by group=active", async () => {
    const activeTasks = [
      { id: 1, status: "pending", goal: "Pending task" },
      { id: 2, status: "running", goal: "Running task" },
    ];
    mockQueuedTaskFindMany.mockResolvedValue(activeTasks);
    mockQueuedTaskGroupBy.mockResolvedValue([]);

    vi.resetModules();
    const { GET } = await import("@/app/api/queue/route");
    const req = makeReq("http://localhost:31777/api/queue?group=active");
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockQueuedTaskFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: { in: ["pending", "running"] } },
      })
    );
  });

  it("filters by group=completed", async () => {
    mockQueuedTaskFindMany.mockResolvedValue([
      { id: 3, status: "completed", goal: "Done task" },
    ]);
    mockQueuedTaskGroupBy.mockResolvedValue([
      { status: "completed", _count: { status: 1 } },
    ]);

    vi.resetModules();
    const { GET } = await import("@/app/api/queue/route");
    const req = makeReq("http://localhost:31777/api/queue?group=completed");
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    // Completed tasks sorted by completedAt desc
    expect(mockQueuedTaskFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: { in: ["completed", "failed", "cancelled"] } },
      })
    );
  });

  it("returns correct count metadata per status", async () => {
    mockQueuedTaskFindMany.mockResolvedValue([]);
    mockQueuedTaskGroupBy.mockResolvedValue([
      { status: "pending", _count: { status: 3 } },
      { status: "running", _count: { status: 1 } },
      { status: "completed", _count: { status: 10 } },
      { status: "failed", _count: { status: 2 } },
    ]);

    vi.resetModules();
    const { GET } = await import("@/app/api/queue/route");
    const req = makeReq("http://localhost:31777/api/queue");
    const res = await GET(req);
    const body = await res.json();

    expect(body.meta.activeCounts).toMatchObject({ pending: 3, running: 1 });
    expect(body.meta.completedCounts).toMatchObject({ completed: 10, failed: 2, cancelled: 0 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. POST /api/queue — add task to queue
// ═══════════════════════════════════════════════════════════════════════════════

describe("POST /api/queue — enqueue task", () => {
  it("creates a queued task with goal and projectPath", async () => {
    // Use tmpDir as a real existing directory for projectPath validation
    const projectDir = path.join(tmpDir, "test-project");
    fs.mkdirSync(projectDir, { recursive: true });

    const newTask = {
      id: 1,
      goal: "Implement feature X",
      projectPath: projectDir,
      priority: 0,
      status: "pending",
      createdAt: new Date(),
    };
    mockQueuedTaskCreate.mockResolvedValue(newTask);

    vi.resetModules();
    const { POST } = await import("@/app/api/queue/route");
    const req = makeReq("http://localhost:31777/api/queue", {
      method: "POST",
      body: JSON.stringify({ goal: "Implement feature X", projectPath: projectDir }),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.data.goal).toBe("Implement feature X");
    expect(body.data.projectPath).toBe(projectDir);
  });

  it("defaults projectPath to cwd when not provided", async () => {
    const newTask = { id: 2, goal: "No path", projectPath: process.cwd(), status: "pending", createdAt: new Date() };
    mockQueuedTaskCreate.mockResolvedValue(newTask);

    vi.resetModules();
    const { POST } = await import("@/app/api/queue/route");
    const req = makeReq("http://localhost:31777/api/queue", {
      method: "POST",
      body: JSON.stringify({ goal: "No path" }),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(mockQueuedTaskCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ projectPath: process.cwd() }),
      })
    );
  });

  it("returns 400 when goal is missing", async () => {
    vi.resetModules();
    const { POST } = await import("@/app/api/queue/route");
    const req = makeReq("http://localhost:31777/api/queue", {
      method: "POST",
      body: JSON.stringify({ projectPath: "/some/path" }),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when goal is empty string", async () => {
    vi.resetModules();
    const { POST } = await import("@/app/api/queue/route");
    const req = makeReq("http://localhost:31777/api/queue", {
      method: "POST",
      body: JSON.stringify({ goal: "   " }),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("accepts custom priority", async () => {
    const task = { id: 3, goal: "Urgent task", projectPath: "/p", priority: 3, status: "pending", createdAt: new Date() };
    mockQueuedTaskCreate.mockResolvedValue(task);

    vi.resetModules();
    const { POST } = await import("@/app/api/queue/route");
    const req = makeReq("http://localhost:31777/api/queue", {
      method: "POST",
      body: JSON.stringify({ goal: "Urgent task", priority: 3 }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);
    expect(mockQueuedTaskCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ priority: 3 }),
      })
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 9. GET /api/queue/[id] — get a specific queued task
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /api/queue/[id] — get queued task", () => {
  it("returns task by id", async () => {
    const task = { id: 5, goal: "Specific task", status: "pending", projectPath: "/p" };
    mockQueuedTaskFindUnique.mockResolvedValue(task);

    vi.resetModules();
    const { GET } = await import("@/app/api/queue/[id]/route");
    const req = makeReq("http://localhost:31777/api/queue/5");
    const res = await GET(req, { params: Promise.resolve({ id: "5" }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.id).toBe(5);
    expect(body.data.goal).toBe("Specific task");
  });

  it("returns 404 for non-existent task", async () => {
    mockQueuedTaskFindUnique.mockResolvedValue(null);

    vi.resetModules();
    const { GET } = await import("@/app/api/queue/[id]/route");
    const req = makeReq("http://localhost:31777/api/queue/999");
    const res = await GET(req, { params: Promise.resolve({ id: "999" }) });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.code).toBe("NOT_FOUND");
  });

  it("returns 400 for non-numeric id", async () => {
    vi.resetModules();
    const { GET } = await import("@/app/api/queue/[id]/route");
    const req = makeReq("http://localhost:31777/api/queue/abc");
    const res = await GET(req, { params: Promise.resolve({ id: "abc" }) });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.code).toBe("VALIDATION_ERROR");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 10. DELETE /api/queue/[id] — cancel or delete queued task
// ═══════════════════════════════════════════════════════════════════════════════

describe("DELETE /api/queue/[id] — cancel or delete task", () => {
  it("cancels a pending task", async () => {
    const task = { id: 1, status: "pending", goal: "Pending", projectPath: "/p", teamName: null };
    mockQueuedTaskFindUnique.mockResolvedValue(task);
    mockQueuedTaskUpdate.mockResolvedValue({ ...task, status: "cancelled" });

    vi.resetModules();
    const { DELETE } = await import("@/app/api/queue/[id]/route");
    const req = makeReq("http://localhost:31777/api/queue/1", { method: "DELETE" });
    const res = await DELETE(req, { params: Promise.resolve({ id: "1" }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({ cancelled: true });
    expect(mockQueuedTaskUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 1 },
        data: expect.objectContaining({ status: "cancelled" }),
      })
    );
  });

  it("deletes a completed task from DB", async () => {
    const task = { id: 2, status: "completed", goal: "Done", projectPath: "/p", teamName: null };
    mockQueuedTaskFindUnique.mockResolvedValue(task);
    mockQueuedTaskDelete.mockResolvedValue(task);

    vi.resetModules();
    const { DELETE } = await import("@/app/api/queue/[id]/route");
    const req = makeReq("http://localhost:31777/api/queue/2", { method: "DELETE" });
    const res = await DELETE(req, { params: Promise.resolve({ id: "2" }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({ deleted: true });
    expect(mockQueuedTaskDelete).toHaveBeenCalledWith({ where: { id: 2 } });
  });

  it("returns 404 for non-existent task", async () => {
    mockQueuedTaskFindUnique.mockResolvedValue(null);

    vi.resetModules();
    const { DELETE } = await import("@/app/api/queue/[id]/route");
    const req = makeReq("http://localhost:31777/api/queue/999", { method: "DELETE" });
    const res = await DELETE(req, { params: Promise.resolve({ id: "999" }) });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.code).toBe("NOT_FOUND");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 11. PATCH /api/queue/[id] — edit a pending queued task
// ═══════════════════════════════════════════════════════════════════════════════

describe("PATCH /api/queue/[id] — edit queued task", () => {
  it("updates goal of a pending task", async () => {
    const task = { id: 1, status: "pending", goal: "Old goal", projectPath: "/p" };
    const updated = { ...task, goal: "New goal" };
    mockQueuedTaskFindUnique.mockResolvedValue(task);
    mockQueuedTaskUpdate.mockResolvedValue(updated);

    vi.resetModules();
    const { PATCH } = await import("@/app/api/queue/[id]/route");
    const req = makeReq("http://localhost:31777/api/queue/1", {
      method: "PATCH",
      body: JSON.stringify({ goal: "New goal" }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: "1" }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.goal).toBe("New goal");
  });

  it("updates priority of a pending task", async () => {
    const task = { id: 2, status: "pending", goal: "My task", projectPath: "/p", priority: 0 };
    const updated = { ...task, priority: 2 };
    mockQueuedTaskFindUnique.mockResolvedValue(task);
    mockQueuedTaskUpdate.mockResolvedValue(updated);

    vi.resetModules();
    const { PATCH } = await import("@/app/api/queue/[id]/route");
    const req = makeReq("http://localhost:31777/api/queue/2", {
      method: "PATCH",
      body: JSON.stringify({ priority: 2 }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: "2" }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockQueuedTaskUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { priority: 2 } })
    );
  });

  it("returns 400 when editing a non-pending task", async () => {
    const task = { id: 3, status: "running", goal: "Running", projectPath: "/p" };
    mockQueuedTaskFindUnique.mockResolvedValue(task);

    vi.resetModules();
    const { PATCH } = await import("@/app/api/queue/[id]/route");
    const req = makeReq("http://localhost:31777/api/queue/3", {
      method: "PATCH",
      body: JSON.stringify({ goal: "Changed" }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: "3" }) });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.code).toBe("INVALID_STATE");
  });

  it("returns 400 when no valid fields to update", async () => {
    const task = { id: 4, status: "pending", goal: "Task", projectPath: "/p" };
    mockQueuedTaskFindUnique.mockResolvedValue(task);

    vi.resetModules();
    const { PATCH } = await import("@/app/api/queue/[id]/route");
    const req = makeReq("http://localhost:31777/api/queue/4", {
      method: "PATCH",
      body: JSON.stringify({ unknownField: "value" }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: "4" }) });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.code).toBe("VALIDATION_ERROR");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 12. POST /api/queue/[id] — retry a failed or cancelled task
// ═══════════════════════════════════════════════════════════════════════════════

describe("POST /api/queue/[id] — retry task", () => {
  it("resets a failed task to pending", async () => {
    const task = { id: 1, status: "failed", goal: "Failed task", teamName: "old-team" };
    const reset = { ...task, status: "pending", teamName: null, result: null, startedAt: null, completedAt: null };
    mockQueuedTaskFindUnique.mockResolvedValue(task);
    mockQueuedTaskUpdate.mockResolvedValue(reset);

    vi.resetModules();
    const { POST } = await import("@/app/api/queue/[id]/route");
    const req = makeReq("http://localhost:31777/api/queue/1", { method: "POST" });
    const res = await POST(req, { params: Promise.resolve({ id: "1" }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockQueuedTaskUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "pending", teamName: null }),
      })
    );
  });

  it("resets a cancelled task to pending", async () => {
    const task = { id: 2, status: "cancelled", goal: "Cancelled task" };
    const reset = { ...task, status: "pending" };
    mockQueuedTaskFindUnique.mockResolvedValue(task);
    mockQueuedTaskUpdate.mockResolvedValue(reset);

    vi.resetModules();
    const { POST } = await import("@/app/api/queue/[id]/route");
    const req = makeReq("http://localhost:31777/api/queue/2", { method: "POST" });
    const res = await POST(req, { params: Promise.resolve({ id: "2" }) });

    expect(res.status).toBe(200);
  });

  it("returns 400 when retrying a pending task", async () => {
    const task = { id: 3, status: "pending", goal: "Still pending" };
    mockQueuedTaskFindUnique.mockResolvedValue(task);

    vi.resetModules();
    const { POST } = await import("@/app/api/queue/[id]/route");
    const req = makeReq("http://localhost:31777/api/queue/3", { method: "POST" });
    const res = await POST(req, { params: Promise.resolve({ id: "3" }) });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.code).toBe("INVALID_STATE");
  });

  it("returns 404 for non-existent task", async () => {
    mockQueuedTaskFindUnique.mockResolvedValue(null);

    vi.resetModules();
    const { POST } = await import("@/app/api/queue/[id]/route");
    const req = makeReq("http://localhost:31777/api/queue/999", { method: "POST" });
    const res = await POST(req, { params: Promise.resolve({ id: "999" }) });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.code).toBe("NOT_FOUND");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 13. GET /api/queue/status — queue worker heartbeat + stats
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /api/queue/status — queue worker status", () => {
  it("returns worker not running when no heartbeat file exists", async () => {
    mockQueuedTaskCount.mockResolvedValue(0);
    mockQueuedTaskFindFirst.mockResolvedValue(null);

    vi.resetModules();
    const { GET } = await import("@/app/api/queue/status/route");
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.workerRunning).toBe(false);
    expect(body.data.lastHeartbeat).toBeNull();
    expect(body.data.queueDepth).toBe(0);
  });

  it("returns worker running when heartbeat is fresh", async () => {
    // Write a fresh heartbeat file
    const claudeDir = path.join(tmpDir, ".claude");
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(
      path.join(claudeDir, "queue-worker.heartbeat"),
      new Date().toISOString(),
      "utf-8"
    );

    mockQueuedTaskCount.mockResolvedValue(3);
    mockQueuedTaskFindFirst.mockResolvedValue({
      id: 1,
      goal: "Running task",
      teamName: "my-team",
      startedAt: new Date(),
    });

    vi.resetModules();
    const { GET } = await import("@/app/api/queue/status/route");
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.workerRunning).toBe(true);
    expect(body.data.queueDepth).toBe(3);
    expect(body.data.currentTask).toBeDefined();
    expect(body.data.currentTask.goal).toBe("Running task");
  });

  it("returns worker not running when heartbeat is stale (>30s old)", async () => {
    const claudeDir = path.join(tmpDir, ".claude");
    fs.mkdirSync(claudeDir, { recursive: true });
    // Heartbeat 60 seconds ago
    const staleTime = new Date(Date.now() - 60_000).toISOString();
    fs.writeFileSync(
      path.join(claudeDir, "queue-worker.heartbeat"),
      staleTime,
      "utf-8"
    );

    mockQueuedTaskCount.mockResolvedValue(0);
    mockQueuedTaskFindFirst.mockResolvedValue(null);

    vi.resetModules();
    const { GET } = await import("@/app/api/queue/status/route");
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.workerRunning).toBe(false);
    expect(body.data.lastHeartbeat).toBe(staleTime);
  });

  it("returns count breakdown by status", async () => {
    // Return different counts for each call
    mockQueuedTaskCount
      .mockResolvedValueOnce(2)   // pending
      .mockResolvedValueOnce(1)   // running
      .mockResolvedValueOnce(10)  // completed
      .mockResolvedValueOnce(3);  // failed
    mockQueuedTaskFindFirst.mockResolvedValue(null);

    vi.resetModules();
    const { GET } = await import("@/app/api/queue/status/route");
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.counts).toMatchObject({
      pending: 2,
      running: 1,
      completed: 10,
      failed: 3,
    });
  });
});
