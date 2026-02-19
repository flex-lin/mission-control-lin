import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Tests for queue group filtering — the active/completed split.
 *
 * The GET /api/queue endpoint supports a `group` query parameter:
 *   - No group: returns all tasks (backwards compatible)
 *   - group=active: returns only pending + running tasks
 *   - group=completed: returns only completed + failed + cancelled tasks
 *   - Response always includes meta.activeCounts and meta.completedCounts
 */

// ── Mock Prisma DB ─────────────────────────────────────────────────────────

const mockFindMany = vi.fn();
const mockGroupBy = vi.fn();
const mockCreate = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    queuedTask: {
      findMany: (...args: unknown[]) => mockFindMany(...args),
      groupBy: (...args: unknown[]) => mockGroupBy(...args),
      create: (...args: unknown[]) => mockCreate(...args),
    },
  },
}));

// ── Test Data ──────────────────────────────────────────────────────────────

function makeTask(overrides: Record<string, unknown>) {
  return {
    id: 1,
    goal: "Test task",
    projectPath: "/tmp/project",
    status: "pending",
    teamName: null,
    priority: 0,
    result: null,
    createdAt: new Date().toISOString(),
    startedAt: null,
    completedAt: null,
    ...overrides,
  };
}

const SAMPLE_TASKS = [
  makeTask({ id: 1, status: "pending", goal: "Pending task" }),
  makeTask({ id: 2, status: "running", goal: "Running task" }),
  makeTask({ id: 3, status: "completed", goal: "Completed task", completedAt: new Date().toISOString() }),
  makeTask({ id: 4, status: "failed", goal: "Failed task", result: "Error: timeout", completedAt: new Date().toISOString() }),
  makeTask({ id: 5, status: "cancelled", goal: "Cancelled task", completedAt: new Date().toISOString() }),
];

const SAMPLE_COUNTS = [
  { status: "pending", _count: { status: 1 } },
  { status: "running", _count: { status: 1 } },
  { status: "completed", _count: { status: 1 } },
  { status: "failed", _count: { status: 1 } },
  { status: "cancelled", _count: { status: 1 } },
];

// ── Helpers ────────────────────────────────────────────────────────────────

function makeRequest(url: string) {
  return new NextRequest(new URL(url, "http://localhost:3777"));
}

async function callGET(url: string) {
  // Dynamic import to pick up the mock
  const mod = await import("@/app/api/queue/route");
  const req = makeRequest(url);
  const res = await mod.GET(req);
  return { status: res.status, body: await res.json() };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("GET /api/queue — group filtering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGroupBy.mockResolvedValue(SAMPLE_COUNTS);
  });

  // ── No group parameter (backwards compatible) ────────────────────────

  describe("no group parameter (all tasks)", () => {
    it("returns all tasks when no group is specified", async () => {
      mockFindMany.mockResolvedValue(SAMPLE_TASKS);

      const { status, body } = await callGET("/api/queue");

      expect(status).toBe(200);
      expect(body.data).toHaveLength(5);
    });

    it("calls findMany with empty where clause", async () => {
      mockFindMany.mockResolvedValue([]);

      await callGET("/api/queue");

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {} })
      );
    });

    it("returns correct meta counts", async () => {
      mockFindMany.mockResolvedValue(SAMPLE_TASKS);

      const { body } = await callGET("/api/queue");

      expect(body.meta).toEqual({
        activeCounts: { pending: 1, running: 1 },
        completedCounts: { completed: 1, failed: 1, cancelled: 1 },
      });
    });
  });

  // ── group=active ─────────────────────────────────────────────────────

  describe("group=active", () => {
    it("filters to pending + running tasks", async () => {
      const activeTasks = SAMPLE_TASKS.filter((t) =>
        ["pending", "running"].includes(t.status as string)
      );
      mockFindMany.mockResolvedValue(activeTasks);

      const { status, body } = await callGET("/api/queue?group=active");

      expect(status).toBe(200);
      expect(body.data).toHaveLength(2);
      for (const task of body.data) {
        expect(["pending", "running"]).toContain(task.status);
      }
    });

    it("passes correct where clause for active group", async () => {
      mockFindMany.mockResolvedValue([]);

      await callGET("/api/queue?group=active");

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: { in: ["pending", "running"] } },
        })
      );
    });

    it("orders active tasks by priority desc, then createdAt asc", async () => {
      mockFindMany.mockResolvedValue([]);

      await callGET("/api/queue?group=active");

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
        })
      );
    });

    it("returns empty array when no active tasks exist", async () => {
      mockFindMany.mockResolvedValue([]);

      const { status, body } = await callGET("/api/queue?group=active");

      expect(status).toBe(200);
      expect(body.data).toHaveLength(0);
    });
  });

  // ── group=completed ──────────────────────────────────────────────────

  describe("group=completed", () => {
    it("filters to completed + failed + cancelled tasks", async () => {
      const completedTasks = SAMPLE_TASKS.filter((t) =>
        ["completed", "failed", "cancelled"].includes(t.status as string)
      );
      mockFindMany.mockResolvedValue(completedTasks);

      const { status, body } = await callGET("/api/queue?group=completed");

      expect(status).toBe(200);
      expect(body.data).toHaveLength(3);
      for (const task of body.data) {
        expect(["completed", "failed", "cancelled"]).toContain(task.status);
      }
    });

    it("passes correct where clause for completed group", async () => {
      mockFindMany.mockResolvedValue([]);

      await callGET("/api/queue?group=completed");

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: { in: ["completed", "failed", "cancelled"] } },
        })
      );
    });

    it("orders completed tasks by completedAt desc, then createdAt desc", async () => {
      mockFindMany.mockResolvedValue([]);

      await callGET("/api/queue?group=completed");

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }],
        })
      );
    });

    it("returns empty array when no completed tasks exist", async () => {
      mockFindMany.mockResolvedValue([]);

      const { status, body } = await callGET("/api/queue?group=completed");

      expect(status).toBe(200);
      expect(body.data).toHaveLength(0);
    });
  });

  // ── Legacy status filter (backwards compatibility) ───────────────────

  describe("legacy status filter", () => {
    it("supports comma-separated status filter", async () => {
      const failedTasks = SAMPLE_TASKS.filter((t) => t.status === "failed");
      mockFindMany.mockResolvedValue(failedTasks);

      const { status, body } = await callGET("/api/queue?status=failed");

      expect(status).toBe(200);
      expect(body.data).toHaveLength(1);
      expect(body.data[0].status).toBe("failed");
    });

    it("group parameter takes precedence over status filter", async () => {
      mockFindMany.mockResolvedValue([]);

      await callGET("/api/queue?group=active&status=completed");

      // group=active should be used, not status=completed
      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: { in: ["pending", "running"] } },
        })
      );
    });
  });

  // ── Meta counts always present ───────────────────────────────────────

  describe("meta counts", () => {
    it("includes meta counts on active group request", async () => {
      mockFindMany.mockResolvedValue([]);

      const { body } = await callGET("/api/queue?group=active");

      expect(body.meta).toBeDefined();
      expect(body.meta.activeCounts).toBeDefined();
      expect(body.meta.completedCounts).toBeDefined();
    });

    it("includes meta counts on completed group request", async () => {
      mockFindMany.mockResolvedValue([]);

      const { body } = await callGET("/api/queue?group=completed");

      expect(body.meta).toBeDefined();
      expect(body.meta.activeCounts).toBeDefined();
      expect(body.meta.completedCounts).toBeDefined();
    });

    it("returns zero counts when no tasks exist", async () => {
      mockFindMany.mockResolvedValue([]);
      mockGroupBy.mockResolvedValue([]);

      const { body } = await callGET("/api/queue");

      expect(body.meta).toEqual({
        activeCounts: { pending: 0, running: 0 },
        completedCounts: { completed: 0, failed: 0, cancelled: 0 },
      });
    });

    it("correctly aggregates counts from groupBy results", async () => {
      mockFindMany.mockResolvedValue([]);
      mockGroupBy.mockResolvedValue([
        { status: "pending", _count: { status: 5 } },
        { status: "running", _count: { status: 2 } },
        { status: "completed", _count: { status: 10 } },
        { status: "failed", _count: { status: 3 } },
      ]);

      const { body } = await callGET("/api/queue");

      expect(body.meta).toEqual({
        activeCounts: { pending: 5, running: 2 },
        completedCounts: { completed: 10, failed: 3, cancelled: 0 },
      });
    });
  });

  // ── Error handling ───────────────────────────────────────────────────

  describe("error handling", () => {
    it("returns 500 on database error", async () => {
      mockFindMany.mockRejectedValue(new Error("DB connection failed"));

      const { status, body } = await callGET("/api/queue");

      expect(status).toBe(500);
      expect(body.error).toBe("Internal server error");
      expect(body.code).toBe("SERVER_ERROR");
    });
  });
});

// ── POST /api/queue/{id} retry tests ─────────────────────────────────────

describe("POST /api/queue/{id} — retry", () => {
  const mockFindUnique = vi.fn();
  const mockUpdate = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();

    // We need to re-mock for the [id] route
    vi.doMock("@/lib/db", () => ({
      db: {
        queuedTask: {
          findUnique: (...args: unknown[]) => mockFindUnique(...args),
          update: (...args: unknown[]) => mockUpdate(...args),
        },
      },
    }));

    vi.doMock("@/lib/tmux-manager", () => ({
      listTeamSessions: vi.fn(() => []),
      killSession: vi.fn(),
    }));
  });

  it("retries a failed task by resetting to pending", async () => {
    const failedTask = makeTask({ id: 10, status: "failed", result: "Error" });
    mockFindUnique.mockResolvedValue(failedTask);
    mockUpdate.mockResolvedValue({ ...failedTask, status: "pending", result: null });

    vi.resetModules();
    const mod = await import("@/app/api/queue/[id]/route");
    const req = makeRequest("/api/queue/10");
    const res = await mod.POST(req, { params: Promise.resolve({ id: "10" }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 10 },
        data: expect.objectContaining({
          status: "pending",
          teamName: null,
          result: null,
        }),
      })
    );
  });

  it("retries a cancelled task", async () => {
    const cancelledTask = makeTask({ id: 11, status: "cancelled" });
    mockFindUnique.mockResolvedValue(cancelledTask);
    mockUpdate.mockResolvedValue({ ...cancelledTask, status: "pending" });

    vi.resetModules();
    const mod = await import("@/app/api/queue/[id]/route");
    const req = makeRequest("/api/queue/11");
    const res = await mod.POST(req, { params: Promise.resolve({ id: "11" }) });

    expect(res.status).toBe(200);
  });

  it("rejects retry on a pending task", async () => {
    const pendingTask = makeTask({ id: 12, status: "pending" });
    mockFindUnique.mockResolvedValue(pendingTask);

    vi.resetModules();
    const mod = await import("@/app/api/queue/[id]/route");
    const req = makeRequest("/api/queue/12");
    const res = await mod.POST(req, { params: Promise.resolve({ id: "12" }) });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.code).toBe("INVALID_STATE");
  });
});

// ── DELETE /api/queue/{id} remove tests ──────────────────────────────────

describe("DELETE /api/queue/{id} — remove/cancel", () => {
  const mockFindUnique = vi.fn();
  const mockUpdate = vi.fn();
  const mockDelete = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();

    vi.doMock("@/lib/db", () => ({
      db: {
        queuedTask: {
          findUnique: (...args: unknown[]) => mockFindUnique(...args),
          update: (...args: unknown[]) => mockUpdate(...args),
          delete: (...args: unknown[]) => mockDelete(...args),
        },
      },
    }));

    vi.doMock("@/lib/tmux-manager", () => ({
      listTeamSessions: vi.fn(() => []),
      killSession: vi.fn(),
    }));
  });

  it("cancels a pending task (sets status to cancelled)", async () => {
    const pendingTask = makeTask({ id: 20, status: "pending" });
    mockFindUnique.mockResolvedValue(pendingTask);
    mockUpdate.mockResolvedValue({ ...pendingTask, status: "cancelled" });

    vi.resetModules();
    const mod = await import("@/app/api/queue/[id]/route");
    const req = makeRequest("/api/queue/20");
    const res = await mod.DELETE(req, { params: Promise.resolve({ id: "20" }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.cancelled).toBe(true);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "cancelled" }),
      })
    );
  });

  it("permanently removes a completed task", async () => {
    const completedTask = makeTask({ id: 21, status: "completed" });
    mockFindUnique.mockResolvedValue(completedTask);
    mockDelete.mockResolvedValue(completedTask);

    vi.resetModules();
    const mod = await import("@/app/api/queue/[id]/route");
    const req = makeRequest("/api/queue/21");
    const res = await mod.DELETE(req, { params: Promise.resolve({ id: "21" }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.deleted).toBe(true);
    expect(mockDelete).toHaveBeenCalledWith({ where: { id: 21 } });
  });

  it("permanently removes a failed task", async () => {
    const failedTask = makeTask({ id: 22, status: "failed" });
    mockFindUnique.mockResolvedValue(failedTask);
    mockDelete.mockResolvedValue(failedTask);

    vi.resetModules();
    const mod = await import("@/app/api/queue/[id]/route");
    const req = makeRequest("/api/queue/22");
    const res = await mod.DELETE(req, { params: Promise.resolve({ id: "22" }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.deleted).toBe(true);
  });

  it("returns 404 for non-existent task", async () => {
    mockFindUnique.mockResolvedValue(null);

    vi.resetModules();
    const mod = await import("@/app/api/queue/[id]/route");
    const req = makeRequest("/api/queue/999");
    const res = await mod.DELETE(req, { params: Promise.resolve({ id: "999" }) });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.code).toBe("NOT_FOUND");
  });
});
