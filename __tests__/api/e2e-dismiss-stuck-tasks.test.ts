import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";

/**
 * End-to-end tests for dismiss/undismiss stuck tasks.
 *
 * Covers:
 * 1. POST /api/teams/[name]/tasks/[id]/respond { action: "dismiss" }
 * 2. POST /api/teams/[name]/tasks/[id]/respond { action: "undismiss" }
 * 3. GET /api/teams/stuck — filters out dismissed tasks
 * 4. Edge cases (dismiss already dismissed, undismiss non-dismissed)
 */

// ── Helpers ──────────────────────────────────────────────────────────────────

let tmpDir: string;

function makeReq(url: string, init?: RequestInit): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:31777"), init);
}

function createTeamConfig(
  name: string,
  overrides: Record<string, unknown> = {}
): void {
  const teamDir = path.join(tmpDir, ".claude", "teams", name);
  fs.mkdirSync(teamDir, { recursive: true });
  fs.writeFileSync(
    path.join(teamDir, "config.json"),
    JSON.stringify({
      name,
      description: `Team ${name}`,
      members: [
        { name: "leader", agentId: "leader-1", agentType: "general-purpose" },
        { name: "dev", agentId: "dev-1", agentType: "general-purpose" },
      ],
      createdAt: new Date().toISOString(),
      ...overrides,
    }),
    "utf-8"
  );
}

function createTask(
  teamName: string,
  task: { id: string; subject: string; status: string; [key: string]: unknown }
): void {
  const taskDir = path.join(tmpDir, ".claude", "tasks", teamName);
  fs.mkdirSync(taskDir, { recursive: true });
  fs.writeFileSync(
    path.join(taskDir, `${task.id}.json`),
    JSON.stringify(task),
    "utf-8"
  );
}

function readTaskFile(teamName: string, taskId: string): Record<string, unknown> {
  const taskFile = path.join(tmpDir, ".claude", "tasks", teamName, `${taskId}.json`);
  return JSON.parse(fs.readFileSync(taskFile, "utf-8"));
}

// ── Setup / Teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-e2e-dismiss-stuck-"));
  vi.stubEnv("HOME", tmpDir);
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 1. POST /api/teams/[name]/tasks/[id]/respond — dismiss action
// ═══════════════════════════════════════════════════════════════════════════════

describe("POST respond — dismiss action", () => {
  it("sets dismissedAt metadata on the task", async () => {
    createTeamConfig("dismiss-team");
    createTask("dismiss-team", {
      id: "1",
      subject: "Stuck task",
      status: "in_progress",
      owner: "dev",
      metadata: {
        blockerType: "decision_needed",
        blockerSummary: "Need API key",
      },
    });

    const { POST } = await import(
      "@/app/api/teams/[name]/tasks/[id]/respond/route"
    );
    const req = makeReq(
      "http://localhost:31777/api/teams/dismiss-team/tasks/1/respond",
      {
        method: "POST",
        body: JSON.stringify({ action: "dismiss" }),
      }
    );
    const res = await POST(req, {
      params: Promise.resolve({ name: "dismiss-team", id: "1" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.action).toBe("dismiss");
    expect(body.data.taskId).toBe("1");

    // Verify task file has dismissedAt set
    const task = readTaskFile("dismiss-team", "1");
    const metadata = task.metadata as Record<string, unknown>;
    expect(metadata.dismissedAt).toBeDefined();
    expect(typeof metadata.dismissedAt).toBe("string");
  });

  it("preserves existing metadata when dismissing", async () => {
    createTeamConfig("dismiss-preserve");
    createTask("dismiss-preserve", {
      id: "1",
      subject: "Task with metadata",
      status: "in_progress",
      owner: "dev",
      metadata: {
        blockerType: "error",
        blockerSummary: "Build failed",
        customField: "keep-me",
      },
    });

    const { POST } = await import(
      "@/app/api/teams/[name]/tasks/[id]/respond/route"
    );
    const req = makeReq(
      "http://localhost:31777/api/teams/dismiss-preserve/tasks/1/respond",
      {
        method: "POST",
        body: JSON.stringify({ action: "dismiss" }),
      }
    );
    await POST(req, {
      params: Promise.resolve({ name: "dismiss-preserve", id: "1" }),
    });

    const task = readTaskFile("dismiss-preserve", "1");
    const metadata = task.metadata as Record<string, unknown>;
    expect(metadata.dismissedAt).toBeDefined();
    expect(metadata.blockerType).toBe("error");
    expect(metadata.blockerSummary).toBe("Build failed");
    expect(metadata.customField).toBe("keep-me");
  });

  it("does not change task status when dismissing", async () => {
    createTeamConfig("dismiss-status");
    createTask("dismiss-status", {
      id: "1",
      subject: "In progress task",
      status: "in_progress",
      owner: "dev",
    });

    const { POST } = await import(
      "@/app/api/teams/[name]/tasks/[id]/respond/route"
    );
    const req = makeReq(
      "http://localhost:31777/api/teams/dismiss-status/tasks/1/respond",
      {
        method: "POST",
        body: JSON.stringify({ action: "dismiss" }),
      }
    );
    await POST(req, {
      params: Promise.resolve({ name: "dismiss-status", id: "1" }),
    });

    const task = readTaskFile("dismiss-status", "1");
    expect(task.status).toBe("in_progress");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. POST /api/teams/[name]/tasks/[id]/respond — undismiss action
// ═══════════════════════════════════════════════════════════════════════════════

describe("POST respond — undismiss action", () => {
  it("clears dismissedAt metadata from the task", async () => {
    createTeamConfig("undismiss-team");
    createTask("undismiss-team", {
      id: "1",
      subject: "Dismissed task",
      status: "in_progress",
      owner: "dev",
      metadata: {
        blockerSummary: "Something stuck",
        dismissedAt: "2026-02-19T00:00:00.000Z",
      },
    });

    const { POST } = await import(
      "@/app/api/teams/[name]/tasks/[id]/respond/route"
    );
    const req = makeReq(
      "http://localhost:31777/api/teams/undismiss-team/tasks/1/respond",
      {
        method: "POST",
        body: JSON.stringify({ action: "undismiss" }),
      }
    );
    const res = await POST(req, {
      params: Promise.resolve({ name: "undismiss-team", id: "1" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.action).toBe("undismiss");
    expect(body.data.taskId).toBe("1");

    // Verify dismissedAt is removed
    const task = readTaskFile("undismiss-team", "1");
    const metadata = task.metadata as Record<string, unknown>;
    expect(metadata.dismissedAt).toBeUndefined();
  });

  it("preserves other metadata when undismissing", async () => {
    createTeamConfig("undismiss-preserve");
    createTask("undismiss-preserve", {
      id: "1",
      subject: "Task to undismiss",
      status: "in_progress",
      owner: "dev",
      metadata: {
        blockerSummary: "Stuck on auth",
        blockerType: "dependency",
        dismissedAt: "2026-02-19T00:00:00.000Z",
        customField: "keep-me",
      },
    });

    const { POST } = await import(
      "@/app/api/teams/[name]/tasks/[id]/respond/route"
    );
    const req = makeReq(
      "http://localhost:31777/api/teams/undismiss-preserve/tasks/1/respond",
      {
        method: "POST",
        body: JSON.stringify({ action: "undismiss" }),
      }
    );
    await POST(req, {
      params: Promise.resolve({ name: "undismiss-preserve", id: "1" }),
    });

    const task = readTaskFile("undismiss-preserve", "1");
    const metadata = task.metadata as Record<string, unknown>;
    expect(metadata.dismissedAt).toBeUndefined();
    expect(metadata.blockerSummary).toBe("Stuck on auth");
    expect(metadata.blockerType).toBe("dependency");
    expect(metadata.customField).toBe("keep-me");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. GET /api/teams/stuck — filters dismissed tasks
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /api/teams/stuck — dismiss filtering", () => {
  it("excludes dismissed tasks from stuck results", async () => {
    createTeamConfig("stuck-filter");
    createTask("stuck-filter", {
      id: "1",
      subject: "Not dismissed",
      status: "in_progress",
      owner: "dev",
      metadata: {
        blockerType: "error",
        blockerSummary: "Build failed",
      },
    });
    createTask("stuck-filter", {
      id: "2",
      subject: "Dismissed task",
      status: "in_progress",
      owner: "dev",
      metadata: {
        blockerType: "decision_needed",
        blockerSummary: "Waiting on decision",
        dismissedAt: "2026-02-19T00:00:00.000Z",
      },
    });

    const { GET } = await import("@/app/api/teams/stuck/route");
    const req = makeReq("http://localhost:31777/api/teams/stuck");
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].subject).toBe("Not dismissed");
    expect(body.meta.totalBlockers).toBe(1);
  });

  it("returns empty when all stuck tasks are dismissed", async () => {
    createTeamConfig("all-dismissed");
    createTask("all-dismissed", {
      id: "1",
      subject: "Dismissed A",
      status: "in_progress",
      owner: "dev",
      metadata: {
        blockerSummary: "Blocker A",
        dismissedAt: "2026-02-19T00:00:00.000Z",
      },
    });
    createTask("all-dismissed", {
      id: "2",
      subject: "Dismissed B",
      status: "in_progress",
      owner: "dev",
      metadata: {
        blockerSummary: "Blocker B",
        dismissedAt: "2026-02-19T01:00:00.000Z",
      },
    });

    const { GET } = await import("@/app/api/teams/stuck/route");
    const req = makeReq("http://localhost:31777/api/teams/stuck");
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(0);
    expect(body.meta.totalBlockers).toBe(0);
  });

  it("does not filter non-dismissed tasks", async () => {
    createTeamConfig("no-dismiss");
    createTask("no-dismiss", {
      id: "1",
      subject: "Stuck task A",
      status: "in_progress",
      owner: "dev",
      metadata: {
        blockerSummary: "Error A",
      },
    });
    createTask("no-dismiss", {
      id: "2",
      subject: "Stuck task B",
      status: "in_progress",
      owner: "dev",
      metadata: {
        blockerSummary: "Error B",
      },
    });

    const { GET } = await import("@/app/api/teams/stuck/route");
    const req = makeReq("http://localhost:31777/api/teams/stuck");
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. Dismiss/undismiss round-trip and edge cases
// ═══════════════════════════════════════════════════════════════════════════════

describe("Dismiss/undismiss — round-trip and edge cases", () => {
  it("dismiss → undismiss round-trip restores task to stuck list", async () => {
    createTeamConfig("roundtrip");
    createTask("roundtrip", {
      id: "1",
      subject: "Round trip task",
      status: "in_progress",
      owner: "dev",
      metadata: {
        blockerType: "error",
        blockerSummary: "Something broke",
      },
    });

    const respond = await import(
      "@/app/api/teams/[name]/tasks/[id]/respond/route"
    );
    const stuck = await import("@/app/api/teams/stuck/route");

    // Step 1: Verify task appears in stuck list initially
    const stuckRes1 = await stuck.GET(
      makeReq("http://localhost:31777/api/teams/stuck")
    );
    const stuckBody1 = await stuckRes1.json();
    expect(stuckBody1.data).toHaveLength(1);

    // Step 2: Dismiss the task
    const dismissReq = makeReq(
      "http://localhost:31777/api/teams/roundtrip/tasks/1/respond",
      {
        method: "POST",
        body: JSON.stringify({ action: "dismiss" }),
      }
    );
    await respond.POST(dismissReq, {
      params: Promise.resolve({ name: "roundtrip", id: "1" }),
    });

    // Step 3: Verify task no longer appears in stuck list
    // Need to re-import to pick up file changes
    vi.resetModules();
    const stuck2 = await import("@/app/api/teams/stuck/route");
    const stuckRes2 = await stuck2.GET(
      makeReq("http://localhost:31777/api/teams/stuck")
    );
    const stuckBody2 = await stuckRes2.json();
    expect(stuckBody2.data).toHaveLength(0);

    // Step 4: Undismiss the task
    vi.resetModules();
    const respond2 = await import(
      "@/app/api/teams/[name]/tasks/[id]/respond/route"
    );
    const undismissReq = makeReq(
      "http://localhost:31777/api/teams/roundtrip/tasks/1/respond",
      {
        method: "POST",
        body: JSON.stringify({ action: "undismiss" }),
      }
    );
    await respond2.POST(undismissReq, {
      params: Promise.resolve({ name: "roundtrip", id: "1" }),
    });

    // Step 5: Verify task reappears in stuck list
    vi.resetModules();
    const stuck3 = await import("@/app/api/teams/stuck/route");
    const stuckRes3 = await stuck3.GET(
      makeReq("http://localhost:31777/api/teams/stuck")
    );
    const stuckBody3 = await stuckRes3.json();
    expect(stuckBody3.data).toHaveLength(1);
    expect(stuckBody3.data[0].subject).toBe("Round trip task");
  });

  it("dismissing an already dismissed task updates dismissedAt", async () => {
    const originalDismissedAt = "2026-01-01T00:00:00.000Z";
    createTeamConfig("double-dismiss");
    createTask("double-dismiss", {
      id: "1",
      subject: "Already dismissed",
      status: "in_progress",
      owner: "dev",
      metadata: {
        blockerSummary: "Stuck",
        dismissedAt: originalDismissedAt,
      },
    });

    const { POST } = await import(
      "@/app/api/teams/[name]/tasks/[id]/respond/route"
    );
    const req = makeReq(
      "http://localhost:31777/api/teams/double-dismiss/tasks/1/respond",
      {
        method: "POST",
        body: JSON.stringify({ action: "dismiss" }),
      }
    );
    const res = await POST(req, {
      params: Promise.resolve({ name: "double-dismiss", id: "1" }),
    });

    expect(res.status).toBe(200);

    const task = readTaskFile("double-dismiss", "1");
    const metadata = task.metadata as Record<string, unknown>;
    // dismissedAt should be updated to a new timestamp
    expect(metadata.dismissedAt).toBeDefined();
    expect(metadata.dismissedAt).not.toBe(originalDismissedAt);
  });

  it("undismissing a non-dismissed task is a no-op (succeeds)", async () => {
    createTeamConfig("undismiss-noop");
    createTask("undismiss-noop", {
      id: "1",
      subject: "Not dismissed",
      status: "in_progress",
      owner: "dev",
      metadata: {
        blockerSummary: "Stuck",
      },
    });

    const { POST } = await import(
      "@/app/api/teams/[name]/tasks/[id]/respond/route"
    );
    const req = makeReq(
      "http://localhost:31777/api/teams/undismiss-noop/tasks/1/respond",
      {
        method: "POST",
        body: JSON.stringify({ action: "undismiss" }),
      }
    );
    const res = await POST(req, {
      params: Promise.resolve({ name: "undismiss-noop", id: "1" }),
    });

    expect(res.status).toBe(200);

    // Task metadata should remain intact without dismissedAt
    const task = readTaskFile("undismiss-noop", "1");
    const metadata = task.metadata as Record<string, unknown>;
    expect(metadata.dismissedAt).toBeUndefined();
    expect(metadata.blockerSummary).toBe("Stuck");
  });

  it("returns 404 for nonexistent team", async () => {
    const { POST } = await import(
      "@/app/api/teams/[name]/tasks/[id]/respond/route"
    );
    const req = makeReq(
      "http://localhost:31777/api/teams/ghost-team/tasks/1/respond",
      {
        method: "POST",
        body: JSON.stringify({ action: "dismiss" }),
      }
    );
    const res = await POST(req, {
      params: Promise.resolve({ name: "ghost-team", id: "1" }),
    });

    expect(res.status).toBe(404);
  });

  it("returns 404 for nonexistent task", async () => {
    createTeamConfig("no-task-team");

    const { POST } = await import(
      "@/app/api/teams/[name]/tasks/[id]/respond/route"
    );
    const req = makeReq(
      "http://localhost:31777/api/teams/no-task-team/tasks/999/respond",
      {
        method: "POST",
        body: JSON.stringify({ action: "dismiss" }),
      }
    );
    const res = await POST(req, {
      params: Promise.resolve({ name: "no-task-team", id: "999" }),
    });

    expect(res.status).toBe(404);
  });

  it("validates action includes dismiss and undismiss", async () => {
    createTeamConfig("validate-action");
    createTask("validate-action", {
      id: "1",
      subject: "Test",
      status: "in_progress",
    });

    const { POST } = await import(
      "@/app/api/teams/[name]/tasks/[id]/respond/route"
    );
    const req = makeReq(
      "http://localhost:31777/api/teams/validate-action/tasks/1/respond",
      {
        method: "POST",
        body: JSON.stringify({ action: "invalid" }),
      }
    );
    const res = await POST(req, {
      params: Promise.resolve({ name: "validate-action", id: "1" }),
    });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(body.error).toContain("dismiss");
    expect(body.error).toContain("undismiss");
  });
});
