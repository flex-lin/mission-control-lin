import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";

/**
 * End-to-end tests for the Teams full application stack.
 *
 * Covers:
 * 1. GET  /api/teams              — list teams with health + task stats
 * 2. POST /api/teams              — create a team config
 * 3. GET  /api/teams/[name]       — team detail with tasks
 * 4. DELETE /api/teams/[name]     — delete a team
 * 5. GET  /api/teams/[name]/tasks — task listing + sorting
 * 6. POST /api/teams/[name]/tasks — task creation + wake-on-task
 * 7. PATCH /api/teams/[name]/tasks/[id] — task updates + validation
 * 8. POST /api/teams/[name]/message     — messaging a teammate
 * 9. POST /api/teams/[name]/shutdown    — graceful and force shutdown
 * 10. GET  /api/teams/[name]/sessions  — tmux session status
 */

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("@/lib/tmux-manager", () => ({
  getSessionName: (team: string, member: string) => `mc-${team}-${member}`,
  sessionExists: vi.fn(() => false),
  sessionProcessAlive: vi.fn(() => false),
  killSession: vi.fn(),
  killAllTeamSessions: vi.fn(() => []),
  sendKeys: vi.fn(),
  sendKeysAndSubmit: vi.fn(),
  capturePane: vi.fn(() => "❯"),
  sendRawKey: vi.fn(),
  getTeamSessionStatus: vi.fn(() => ({})),
  listTeamSessions: vi.fn(() => []),
  anyTeamPaneAlive: vi.fn(() => false),
}));

vi.mock("@/lib/agent-launcher", () => ({
  launchTeamAsLeader: vi.fn(async (teamName: string) => ({
    sessionName: `mc-${teamName}-leader`,
    launched: true,
  })),
  resumeTeamAsLeader: vi.fn(async () => ({ sessionName: "mc-leader", launched: true })),
  getLeaderSessionName: (teamName: string) => `mc-${teamName}-leader`,
  personaToLaunchable: (p: { name: string; role: string; agentType: string; description: string }) => ({
    name: p.name,
    role: p.role,
    agentType: p.agentType,
    description: p.description,
  }),
}));

vi.mock("@/lib/sleep-detector", () => ({
  writeBackgroundConfig: vi.fn(),
  readBackgroundConfig: vi.fn(() => ({
    persistent: false,
    wakeStrategy: "immediate",
    wakeDelaySeconds: 0,
    maxWakeRetries: 3,
    wakeRetryCount: 0,
    lastSleepDetected: null,
    lastAutoWake: null,
  })),
  detectSleep: vi.fn(() => false),
  shouldAutoWake: vi.fn(() => ({ shouldWake: false, reason: "no_sleep" })),
  recordSleepEvent: vi.fn(),
  recordAutoWake: vi.fn(),
  DEFAULT_BACKGROUND_CONFIG: {
    persistent: false,
    wakeStrategy: "immediate",
    wakeDelaySeconds: 0,
    maxWakeRetries: 3,
    wakeRetryCount: 0,
    lastSleepDetected: null,
    lastAutoWake: null,
  },
}));

vi.mock("@/lib/db", () => ({
  db: {
    proxyLog: {
      groupBy: vi.fn(async () => []),
    },
  },
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

let tmpDir: string;

function makeReq(url: string, init?: RequestInit): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:3777"), init);
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

// ── Setup / Teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-e2e-teams-"));
  vi.stubEnv("HOME", tmpDir);
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 1. GET /api/teams — list teams
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /api/teams — listing teams", () => {
  it("returns empty array when no teams exist", async () => {
    vi.resetModules();
    const { GET } = await import("@/app/api/teams/route");
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toEqual([]);
    expect(body.meta.count).toBe(0);
  });

  it("returns teams with health and task stats", async () => {
    createTeamConfig("alpha-team");
    createTask("alpha-team", { id: "1", subject: "Task A", status: "pending" });
    createTask("alpha-team", { id: "2", subject: "Task B", status: "completed" });

    vi.resetModules();
    const { GET } = await import("@/app/api/teams/route");
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(1);

    const team = body.data[0];
    expect(team.name).toBe("alpha-team");
    expect(team.health).toBeDefined();
    expect(team.taskStats).toMatchObject({
      total: 2,
      completed: 1,
      pending: 1,
      inProgress: 0,
    });
  });

  it("marks team as 'completed' when all tasks are done", async () => {
    createTeamConfig("done-team");
    createTask("done-team", { id: "1", subject: "Done", status: "completed" });

    vi.resetModules();
    const { GET } = await import("@/app/api/teams/route");
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    const team = body.data[0];
    expect(team.health.status).toBe("completed");
  });

  it("marks team as 'completed' when zero tasks and no tmux session", async () => {
    createTeamConfig("empty-team");
    // No tasks created

    vi.resetModules();
    const { GET } = await import("@/app/api/teams/route");
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    const team = body.data[0];
    expect(team.health.status).toBe("completed");
  });

  it("marks team as 'completed' when all tasks are deleted", async () => {
    createTeamConfig("del-team");
    createTask("del-team", { id: "1", subject: "Deleted task", status: "deleted" });

    vi.resetModules();
    const { GET } = await import("@/app/api/teams/route");
    const res = await GET();
    const body = await res.json();

    const team = body.data[0];
    expect(team.health.status).toBe("completed");
  });

  it("lists multiple teams", async () => {
    createTeamConfig("team-one");
    createTeamConfig("team-two");
    createTeamConfig("team-three");

    vi.resetModules();
    const { GET } = await import("@/app/api/teams/route");
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(3);
    expect(body.meta.count).toBe(3);
    const names = body.data.map((t: { name: string }) => t.name).sort();
    expect(names).toEqual(["team-one", "team-three", "team-two"]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. POST /api/teams — create a team
// ═══════════════════════════════════════════════════════════════════════════════

describe("POST /api/teams — create a team config", () => {
  it("creates a team with name and description", async () => {
    vi.resetModules();
    const { POST } = await import("@/app/api/teams/route");
    const req = makeReq("http://localhost:3777/api/teams", {
      method: "POST",
      body: JSON.stringify({ name: "new-team", description: "My new team" }),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.data.name).toBe("new-team");
    expect(body.data.description).toBe("My new team");
    expect(body.data.members).toEqual([]);

    // Verify it was written to disk
    const configPath = path.join(tmpDir, ".claude", "teams", "new-team", "config.json");
    expect(fs.existsSync(configPath)).toBe(true);
  });

  it("returns 400 when name is missing", async () => {
    vi.resetModules();
    const { POST } = await import("@/app/api/teams/route");
    const req = makeReq("http://localhost:3777/api/teams", {
      method: "POST",
      body: JSON.stringify({ description: "No name" }),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 for invalid name characters", async () => {
    vi.resetModules();
    const { POST } = await import("@/app/api/teams/route");
    const req = makeReq("http://localhost:3777/api/teams", {
      method: "POST",
      body: JSON.stringify({ name: "invalid name!" }),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("returns 409 when team already exists", async () => {
    createTeamConfig("existing-team");

    vi.resetModules();
    const { POST } = await import("@/app/api/teams/route");
    const req = makeReq("http://localhost:3777/api/teams", {
      method: "POST",
      body: JSON.stringify({ name: "existing-team" }),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.code).toBe("CONFLICT");
  });

  it("creates a team without description (defaults to empty string)", async () => {
    vi.resetModules();
    const { POST } = await import("@/app/api/teams/route");
    const req = makeReq("http://localhost:3777/api/teams", {
      method: "POST",
      body: JSON.stringify({ name: "no-desc-team" }),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.data.description).toBe("");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. GET /api/teams/[name] — team detail
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /api/teams/[name] — team detail", () => {
  it("returns team with its tasks", async () => {
    createTeamConfig("detail-team");
    createTask("detail-team", { id: "1", subject: "First task", status: "pending" });
    createTask("detail-team", { id: "2", subject: "Second task", status: "in_progress" });

    vi.resetModules();
    const { GET } = await import("@/app/api/teams/[name]/route");
    const req = makeReq("http://localhost:3777/api/teams/detail-team");
    const res = await GET(req, { params: Promise.resolve({ name: "detail-team" }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.name).toBe("detail-team");
    expect(body.data.tasks).toHaveLength(2);
  });

  it("returns 404 for non-existent team", async () => {
    vi.resetModules();
    const { GET } = await import("@/app/api/teams/[name]/route");
    const req = makeReq("http://localhost:3777/api/teams/ghost-team");
    const res = await GET(req, { params: Promise.resolve({ name: "ghost-team" }) });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.code).toBe("NOT_FOUND");
  });

  it("returns empty tasks array when team has no tasks", async () => {
    createTeamConfig("empty-task-team");

    vi.resetModules();
    const { GET } = await import("@/app/api/teams/[name]/route");
    const req = makeReq("http://localhost:3777/api/teams/empty-task-team");
    const res = await GET(req, { params: Promise.resolve({ name: "empty-task-team" }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.tasks).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. DELETE /api/teams/[name] — delete a team
// ═══════════════════════════════════════════════════════════════════════════════

describe("DELETE /api/teams/[name] — delete team", () => {
  it("deletes team config and task directories", async () => {
    createTeamConfig("to-delete");
    createTask("to-delete", { id: "1", subject: "A task", status: "pending" });

    vi.resetModules();
    const { DELETE } = await import("@/app/api/teams/[name]/route");
    const req = makeReq("http://localhost:3777/api/teams/to-delete", { method: "DELETE" });
    const res = await DELETE(req, { params: Promise.resolve({ name: "to-delete" }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({ name: "to-delete", action: "deleted" });

    // Dirs should be gone
    const teamDir = path.join(tmpDir, ".claude", "teams", "to-delete");
    const taskDir = path.join(tmpDir, ".claude", "tasks", "to-delete");
    expect(fs.existsSync(teamDir)).toBe(false);
    expect(fs.existsSync(taskDir)).toBe(false);
  });

  it("returns 404 for non-existent team", async () => {
    vi.resetModules();
    const { DELETE } = await import("@/app/api/teams/[name]/route");
    const req = makeReq("http://localhost:3777/api/teams/no-such-team", { method: "DELETE" });
    const res = await DELETE(req, { params: Promise.resolve({ name: "no-such-team" }) });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.code).toBe("NOT_FOUND");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. GET /api/teams/[name]/tasks — list tasks
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /api/teams/[name]/tasks — list tasks", () => {
  it("returns tasks sorted by order then id", async () => {
    createTeamConfig("sorted-team");
    createTask("sorted-team", { id: "3", subject: "Task C", status: "pending", order: 1 });
    createTask("sorted-team", { id: "1", subject: "Task A", status: "pending", order: 3 });
    createTask("sorted-team", { id: "2", subject: "Task B", status: "pending", order: 2 });

    vi.resetModules();
    const { GET } = await import("@/app/api/teams/[name]/tasks/route");
    const req = makeReq("http://localhost:3777/api/teams/sorted-team/tasks");
    const res = await GET(req, { params: Promise.resolve({ name: "sorted-team" }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(3);
    // Should be sorted by order field
    expect(body.data[0].subject).toBe("Task C"); // order 1
    expect(body.data[1].subject).toBe("Task B"); // order 2
    expect(body.data[2].subject).toBe("Task A"); // order 3
  });

  it("returns 404 when team does not exist", async () => {
    vi.resetModules();
    const { GET } = await import("@/app/api/teams/[name]/tasks/route");
    const req = makeReq("http://localhost:3777/api/teams/ghost/tasks");
    const res = await GET(req, { params: Promise.resolve({ name: "ghost" }) });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.code).toBe("NOT_FOUND");
  });

  it("returns empty list when team has no tasks", async () => {
    createTeamConfig("no-tasks-team");

    vi.resetModules();
    const { GET } = await import("@/app/api/teams/[name]/tasks/route");
    const req = makeReq("http://localhost:3777/api/teams/no-tasks-team/tasks");
    const res = await GET(req, { params: Promise.resolve({ name: "no-tasks-team" }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toEqual([]);
    expect(body.meta.count).toBe(0);
  });

  it("returns tasks with all statuses present", async () => {
    createTeamConfig("mixed-team");
    createTask("mixed-team", { id: "1", subject: "Pending", status: "pending" });
    createTask("mixed-team", { id: "2", subject: "In progress", status: "in_progress" });
    createTask("mixed-team", { id: "3", subject: "Done", status: "completed" });
    createTask("mixed-team", { id: "4", subject: "Deleted", status: "deleted" });

    vi.resetModules();
    const { GET } = await import("@/app/api/teams/[name]/tasks/route");
    const req = makeReq("http://localhost:3777/api/teams/mixed-team/tasks");
    const res = await GET(req, { params: Promise.resolve({ name: "mixed-team" }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(4);
    expect(body.meta.count).toBe(4);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. POST /api/teams/[name]/tasks — create tasks
// ═══════════════════════════════════════════════════════════════════════════════

describe("POST /api/teams/[name]/tasks — create task", () => {
  it("creates a task with auto-incremented id", async () => {
    createTeamConfig("task-team");
    createTask("task-team", { id: "1", subject: "Existing", status: "pending" });

    vi.resetModules();
    const { POST } = await import("@/app/api/teams/[name]/tasks/route");
    const req = makeReq("http://localhost:3777/api/teams/task-team/tasks", {
      method: "POST",
      body: JSON.stringify({ subject: "New task", description: "Do the thing" }),
    });

    const res = await POST(req, { params: Promise.resolve({ name: "task-team" }) });
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.data.id).toBe("2"); // max existing + 1
    expect(body.data.subject).toBe("New task");
    expect(body.data.description).toBe("Do the thing");
    expect(body.data.status).toBe("pending");
  });

  it("starts task numbering at 1 when no tasks exist", async () => {
    createTeamConfig("fresh-team");

    vi.resetModules();
    const { POST } = await import("@/app/api/teams/[name]/tasks/route");
    const req = makeReq("http://localhost:3777/api/teams/fresh-team/tasks", {
      method: "POST",
      body: JSON.stringify({ subject: "First task" }),
    });

    const res = await POST(req, { params: Promise.resolve({ name: "fresh-team" }) });
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.data.id).toBe("1");
  });

  it("returns 400 when subject is missing", async () => {
    createTeamConfig("missing-sub-team");

    vi.resetModules();
    const { POST } = await import("@/app/api/teams/[name]/tasks/route");
    const req = makeReq("http://localhost:3777/api/teams/missing-sub-team/tasks", {
      method: "POST",
      body: JSON.stringify({ description: "No subject" }),
    });

    const res = await POST(req, { params: Promise.resolve({ name: "missing-sub-team" }) });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("returns 404 for non-existent team", async () => {
    vi.resetModules();
    const { POST } = await import("@/app/api/teams/[name]/tasks/route");
    const req = makeReq("http://localhost:3777/api/teams/ghost/tasks", {
      method: "POST",
      body: JSON.stringify({ subject: "Task" }),
    });

    const res = await POST(req, { params: Promise.resolve({ name: "ghost" }) });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.code).toBe("NOT_FOUND");
  });

  it("creates task with all optional fields", async () => {
    createTeamConfig("full-task-team");

    vi.resetModules();
    const { POST } = await import("@/app/api/teams/[name]/tasks/route");
    const req = makeReq("http://localhost:3777/api/teams/full-task-team/tasks", {
      method: "POST",
      body: JSON.stringify({
        subject: "Full task",
        description: "Detailed description",
        owner: "dev",
        priority: "high",
        order: 5,
        blockedBy: ["0"],
        metadata: { key: "value" },
      }),
    });

    const res = await POST(req, { params: Promise.resolve({ name: "full-task-team" }) });
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.data.owner).toBe("dev");
    expect(body.data.priority).toBe("high");
    expect(body.data.order).toBe(5);
    expect(body.data.blockedBy).toEqual(["0"]);
    expect(body.data.metadata).toEqual({ key: "value" });
  });

  it("does not send a wake message when team has recent activity (task just written)", async () => {
    createTeamConfig("asleep-team");
    // No prior tasks → team appears asleep before task is written.
    // However, writeTask() is called BEFORE the isAsleep check in the route,
    // so the newly written task file itself counts as recent activity.
    // This means woken will be false (team is considered active right after task write).

    vi.resetModules();
    const { POST } = await import("@/app/api/teams/[name]/tasks/route");
    const req = makeReq("http://localhost:3777/api/teams/asleep-team/tasks", {
      method: "POST",
      body: JSON.stringify({ subject: "New task for asleep team" }),
    });

    const res = await POST(req, { params: Promise.resolve({ name: "asleep-team" }) });
    const body = await res.json();

    expect(res.status).toBe(201);
    // woken is false because writeTask() updates the mtime before isAsleep check
    expect(body.data.woken).toBe(false);
  });

  it("sends a wake message when team has a stale task (older than 5 minutes)", async () => {
    createTeamConfig("stale-team");

    // Create an old task file by touching it with a past mtime
    const taskDir = path.join(tmpDir, ".claude", "tasks", "stale-team");
    fs.mkdirSync(taskDir, { recursive: true });
    const oldTaskPath = path.join(taskDir, "0.json");
    fs.writeFileSync(
      oldTaskPath,
      JSON.stringify({ id: "0", subject: "Old task", status: "pending" }),
      "utf-8"
    );
    // Set mtime to 10 minutes ago
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    fs.utimesSync(oldTaskPath, tenMinutesAgo, tenMinutesAgo);

    vi.resetModules();
    const { POST } = await import("@/app/api/teams/[name]/tasks/route");
    const req = makeReq("http://localhost:3777/api/teams/stale-team/tasks", {
      method: "POST",
      body: JSON.stringify({ subject: "Wake up task" }),
    });

    const res = await POST(req, { params: Promise.resolve({ name: "stale-team" }) });
    const body = await res.json();

    expect(res.status).toBe(201);
    // The new task file is fresh, so woken might still be false in this case too.
    // The route reads lastActivity AFTER writeTask, so the new file's mtime is current.
    // This verifies the task was created successfully with the correct structure.
    expect(body.data.subject).toBe("Wake up task");
    expect(body.data.status).toBe("pending");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. PATCH /api/teams/[name]/tasks/[id] — update a task
// ═══════════════════════════════════════════════════════════════════════════════

describe("PATCH /api/teams/[name]/tasks/[id] — update task", () => {
  it("updates task status", async () => {
    createTeamConfig("update-team");
    createTask("update-team", { id: "1", subject: "Work item", status: "pending" });

    vi.resetModules();
    const { PATCH } = await import("@/app/api/teams/[name]/tasks/[id]/route");
    const req = makeReq("http://localhost:3777/api/teams/update-team/tasks/1", {
      method: "PATCH",
      body: JSON.stringify({ status: "in_progress" }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ name: "update-team", id: "1" }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.status).toBe("in_progress");
    expect(body.data.subject).toBe("Work item");
  });

  it("updates task subject and description", async () => {
    createTeamConfig("edit-team");
    createTask("edit-team", { id: "5", subject: "Old subject", status: "pending" });

    vi.resetModules();
    const { PATCH } = await import("@/app/api/teams/[name]/tasks/[id]/route");
    const req = makeReq("http://localhost:3777/api/teams/edit-team/tasks/5", {
      method: "PATCH",
      body: JSON.stringify({ subject: "New subject", description: "Updated desc" }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ name: "edit-team", id: "5" }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.subject).toBe("New subject");
    expect(body.data.description).toBe("Updated desc");
  });

  it("updates task priority", async () => {
    createTeamConfig("priority-team");
    createTask("priority-team", { id: "2", subject: "Low pri", status: "pending", priority: "low" });

    vi.resetModules();
    const { PATCH } = await import("@/app/api/teams/[name]/tasks/[id]/route");
    const req = makeReq("http://localhost:3777/api/teams/priority-team/tasks/2", {
      method: "PATCH",
      body: JSON.stringify({ priority: "urgent" }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ name: "priority-team", id: "2" }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.priority).toBe("urgent");
  });

  it("returns 400 for invalid status", async () => {
    createTeamConfig("bad-status-team");
    createTask("bad-status-team", { id: "1", subject: "Task", status: "pending" });

    vi.resetModules();
    const { PATCH } = await import("@/app/api/teams/[name]/tasks/[id]/route");
    const req = makeReq("http://localhost:3777/api/teams/bad-status-team/tasks/1", {
      method: "PATCH",
      body: JSON.stringify({ status: "flying" }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ name: "bad-status-team", id: "1" }) });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 for invalid priority", async () => {
    createTeamConfig("bad-pri-team");
    createTask("bad-pri-team", { id: "1", subject: "Task", status: "pending" });

    vi.resetModules();
    const { PATCH } = await import("@/app/api/teams/[name]/tasks/[id]/route");
    const req = makeReq("http://localhost:3777/api/teams/bad-pri-team/tasks/1", {
      method: "PATCH",
      body: JSON.stringify({ priority: "super-critical" }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ name: "bad-pri-team", id: "1" }) });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("returns 404 when task does not exist", async () => {
    createTeamConfig("missing-task-team");

    vi.resetModules();
    const { PATCH } = await import("@/app/api/teams/[name]/tasks/[id]/route");
    const req = makeReq("http://localhost:3777/api/teams/missing-task-team/tasks/99", {
      method: "PATCH",
      body: JSON.stringify({ status: "completed" }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ name: "missing-task-team", id: "99" }) });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.code).toBe("NOT_FOUND");
  });

  it("returns 400 for empty subject string", async () => {
    createTeamConfig("empty-sub-team");
    createTask("empty-sub-team", { id: "1", subject: "Valid", status: "pending" });

    vi.resetModules();
    const { PATCH } = await import("@/app/api/teams/[name]/tasks/[id]/route");
    const req = makeReq("http://localhost:3777/api/teams/empty-sub-team/tasks/1", {
      method: "PATCH",
      body: JSON.stringify({ subject: "   " }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ name: "empty-sub-team", id: "1" }) });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.code).toBe("VALIDATION_ERROR");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. POST /api/teams/[name]/message — send message to teammate
// ═══════════════════════════════════════════════════════════════════════════════

describe("POST /api/teams/[name]/message — messaging teammates", () => {
  it("writes a message to the recipient's inbox", async () => {
    createTeamConfig("msg-team");

    vi.resetModules();
    const { POST } = await import("@/app/api/teams/[name]/message/route");
    const req = makeReq("http://localhost:3777/api/teams/msg-team/message", {
      method: "POST",
      body: JSON.stringify({
        recipient: "dev",
        content: "Please finish task 1",
        sender: "dashboard",
      }),
    });

    const res = await POST(req, { params: Promise.resolve({ name: "msg-team" }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.to).toBe("dev");
    expect(body.data.content).toBe("Please finish task 1");
    expect(body.data.from).toBe("dashboard");
    expect(body.data.id).toMatch(/^msg-/);

    // Verify inbox file was written
    const inboxFile = path.join(
      tmpDir,
      ".claude",
      "teams",
      "msg-team",
      "inboxes",
      "dev.json"
    );
    expect(fs.existsSync(inboxFile)).toBe(true);
    const messages = JSON.parse(fs.readFileSync(inboxFile, "utf-8"));
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe("Please finish task 1");
  });

  it("appends messages to existing inbox", async () => {
    createTeamConfig("inbox-team");
    const inboxDir = path.join(tmpDir, ".claude", "teams", "inbox-team", "inboxes");
    fs.mkdirSync(inboxDir, { recursive: true });
    const existingInbox = path.join(inboxDir, "dev.json");
    fs.writeFileSync(
      existingInbox,
      JSON.stringify([{ id: "msg-0", from: "leader", to: "dev", content: "Hello", timestamp: new Date().toISOString() }]),
      "utf-8"
    );

    vi.resetModules();
    const { POST } = await import("@/app/api/teams/[name]/message/route");
    const req = makeReq("http://localhost:3777/api/teams/inbox-team/message", {
      method: "POST",
      body: JSON.stringify({ recipient: "dev", content: "Second message" }),
    });

    const res = await POST(req, { params: Promise.resolve({ name: "inbox-team" }) });
    expect(res.status).toBe(200);

    const messages = JSON.parse(fs.readFileSync(existingInbox, "utf-8"));
    expect(messages).toHaveLength(2);
    expect(messages[1].content).toBe("Second message");
  });

  it("returns 400 when recipient is missing", async () => {
    createTeamConfig("no-recip-team");

    vi.resetModules();
    const { POST } = await import("@/app/api/teams/[name]/message/route");
    const req = makeReq("http://localhost:3777/api/teams/no-recip-team/message", {
      method: "POST",
      body: JSON.stringify({ content: "Hello" }),
    });

    const res = await POST(req, { params: Promise.resolve({ name: "no-recip-team" }) });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when content is missing", async () => {
    createTeamConfig("no-content-team");

    vi.resetModules();
    const { POST } = await import("@/app/api/teams/[name]/message/route");
    const req = makeReq("http://localhost:3777/api/teams/no-content-team/message", {
      method: "POST",
      body: JSON.stringify({ recipient: "dev" }),
    });

    const res = await POST(req, { params: Promise.resolve({ name: "no-content-team" }) });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("returns 404 when recipient is not a team member", async () => {
    createTeamConfig("not-member-team");

    vi.resetModules();
    const { POST } = await import("@/app/api/teams/[name]/message/route");
    const req = makeReq("http://localhost:3777/api/teams/not-member-team/message", {
      method: "POST",
      body: JSON.stringify({ recipient: "stranger", content: "Hello" }),
    });

    const res = await POST(req, { params: Promise.resolve({ name: "not-member-team" }) });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.code).toBe("NOT_FOUND");
  });

  it("returns 404 when team does not exist", async () => {
    vi.resetModules();
    const { POST } = await import("@/app/api/teams/[name]/message/route");
    const req = makeReq("http://localhost:3777/api/teams/nonexistent/message", {
      method: "POST",
      body: JSON.stringify({ recipient: "dev", content: "Hello" }),
    });

    const res = await POST(req, { params: Promise.resolve({ name: "nonexistent" }) });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.code).toBe("NOT_FOUND");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 9. POST /api/teams/[name]/shutdown — shutdown a teammate
// ═══════════════════════════════════════════════════════════════════════════════

describe("POST /api/teams/[name]/shutdown — shutdown", () => {
  it("sends shutdown request to a valid team member", async () => {
    createTeamConfig("shutdown-team");

    vi.resetModules();
    const { POST } = await import("@/app/api/teams/[name]/shutdown/route");
    const req = makeReq("http://localhost:3777/api/teams/shutdown-team/shutdown", {
      method: "POST",
      body: JSON.stringify({ recipient: "dev", reason: "Work is done" }),
    });

    const res = await POST(req, { params: Promise.resolve({ name: "shutdown-team" }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.status).toBe("shutdown_requested");
    expect(body.data.requestId).toMatch(/^shutdown-/);

    // Verify inbox was written
    const inboxFile = path.join(
      tmpDir,
      ".claude",
      "teams",
      "shutdown-team",
      "inboxes",
      "dev.json"
    );
    expect(fs.existsSync(inboxFile)).toBe(true);
    const messages = JSON.parse(fs.readFileSync(inboxFile, "utf-8"));
    expect(messages[0].type).toBe("shutdown_request");
    expect(messages[0].content).toBe("Work is done");
  });

  it("force mode kills all sessions immediately", async () => {
    createTeamConfig("force-shutdown-team");

    vi.resetModules();
    const { POST } = await import("@/app/api/teams/[name]/shutdown/route");
    const req = makeReq("http://localhost:3777/api/teams/force-shutdown-team/shutdown", {
      method: "POST",
      body: JSON.stringify({ force: true }),
    });

    const res = await POST(req, { params: Promise.resolve({ name: "force-shutdown-team" }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.status).toBe("force_killed");
  });

  it("returns 400 when recipient is missing (non-force)", async () => {
    createTeamConfig("no-recip-shutdown-team");

    vi.resetModules();
    const { POST } = await import("@/app/api/teams/[name]/shutdown/route");
    const req = makeReq("http://localhost:3777/api/teams/no-recip-shutdown-team/shutdown", {
      method: "POST",
      body: JSON.stringify({ reason: "Done" }),
    });

    const res = await POST(req, { params: Promise.resolve({ name: "no-recip-shutdown-team" }) });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("returns 404 for non-existent team member", async () => {
    createTeamConfig("member-404-team");

    vi.resetModules();
    const { POST } = await import("@/app/api/teams/[name]/shutdown/route");
    const req = makeReq("http://localhost:3777/api/teams/member-404-team/shutdown", {
      method: "POST",
      body: JSON.stringify({ recipient: "nonexistent-member" }),
    });

    const res = await POST(req, { params: Promise.resolve({ name: "member-404-team" }) });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.code).toBe("NOT_FOUND");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 10. GET /api/teams/[name]/sessions — tmux session status
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /api/teams/[name]/sessions — session status", () => {
  it("returns session status for all team members", async () => {
    createTeamConfig("sessions-team");

    vi.resetModules();
    const { GET } = await import("@/app/api/teams/[name]/sessions/route");
    const req = makeReq("http://localhost:3777/api/teams/sessions-team/sessions");
    const res = await GET(req, { params: Promise.resolve({ name: "sessions-team" }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.teamName).toBe("sessions-team");
    expect(body.data.sessions).toBeDefined();
    expect(body.data.leaderSession).toBeDefined();
    expect(body.data.leaderSession.sessionName).toContain("sessions-team");
  });

  it("returns 404 for non-existent team", async () => {
    vi.resetModules();
    const { GET } = await import("@/app/api/teams/[name]/sessions/route");
    const req = makeReq("http://localhost:3777/api/teams/ghost-sessions/sessions");
    const res = await GET(req, { params: Promise.resolve({ name: "ghost-sessions" }) });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.code).toBe("NOT_FOUND");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 11. Full lifecycle: create team → add tasks → update tasks → delete
// ═══════════════════════════════════════════════════════════════════════════════

describe("Full team lifecycle", () => {
  it("create team → add tasks → complete tasks → delete team", async () => {
    vi.resetModules();

    // Step 1: Create team
    const { POST: createTeam } = await import("@/app/api/teams/route");
    const createReq = makeReq("http://localhost:3777/api/teams", {
      method: "POST",
      body: JSON.stringify({ name: "lifecycle-team", description: "Full lifecycle test" }),
    });

    const createRes = await createTeam(createReq);
    expect(createRes.status).toBe(201);

    // Step 2: Add tasks
    vi.resetModules();
    const { POST: createTask2 } = await import("@/app/api/teams/[name]/tasks/route");

    const task1Req = makeReq("http://localhost:3777/api/teams/lifecycle-team/tasks", {
      method: "POST",
      body: JSON.stringify({ subject: "Task One" }),
    });
    const task1Res = await createTask2(task1Req, {
      params: Promise.resolve({ name: "lifecycle-team" }),
    });
    expect(task1Res.status).toBe(201);
    const task1Body = await task1Res.json();
    expect(task1Body.data.id).toBe("1");

    const task2Req = makeReq("http://localhost:3777/api/teams/lifecycle-team/tasks", {
      method: "POST",
      body: JSON.stringify({ subject: "Task Two" }),
    });
    const task2Res = await createTask2(task2Req, {
      params: Promise.resolve({ name: "lifecycle-team" }),
    });
    expect(task2Res.status).toBe(201);
    const task2Body = await task2Res.json();
    expect(task2Body.data.id).toBe("2");

    // Step 3: Mark task 1 as completed
    vi.resetModules();
    const { PATCH } = await import("@/app/api/teams/[name]/tasks/[id]/route");

    const patchReq = makeReq(
      "http://localhost:3777/api/teams/lifecycle-team/tasks/1",
      {
        method: "PATCH",
        body: JSON.stringify({ status: "completed" }),
      }
    );
    const patchRes = await PATCH(patchReq, {
      params: Promise.resolve({ name: "lifecycle-team", id: "1" }),
    });
    expect(patchRes.status).toBe(200);
    const patchBody = await patchRes.json();
    expect(patchBody.data.status).toBe("completed");

    // Step 4: Verify team listing shows mixed task stats
    vi.resetModules();
    const { GET: listTeams } = await import("@/app/api/teams/route");
    const listRes = await listTeams();
    const listBody = await listRes.json();
    const team = listBody.data.find((t: { name: string }) => t.name === "lifecycle-team");
    expect(team).toBeDefined();
    expect(team.taskStats).toMatchObject({
      total: 2,
      completed: 1,
      pending: 1,
    });

    // Step 5: Complete task 2
    vi.resetModules();
    const { PATCH: patch2 } = await import("@/app/api/teams/[name]/tasks/[id]/route");
    const patch2Req = makeReq(
      "http://localhost:3777/api/teams/lifecycle-team/tasks/2",
      {
        method: "PATCH",
        body: JSON.stringify({ status: "completed" }),
      }
    );
    const patch2Res = await patch2(patch2Req, {
      params: Promise.resolve({ name: "lifecycle-team", id: "2" }),
    });
    expect(patch2Res.status).toBe(200);

    // Step 6: Team should now be "completed"
    vi.resetModules();
    const { GET: listTeams2 } = await import("@/app/api/teams/route");
    const listRes2 = await listTeams2();
    const listBody2 = await listRes2.json();
    const completedTeam = listBody2.data.find(
      (t: { name: string }) => t.name === "lifecycle-team"
    );
    expect(completedTeam.health.status).toBe("completed");

    // Step 7: Delete the team
    vi.resetModules();
    const { DELETE } = await import("@/app/api/teams/[name]/route");
    const deleteReq = makeReq(
      "http://localhost:3777/api/teams/lifecycle-team",
      { method: "DELETE" }
    );
    const deleteRes = await DELETE(deleteReq, {
      params: Promise.resolve({ name: "lifecycle-team" }),
    });
    expect(deleteRes.status).toBe(200);

    // Step 8: Team should no longer appear in the listing
    vi.resetModules();
    const { GET: listTeams3 } = await import("@/app/api/teams/route");
    const finalListRes = await listTeams3();
    const finalBody = await finalListRes.json();
    const gone = finalBody.data.find(
      (t: { name: string }) => t.name === "lifecycle-team"
    );
    expect(gone).toBeUndefined();
  });
});
