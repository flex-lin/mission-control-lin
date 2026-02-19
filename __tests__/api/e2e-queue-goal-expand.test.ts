import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";

/**
 * End-to-end tests for Queue Task Goal display and expand/collapse behavior.
 *
 * Background: tasks in the queue page display their `goal` field. Long goals
 * are truncated in the UI. The feature under test is the ability for the user
 * to expand the truncated goal to see the full text (and collapse it again).
 *
 * Covers:
 * 1. API: POST /api/queue — creates tasks with long goals intact (no server-side truncation)
 * 2. API: GET /api/queue  — returns full goal string regardless of length
 * 3. API: GET /api/queue/[id] — returns full goal string for a single task
 * 4. API: PATCH /api/queue/[id] — updates goal to a long string and persists it
 * 5. Logic: formatRelativeTime helper function (used in task rows)
 * 6. Logic: formatFileSize helper function (used in attachment indicator)
 * 7. Logic: parseAttachments helper — parses JSON and array variants
 * 8. Logic: parseTeamMembers helper — parses JSON and array variants
 * 9. Logic: goal expand state management (toggling expanded goals)
 * 10. Logic: completed tasks default collapse (>10 tasks → collapsed by default)
 * 11. API: goal field validation — empty/whitespace-only goals rejected
 * 12. API: teamMembers validation — members without name field rejected
 */

// ── Mock DB ───────────────────────────────────────────────────────────────────

const mockQueuedTaskCreate = vi.fn();
const mockQueuedTaskFindMany = vi.fn();
const mockQueuedTaskFindUnique = vi.fn();
const mockQueuedTaskGroupBy = vi.fn();
const mockQueuedTaskUpdate = vi.fn();
const mockQueuedTaskDelete = vi.fn();
const mockQueuedTaskCount = vi.fn();
const mockQueuedTaskFindFirst = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    queuedTask: {
      create: (...args: unknown[]) => mockQueuedTaskCreate(...args),
      findMany: (...args: unknown[]) => mockQueuedTaskFindMany(...args),
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

// ── Helpers ───────────────────────────────────────────────────────────────────

let tmpDir: string;

function makeReq(url: string, init?: RequestInit): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:3777"), init);
}

function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    goal: "Short goal",
    projectPath: "/home/user/project",
    status: "pending",
    teamName: null,
    priority: 0,
    result: null,
    attachments: "[]",
    teamMembers: "[]",
    createdAt: new Date().toISOString(),
    startedAt: null,
    completedAt: null,
    ...overrides,
  };
}

const LONG_GOAL =
  "This is an extremely long goal description that would normally be cut off in the UI because it exceeds the available column width. " +
  "The user needs to be able to expand this text to read the full context of what was requested. " +
  "Without the expand feature, important details about the task requirements would be hidden, making it difficult to understand what was originally asked. " +
  "This paragraph intentionally continues to push past any reasonable truncation boundary to ensure our tests are meaningful.";

// ── Setup / Teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-goal-expand-"));
  vi.stubEnv("HOME", tmpDir);
  vi.clearAllMocks();
  mockQueuedTaskGroupBy.mockResolvedValue([]);
  mockQueuedTaskCount.mockResolvedValue(0);
  mockQueuedTaskFindFirst.mockResolvedValue(null);
});

afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 1. POST /api/queue — creates tasks with long goals intact
// ═══════════════════════════════════════════════════════════════════════════════

describe("POST /api/queue — long goal creation", () => {
  it("stores the full goal text without server-side truncation", async () => {
    const task = makeTask({ id: 1, goal: LONG_GOAL });
    mockQueuedTaskCreate.mockResolvedValue(task);

    vi.resetModules();
    const { POST } = await import("@/app/api/queue/route");
    const req = makeReq("http://localhost:3777/api/queue", {
      method: "POST",
      body: JSON.stringify({ goal: LONG_GOAL }),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.data.goal).toBe(LONG_GOAL);
    expect(mockQueuedTaskCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ goal: LONG_GOAL }),
      })
    );
  });

  it("trims leading and trailing whitespace from goal but keeps inner text", async () => {
    const goalWithSpaces = "  " + LONG_GOAL + "   ";
    const task = makeTask({ goal: LONG_GOAL });
    mockQueuedTaskCreate.mockResolvedValue(task);

    vi.resetModules();
    const { POST } = await import("@/app/api/queue/route");
    const req = makeReq("http://localhost:3777/api/queue", {
      method: "POST",
      body: JSON.stringify({ goal: goalWithSpaces }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);
    // The API should trim before storing
    expect(mockQueuedTaskCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ goal: LONG_GOAL }),
      })
    );
  });

  it("stores a goal with newlines and block formatting intact", async () => {
    const multilineGoal =
      "Build a dashboard feature:\n\n" +
      "1. Add a new chart showing daily token usage\n" +
      "2. Allow filtering by model and team\n" +
      "3. Export data as CSV\n\n" +
      "This task requires changes to both the API layer and the frontend components. " +
      "Please review the analytics-helpers module before starting.";
    const task = makeTask({ goal: multilineGoal });
    mockQueuedTaskCreate.mockResolvedValue(task);

    vi.resetModules();
    const { POST } = await import("@/app/api/queue/route");
    const req = makeReq("http://localhost:3777/api/queue", {
      method: "POST",
      body: JSON.stringify({ goal: multilineGoal }),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.data.goal).toBe(multilineGoal);
  });

  it("rejects empty goal string with validation error", async () => {
    vi.resetModules();
    const { POST } = await import("@/app/api/queue/route");
    const req = makeReq("http://localhost:3777/api/queue", {
      method: "POST",
      body: JSON.stringify({ goal: "" }),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("rejects whitespace-only goal string with validation error", async () => {
    vi.resetModules();
    const { POST } = await import("@/app/api/queue/route");
    const req = makeReq("http://localhost:3777/api/queue", {
      method: "POST",
      body: JSON.stringify({ goal: "   \t\n  " }),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("rejects missing goal field with validation error", async () => {
    vi.resetModules();
    const { POST } = await import("@/app/api/queue/route");
    const req = makeReq("http://localhost:3777/api/queue", {
      method: "POST",
      body: JSON.stringify({ projectPath: "/some/path" }),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.code).toBe("VALIDATION_ERROR");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. GET /api/queue — returns full goal string regardless of length
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /api/queue — full goal returned for all tasks", () => {
  it("returns long goals without truncation in the task list", async () => {
    const tasks = [
      makeTask({ id: 1, goal: LONG_GOAL }),
      makeTask({ id: 2, goal: "Short goal" }),
    ];
    mockQueuedTaskFindMany.mockResolvedValue(tasks);
    mockQueuedTaskGroupBy.mockResolvedValue([
      { status: "pending", _count: { status: 2 } },
    ]);

    vi.resetModules();
    const { GET } = await import("@/app/api/queue/route");
    const req = makeReq("http://localhost:3777/api/queue");
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(2);
    expect(body.data[0].goal).toBe(LONG_GOAL);
    expect(body.data[0].goal.length).toBeGreaterThan(100);
    expect(body.data[1].goal).toBe("Short goal");
  });

  it("returns all tasks including those with paragraph-length goals", async () => {
    const paragraph =
      "Refactor the analytics pipeline to support incremental data ingestion. " +
      "The current implementation loads all proxy logs from the database every time the analytics page is viewed. " +
      "Instead, we should precompute daily snapshots and store them in AnalyticsSnapshot records. " +
      "This work involves updating the ingest endpoint, the by-model and by-team aggregation queries, " +
      "and adding a background job that runs the aggregation once per day at midnight UTC. " +
      "Refer to the existing AnalyticsSnapshot Prisma model and the POST /api/analytics/ingest endpoint.";
    const tasks = [makeTask({ id: 99, goal: paragraph })];
    mockQueuedTaskFindMany.mockResolvedValue(tasks);
    mockQueuedTaskGroupBy.mockResolvedValue([]);

    vi.resetModules();
    const { GET } = await import("@/app/api/queue/route");
    const req = makeReq("http://localhost:3777/api/queue");
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data[0].goal).toBe(paragraph);
  });

  it("returns an empty list when no tasks exist", async () => {
    mockQueuedTaskFindMany.mockResolvedValue([]);
    mockQueuedTaskGroupBy.mockResolvedValue([]);

    vi.resetModules();
    const { GET } = await import("@/app/api/queue/route");
    const req = makeReq("http://localhost:3777/api/queue");
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toEqual([]);
    expect(body.meta.activeCounts).toMatchObject({ pending: 0, running: 0 });
  });

  it("returns goal field as a string type (not truncated object)", async () => {
    const tasks = [makeTask({ id: 1, goal: LONG_GOAL })];
    mockQueuedTaskFindMany.mockResolvedValue(tasks);
    mockQueuedTaskGroupBy.mockResolvedValue([]);

    vi.resetModules();
    const { GET } = await import("@/app/api/queue/route");
    const req = makeReq("http://localhost:3777/api/queue");
    const res = await GET(req);
    const body = await res.json();

    expect(typeof body.data[0].goal).toBe("string");
    // Not a truncation object or wrapper
    expect(body.data[0].goal).not.toHaveProperty("truncated");
    expect(body.data[0].goal).not.toHaveProperty("full");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. GET /api/queue/[id] — returns full goal string for a single task
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /api/queue/[id] — single task with full goal", () => {
  it("returns the full goal for a long-goal task", async () => {
    const task = makeTask({ id: 42, goal: LONG_GOAL });
    mockQueuedTaskFindUnique.mockResolvedValue(task);

    vi.resetModules();
    const { GET } = await import("@/app/api/queue/[id]/route");
    const req = makeReq("http://localhost:3777/api/queue/42");
    const res = await GET(req, { params: Promise.resolve({ id: "42" }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.goal).toBe(LONG_GOAL);
    expect(body.data.goal.length).toBeGreaterThan(100);
  });

  it("returns 404 for a task that does not exist", async () => {
    mockQueuedTaskFindUnique.mockResolvedValue(null);

    vi.resetModules();
    const { GET } = await import("@/app/api/queue/[id]/route");
    const req = makeReq("http://localhost:3777/api/queue/9999");
    const res = await GET(req, { params: Promise.resolve({ id: "9999" }) });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.code).toBe("NOT_FOUND");
  });

  it("returns 400 for non-numeric task ID", async () => {
    vi.resetModules();
    const { GET } = await import("@/app/api/queue/[id]/route");
    const req = makeReq("http://localhost:3777/api/queue/not-a-number");
    const res = await GET(req, {
      params: Promise.resolve({ id: "not-a-number" }),
    });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("returns goal along with all other task fields", async () => {
    const task = makeTask({
      id: 5,
      goal: LONG_GOAL,
      status: "running",
      teamName: "my-team",
      priority: 2,
      projectPath: "/my/project",
    });
    mockQueuedTaskFindUnique.mockResolvedValue(task);

    vi.resetModules();
    const { GET } = await import("@/app/api/queue/[id]/route");
    const req = makeReq("http://localhost:3777/api/queue/5");
    const res = await GET(req, { params: Promise.resolve({ id: "5" }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({
      id: 5,
      goal: LONG_GOAL,
      status: "running",
      teamName: "my-team",
      priority: 2,
      projectPath: "/my/project",
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. PATCH /api/queue/[id] — update goal to a long string
// ═══════════════════════════════════════════════════════════════════════════════

describe("PATCH /api/queue/[id] — update goal to long string", () => {
  it("updates a pending task goal to a long string", async () => {
    const originalTask = makeTask({ id: 1, goal: "Short goal" });
    const updatedTask = { ...originalTask, goal: LONG_GOAL };
    mockQueuedTaskFindUnique.mockResolvedValue(originalTask);
    mockQueuedTaskUpdate.mockResolvedValue(updatedTask);

    vi.resetModules();
    const { PATCH } = await import("@/app/api/queue/[id]/route");
    const req = makeReq("http://localhost:3777/api/queue/1", {
      method: "PATCH",
      body: JSON.stringify({ goal: LONG_GOAL }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: "1" }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.goal).toBe(LONG_GOAL);
    expect(mockQueuedTaskUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 1 },
        data: { goal: LONG_GOAL },
      })
    );
  });

  it("updates goal from a long string to a shorter one", async () => {
    const originalTask = makeTask({ id: 2, goal: LONG_GOAL });
    const updatedTask = { ...originalTask, goal: "New concise goal" };
    mockQueuedTaskFindUnique.mockResolvedValue(originalTask);
    mockQueuedTaskUpdate.mockResolvedValue(updatedTask);

    vi.resetModules();
    const { PATCH } = await import("@/app/api/queue/[id]/route");
    const req = makeReq("http://localhost:3777/api/queue/2", {
      method: "PATCH",
      body: JSON.stringify({ goal: "New concise goal" }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: "2" }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.goal).toBe("New concise goal");
  });

  it("returns 400 when trying to update a running task", async () => {
    const runningTask = makeTask({ id: 3, status: "running", goal: LONG_GOAL });
    mockQueuedTaskFindUnique.mockResolvedValue(runningTask);

    vi.resetModules();
    const { PATCH } = await import("@/app/api/queue/[id]/route");
    const req = makeReq("http://localhost:3777/api/queue/3", {
      method: "PATCH",
      body: JSON.stringify({ goal: "New goal" }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: "3" }) });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.code).toBe("INVALID_STATE");
  });

  it("returns 400 when trying to update a completed task", async () => {
    const completedTask = makeTask({ id: 4, status: "completed", goal: LONG_GOAL });
    mockQueuedTaskFindUnique.mockResolvedValue(completedTask);

    vi.resetModules();
    const { PATCH } = await import("@/app/api/queue/[id]/route");
    const req = makeReq("http://localhost:3777/api/queue/4", {
      method: "PATCH",
      body: JSON.stringify({ goal: "New goal" }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: "4" }) });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.code).toBe("INVALID_STATE");
  });

  it("returns 400 when goal update is an empty string", async () => {
    const pendingTask = makeTask({ id: 5, status: "pending", goal: LONG_GOAL });
    mockQueuedTaskFindUnique.mockResolvedValue(pendingTask);

    vi.resetModules();
    const { PATCH } = await import("@/app/api/queue/[id]/route");
    const req = makeReq("http://localhost:3777/api/queue/5", {
      method: "PATCH",
      body: JSON.stringify({ goal: "" }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: "5" }) });
    const body = await res.json();

    // Empty string is not a valid update — no fields to update
    expect(res.status).toBe(400);
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("updates teamMembers and preserves the goal unchanged", async () => {
    const pendingTask = makeTask({ id: 6, status: "pending", goal: LONG_GOAL });
    const updatedTask = {
      ...pendingTask,
      teamMembers: JSON.stringify([{ id: "1", name: "architect" }]),
    };
    mockQueuedTaskFindUnique.mockResolvedValue(pendingTask);
    mockQueuedTaskUpdate.mockResolvedValue(updatedTask);

    vi.resetModules();
    const { PATCH } = await import("@/app/api/queue/[id]/route");
    const req = makeReq("http://localhost:3777/api/queue/6", {
      method: "PATCH",
      body: JSON.stringify({ teamMembers: [{ id: "1", name: "architect" }] }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: "6" }) });
    expect(res.status).toBe(200);
    // Goal should remain unchanged
    expect(mockQueuedTaskUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          teamMembers: JSON.stringify([{ id: "1", name: "architect" }]),
        }),
      })
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. Logic: formatRelativeTime helper
// ═══════════════════════════════════════════════════════════════════════════════

describe("formatRelativeTime helper logic", () => {
  // Mirror the exact function from the queue page (extracted for unit testing)
  function formatRelativeTime(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  }

  it("returns 'just now' for timestamps less than 1 minute ago", () => {
    const recent = new Date(Date.now() - 30_000).toISOString();
    expect(formatRelativeTime(recent)).toBe("just now");
  });

  it("returns 'just now' for the current timestamp", () => {
    const now = new Date().toISOString();
    expect(formatRelativeTime(now)).toBe("just now");
  });

  it("returns minutes ago for timestamps 1-59 minutes in the past", () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
    expect(formatRelativeTime(fiveMinAgo)).toBe("5m ago");

    const fiftyNineMinAgo = new Date(Date.now() - 59 * 60_000).toISOString();
    expect(formatRelativeTime(fiftyNineMinAgo)).toBe("59m ago");
  });

  it("returns hours ago for timestamps 1-23 hours in the past", () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60_000).toISOString();
    expect(formatRelativeTime(oneHourAgo)).toBe("1h ago");

    const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60_000).toISOString();
    expect(formatRelativeTime(twelveHoursAgo)).toBe("12h ago");
  });

  it("returns days ago for timestamps 24+ hours in the past", () => {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
    expect(formatRelativeTime(oneDayAgo)).toBe("1d ago");

    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60_000).toISOString();
    expect(formatRelativeTime(threeDaysAgo)).toBe("3d ago");
  });

  it("returns '1m ago' exactly at 1 minute boundary", () => {
    const oneMinAgo = new Date(Date.now() - 60_000).toISOString();
    expect(formatRelativeTime(oneMinAgo)).toBe("1m ago");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. Logic: formatFileSize helper
// ═══════════════════════════════════════════════════════════════════════════════

describe("formatFileSize helper logic", () => {
  // Mirror the exact function from the queue page
  function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  it("formats bytes as 'N B' for values under 1024", () => {
    expect(formatFileSize(0)).toBe("0 B");
    expect(formatFileSize(1)).toBe("1 B");
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(1023)).toBe("1023 B");
  });

  it("formats kilobytes as 'N.N KB' for values from 1024 to 1MB-1", () => {
    expect(formatFileSize(1024)).toBe("1.0 KB");
    expect(formatFileSize(1536)).toBe("1.5 KB");
    expect(formatFileSize(10 * 1024)).toBe("10.0 KB");
    expect(formatFileSize(1024 * 1024 - 1)).toBe("1024.0 KB");
  });

  it("formats megabytes as 'N.N MB' for values >= 1MB", () => {
    expect(formatFileSize(1024 * 1024)).toBe("1.0 MB");
    expect(formatFileSize(2.5 * 1024 * 1024)).toBe("2.5 MB");
    expect(formatFileSize(10 * 1024 * 1024)).toBe("10.0 MB");
  });

  it("formats 10MB (the upload limit) correctly", () => {
    expect(formatFileSize(10 * 1024 * 1024)).toBe("10.0 MB");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. Logic: parseAttachments helper
// ═══════════════════════════════════════════════════════════════════════════════

describe("parseAttachments helper logic", () => {
  // Mirror the exact function from the queue page
  function parseAttachments(
    task: { attachments?: unknown }
  ): Array<{ filename: string; originalName: string; mimeType: string; size: number }> {
    if (!task.attachments) return [];
    if (Array.isArray(task.attachments)) return task.attachments as ReturnType<typeof parseAttachments>;
    try {
      return JSON.parse(task.attachments as string);
    } catch {
      return [];
    }
  }

  it("returns empty array when attachments field is null", () => {
    expect(parseAttachments({ attachments: null })).toEqual([]);
  });

  it("returns empty array when attachments field is undefined", () => {
    expect(parseAttachments({})).toEqual([]);
  });

  it("returns empty array when attachments is an empty JSON string", () => {
    expect(parseAttachments({ attachments: "[]" })).toEqual([]);
  });

  it("returns the array as-is when attachments is already an array", () => {
    const arr = [
      { filename: "img.png", originalName: "screenshot.png", mimeType: "image/png", size: 1024 },
    ];
    expect(parseAttachments({ attachments: arr })).toEqual(arr);
  });

  it("parses a valid JSON string into an array of attachments", () => {
    const att = {
      filename: "doc.pdf",
      originalName: "report.pdf",
      mimeType: "application/pdf",
      size: 204800,
    };
    expect(parseAttachments({ attachments: JSON.stringify([att]) })).toEqual([att]);
  });

  it("returns empty array when attachments JSON is malformed", () => {
    expect(parseAttachments({ attachments: "not-valid-json{[" })).toEqual([]);
  });

  it("parses multiple attachments correctly", () => {
    const attachments = [
      { filename: "a.png", originalName: "alpha.png", mimeType: "image/png", size: 500 },
      { filename: "b.txt", originalName: "beta.txt", mimeType: "text/plain", size: 256 },
    ];
    expect(parseAttachments({ attachments: JSON.stringify(attachments) })).toEqual(attachments);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. Logic: parseTeamMembers helper
// ═══════════════════════════════════════════════════════════════════════════════

describe("parseTeamMembers helper logic", () => {
  // Mirror the exact function from the queue page
  function parseTeamMembers(
    task: { teamMembers?: unknown }
  ): Array<{ id: string; name: string; [key: string]: unknown }> {
    if (!task.teamMembers) return [];
    if (Array.isArray(task.teamMembers)) return task.teamMembers as ReturnType<typeof parseTeamMembers>;
    try {
      return JSON.parse(task.teamMembers as string);
    } catch {
      return [];
    }
  }

  it("returns empty array when teamMembers is null", () => {
    expect(parseTeamMembers({ teamMembers: null })).toEqual([]);
  });

  it("returns empty array when teamMembers is undefined", () => {
    expect(parseTeamMembers({})).toEqual([]);
  });

  it("returns empty array when teamMembers is '[]' JSON string", () => {
    expect(parseTeamMembers({ teamMembers: "[]" })).toEqual([]);
  });

  it("returns the array as-is when teamMembers is already an array", () => {
    const members = [{ id: "1", name: "architect" }];
    expect(parseTeamMembers({ teamMembers: members })).toEqual(members);
  });

  it("parses a valid JSON string into an array of team members", () => {
    const members = [
      { id: "1", name: "architect", role: "System Architect" },
      { id: "2", name: "frontend", role: "Frontend Developer" },
    ];
    expect(parseTeamMembers({ teamMembers: JSON.stringify(members) })).toEqual(members);
  });

  it("returns empty array when teamMembers JSON is malformed", () => {
    expect(parseTeamMembers({ teamMembers: "bad{json" })).toEqual([]);
  });

  it("correctly parses a single member", () => {
    const member = { id: "99", name: "reviewer" };
    expect(parseTeamMembers({ teamMembers: JSON.stringify([member]) })).toEqual([member]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 9. Logic: goal expand state management
// ═══════════════════════════════════════════════════════════════════════════════

describe("goal expand state management", () => {
  // The queue page uses a Map<number, boolean> to track which task goals are expanded.
  // This simulates that state machine logic.

  class GoalExpandState {
    private expanded = new Map<number, boolean>();

    isExpanded(taskId: number): boolean {
      return this.expanded.get(taskId) ?? false;
    }

    toggle(taskId: number): void {
      this.expanded.set(taskId, !this.isExpanded(taskId));
    }

    expand(taskId: number): void {
      this.expanded.set(taskId, true);
    }

    collapse(taskId: number): void {
      this.expanded.set(taskId, false);
    }

    collapseAll(): void {
      this.expanded.clear();
    }

    getExpandedIds(): number[] {
      return Array.from(this.expanded.entries())
        .filter(([, v]) => v)
        .map(([k]) => k);
    }
  }

  it("all tasks start in collapsed state", () => {
    const state = new GoalExpandState();
    expect(state.isExpanded(1)).toBe(false);
    expect(state.isExpanded(99)).toBe(false);
  });

  it("toggle expands a collapsed task", () => {
    const state = new GoalExpandState();
    state.toggle(1);
    expect(state.isExpanded(1)).toBe(true);
  });

  it("toggle collapses an expanded task", () => {
    const state = new GoalExpandState();
    state.toggle(1);
    state.toggle(1);
    expect(state.isExpanded(1)).toBe(false);
  });

  it("expand sets a task to expanded", () => {
    const state = new GoalExpandState();
    state.expand(5);
    expect(state.isExpanded(5)).toBe(true);
  });

  it("collapse sets a task to collapsed", () => {
    const state = new GoalExpandState();
    state.expand(5);
    state.collapse(5);
    expect(state.isExpanded(5)).toBe(false);
  });

  it("expanding one task does not affect others", () => {
    const state = new GoalExpandState();
    state.expand(1);
    expect(state.isExpanded(2)).toBe(false);
    expect(state.isExpanded(3)).toBe(false);
  });

  it("multiple tasks can be expanded simultaneously", () => {
    const state = new GoalExpandState();
    state.expand(1);
    state.expand(2);
    state.expand(3);
    expect(state.isExpanded(1)).toBe(true);
    expect(state.isExpanded(2)).toBe(true);
    expect(state.isExpanded(3)).toBe(true);
  });

  it("collapseAll resets all tasks to collapsed", () => {
    const state = new GoalExpandState();
    state.expand(1);
    state.expand(2);
    state.expand(3);
    state.collapseAll();
    expect(state.isExpanded(1)).toBe(false);
    expect(state.isExpanded(2)).toBe(false);
    expect(state.isExpanded(3)).toBe(false);
  });

  it("getExpandedIds returns only expanded task ids", () => {
    const state = new GoalExpandState();
    state.expand(1);
    state.expand(3);
    const ids = state.getExpandedIds();
    expect(ids).toContain(1);
    expect(ids).toContain(3);
    expect(ids).not.toContain(2);
  });

  it("collapsing a task removes it from getExpandedIds", () => {
    const state = new GoalExpandState();
    state.expand(1);
    state.expand(2);
    state.collapse(1);
    expect(state.getExpandedIds()).not.toContain(1);
    expect(state.getExpandedIds()).toContain(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 10. Logic: completed tasks section default collapse behavior
// ═══════════════════════════════════════════════════════════════════════════════

describe("completed tasks section default collapse logic", () => {
  // The queue page collapses the completed section by default when >10 tasks exist.
  // isCompletedOpen = completedOpen ?? completedTasks.length <= 10
  function computeDefaultOpenState(
    completedCount: number,
    userOverride: boolean | null
  ): boolean {
    return userOverride ?? completedCount <= 10;
  }

  it("section is open by default when there are 0 completed tasks", () => {
    expect(computeDefaultOpenState(0, null)).toBe(true);
  });

  it("section is open by default when there are 10 completed tasks", () => {
    expect(computeDefaultOpenState(10, null)).toBe(true);
  });

  it("section is collapsed by default when there are 11 completed tasks", () => {
    expect(computeDefaultOpenState(11, null)).toBe(false);
  });

  it("section is collapsed by default when there are many completed tasks", () => {
    expect(computeDefaultOpenState(100, null)).toBe(false);
  });

  it("user override open=true is respected even with >10 tasks", () => {
    expect(computeDefaultOpenState(50, true)).toBe(true);
  });

  it("user override open=false is respected even with <=10 tasks", () => {
    expect(computeDefaultOpenState(5, false)).toBe(false);
  });

  it("user override open=true is respected with 0 tasks", () => {
    expect(computeDefaultOpenState(0, true)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 11. API: teamMembers validation in POST /api/queue
// ═══════════════════════════════════════════════════════════════════════════════

describe("POST /api/queue — teamMembers validation", () => {
  it("accepts a task with valid teamMembers array", async () => {
    const task = makeTask({
      id: 1,
      goal: "Build something",
      teamMembers: JSON.stringify([{ id: "1", name: "architect" }]),
    });
    mockQueuedTaskCreate.mockResolvedValue(task);

    vi.resetModules();
    const { POST } = await import("@/app/api/queue/route");
    const req = makeReq("http://localhost:3777/api/queue", {
      method: "POST",
      body: JSON.stringify({
        goal: "Build something",
        teamMembers: [{ id: "1", name: "architect" }],
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);
    expect(mockQueuedTaskCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          teamMembers: JSON.stringify([{ id: "1", name: "architect" }]),
        }),
      })
    );
  });

  it("rejects teamMembers where a member is missing the name field", async () => {
    vi.resetModules();
    const { POST } = await import("@/app/api/queue/route");
    const req = makeReq("http://localhost:3777/api/queue", {
      method: "POST",
      body: JSON.stringify({
        goal: "Valid goal",
        teamMembers: [{ id: "1" }], // missing name
      }),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("rejects teamMembers where a member has a non-string name", async () => {
    vi.resetModules();
    const { POST } = await import("@/app/api/queue/route");
    const req = makeReq("http://localhost:3777/api/queue", {
      method: "POST",
      body: JSON.stringify({
        goal: "Valid goal",
        teamMembers: [{ id: "1", name: 123 }], // name must be string
      }),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("accepts a task without teamMembers (optional field)", async () => {
    const task = makeTask({ id: 2, goal: "No members needed" });
    mockQueuedTaskCreate.mockResolvedValue(task);

    vi.resetModules();
    const { POST } = await import("@/app/api/queue/route");
    const req = makeReq("http://localhost:3777/api/queue", {
      method: "POST",
      body: JSON.stringify({ goal: "No members needed" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);
    // teamMembers defaults to "[]"
    expect(mockQueuedTaskCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ teamMembers: "[]" }),
      })
    );
  });

  it("accepts an empty teamMembers array", async () => {
    const task = makeTask({ id: 3, goal: "Empty members" });
    mockQueuedTaskCreate.mockResolvedValue(task);

    vi.resetModules();
    const { POST } = await import("@/app/api/queue/route");
    const req = makeReq("http://localhost:3777/api/queue", {
      method: "POST",
      body: JSON.stringify({ goal: "Empty members", teamMembers: [] }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);
    // Empty array → stored as "[]"
    expect(mockQueuedTaskCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ teamMembers: "[]" }),
      })
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 12. Integration: queue status endpoint with active long-goal tasks
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /api/queue/status — current task with long goal", () => {
  it("returns the full goal of the currently running task", async () => {
    // Write a fresh heartbeat file
    const claudeDir = path.join(tmpDir, ".claude");
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(
      path.join(claudeDir, "queue-worker.heartbeat"),
      new Date().toISOString(),
      "utf-8"
    );

    mockQueuedTaskCount
      .mockResolvedValueOnce(1) // pending
      .mockResolvedValueOnce(1) // running
      .mockResolvedValueOnce(0) // completed
      .mockResolvedValueOnce(0); // failed

    mockQueuedTaskFindFirst.mockResolvedValue({
      id: 7,
      goal: LONG_GOAL,
      teamName: "expand-team",
      startedAt: new Date().toISOString(),
    });

    vi.resetModules();
    const { GET } = await import("@/app/api/queue/status/route");
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.workerRunning).toBe(true);
    expect(body.data.currentTask).toBeDefined();
    expect(body.data.currentTask.goal).toBe(LONG_GOAL);
    expect(body.data.currentTask.teamName).toBe("expand-team");
  });

  it("returns null currentTask when no task is running", async () => {
    mockQueuedTaskCount.mockResolvedValue(0);
    mockQueuedTaskFindFirst.mockResolvedValue(null);

    vi.resetModules();
    const { GET } = await import("@/app/api/queue/status/route");
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.currentTask).toBeNull();
  });
});
