import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";

/**
 * Comprehensive tests for POST /api/chatbot
 *
 * Covers:
 * 1. Input validation — missing messages, empty array, wrong types
 * 2. Response shape — { reply: string }
 * 3. Agentic loop — end_turn stops, tool_use continues, max iterations
 * 4. Tool: list_teams — reads teams from filesystem
 * 5. Tool: get_team_detail — reads team config + tasks
 * 6. Tool: submit_queue_task — creates DB record
 * 7. Tool: list_queue_tasks — queries DB with optional status filter
 * 8. Tool: cancel_queue_task — updates task to cancelled
 * 9. Tool: get_queue_worker_status — heartbeat file + DB counts
 * 10. Tool: get_analytics_summary — aggregates proxy logs
 * 11. Tool: get_stuck_tasks — scans stale in_progress tasks
 * 12. Tool: send_message_to_team — writes inbox file
 * 13. Tool: get_proxy_logs — queries proxy logs
 * 14. Tool: get_dashboard_stats — team/task/queue overview
 * 15. Unknown tool graceful error
 * 16. SDK error → 500
 * 17. Message history / SDK call shape
 */

// ── DB Mocks ───────────────────────────────────────────────────────────────────

const mockQueuedTaskCreate = vi.fn();
const mockQueuedTaskFindMany = vi.fn();
const mockQueuedTaskFindUnique = vi.fn();
const mockQueuedTaskUpdate = vi.fn();
const mockQueuedTaskGroupBy = vi.fn();
const mockProxyLogFindMany = vi.fn();
const mockProxyLogAggregate = vi.fn();
const mockIndexedProjectFindMany = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    queuedTask: {
      create: (...args: unknown[]) => mockQueuedTaskCreate(...args),
      findMany: (...args: unknown[]) => mockQueuedTaskFindMany(...args),
      findUnique: (...args: unknown[]) => mockQueuedTaskFindUnique(...args),
      update: (...args: unknown[]) => mockQueuedTaskUpdate(...args),
      groupBy: (...args: unknown[]) => mockQueuedTaskGroupBy(...args),
    },
    proxyLog: {
      findMany: (...args: unknown[]) => mockProxyLogFindMany(...args),
      aggregate: (...args: unknown[]) => mockProxyLogAggregate(...args),
    },
    indexedProject: {
      findMany: (...args: unknown[]) => mockIndexedProjectFindMany(...args),
    },
  },
}));

// ── Claude-files Mocks ─────────────────────────────────────────────────────────
// Mock the filesystem-based functions to control what teams/tasks are returned.

const mockListTeams = vi.fn();
const mockReadTeamConfig = vi.fn();
const mockReadTaskList = vi.fn();

vi.mock("@/lib/claude-files", () => ({
  listTeams: (...args: unknown[]) => mockListTeams(...args),
  readTeamConfig: (...args: unknown[]) => mockReadTeamConfig(...args),
  readTaskList: (...args: unknown[]) => mockReadTaskList(...args),
  // Other exports needed by the route (stub with no-ops)
  getTeamLastActivity: vi.fn(() => null),
  archiveTeam: vi.fn(),
  findTeamBySourceTaskId: vi.fn(() => null),
  readBackgroundConfig: vi.fn(() => ({ persistent: false })),
}));

// ── Anthropic SDK Mock ────────────────────────────────────────────────────────

type MockAnthropicResponse = {
  stop_reason: "end_turn" | "tool_use";
  content: Array<
    | { type: "text"; text: string }
    | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  >;
};

declare global {
  // eslint-disable-next-line no-var
  var __anthropicMock: {
    queue: Array<MockAnthropicResponse | Error>;
    calls: Array<Record<string, unknown>>;
  };
}

globalThis.__anthropicMock = { queue: [], calls: [] };

vi.mock("@anthropic-ai/sdk", () => {
  class MockAnthropic {
    messages = {
      create(opts: Record<string, unknown>): Promise<MockAnthropicResponse> {
        // Deep-clone to capture the snapshot at call time (not later mutations)
        const snapshot = JSON.parse(JSON.stringify(opts)) as Record<string, unknown>;
        globalThis.__anthropicMock.calls.push(snapshot);
        const item = globalThis.__anthropicMock.queue.shift();
        if (!item) return Promise.reject(new Error("No mock Anthropic response queued"));
        if (item instanceof Error) return Promise.reject(item);
        return Promise.resolve(item);
      },
    };
  }
  return { default: MockAnthropic };
});

// ── Queue helpers ──────────────────────────────────────────────────────────────

function queueEndTurn(text = "Done."): void {
  globalThis.__anthropicMock.queue.push({
    stop_reason: "end_turn",
    content: [{ type: "text", text }],
  });
}

function queueToolUse(id: string, name: string, input: Record<string, unknown> = {}): void {
  globalThis.__anthropicMock.queue.push({
    stop_reason: "tool_use",
    content: [{ type: "tool_use", id, name, input }],
  });
}

function queueSdkError(message: string): void {
  globalThis.__anthropicMock.queue.push(new Error(message));
}

function getCallCount(): number {
  return globalThis.__anthropicMock.calls.length;
}

function getCall(index: number): Record<string, unknown> {
  return globalThis.__anthropicMock.calls[index] ?? {};
}

function getToolResultContent(callIndex = 1): string | null {
  const call = getCall(callIndex);
  if (!call) return null;
  const messages = call.messages as Array<{ role: string; content: unknown }> | undefined;
  if (!messages) return null;
  const last = messages[messages.length - 1];
  if (!last || last.role !== "user") return null;
  const content = last.content;
  if (!Array.isArray(content)) return null;
  const toolResult = (content as Array<{ type: string; content?: string }>).find(
    (c) => c.type === "tool_result"
  );
  return toolResult?.content ?? null;
}

// ── Filesystem helpers (for send_message_to_team and heartbeat tests) ─────────

let tmpDir: string;

// The route computes CLAUDE_DIR at module load time using process.env.HOME before
// any vi.stubEnv call, so CLAUDE_DIR always points to the real HOME/.claude.
// We compute the same path here so our filesystem assertions match.
const REAL_CLAUDE_DIR = path.join(process.env.HOME!, ".claude");

// ── Request factory ────────────────────────────────────────────────────────────

function makeReq(body: unknown): NextRequest {
  return new NextRequest(new URL("http://localhost:31777/api/chatbot"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ── Route import ───────────────────────────────────────────────────────────────
import * as ChatbotRoute from "@/app/api/chatbot/route";
const { POST } = ChatbotRoute;

// ── Default mock team data ─────────────────────────────────────────────────────

function makeTeam(name: string, members: { name: string; agentId: string; agentType: string }[] = []) {
  return { name, description: "Test", members, createdAt: new Date().toISOString() };
}

function makeTask(id: string, subject: string, status: string, owner?: string, metadata?: Record<string, unknown>) {
  return { id, subject, status, owner, metadata };
}

// ── Setup / Teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-chatbot-test-"));
  vi.stubEnv("HOME", tmpDir);
  vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test-key");
  // Reset shared mock state
  globalThis.__anthropicMock.queue.length = 0;
  globalThis.__anthropicMock.calls.length = 0;
  // Reset DB mocks
  mockQueuedTaskCreate.mockReset();
  mockQueuedTaskFindMany.mockReset();
  mockQueuedTaskFindUnique.mockReset();
  mockQueuedTaskUpdate.mockReset();
  mockQueuedTaskGroupBy.mockReset();
  mockProxyLogFindMany.mockReset();
  mockProxyLogAggregate.mockReset();
  mockIndexedProjectFindMany.mockReset();
  // Reset claude-files mocks
  mockListTeams.mockReset();
  mockReadTeamConfig.mockReset();
  mockReadTaskList.mockReset();
  // Set default return values
  mockListTeams.mockReturnValue([]);
  mockReadTaskList.mockReturnValue([]);
  mockReadTeamConfig.mockReturnValue(null);
});

afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ── 1. Input Validation ────────────────────────────────────────────────────────

describe("POST /api/chatbot — input validation", () => {
  it("returns 400 when messages field is missing", async () => {
    const res = await POST(makeReq({}));
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/messages/i);
  });

  it("returns 400 when messages is not an array", async () => {
    const res = await POST(makeReq({ messages: "hello" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when messages is an empty array", async () => {
    const res = await POST(makeReq({ messages: [] }));
    expect(res.status).toBe(400);
  });

  it("accepts a valid single user message", async () => {
    queueEndTurn("Hello!");
    const res = await POST(makeReq({ messages: [{ role: "user", content: "Hello" }] }));
    expect(res.status).toBe(200);
  });

  it("accepts multi-turn conversation history", async () => {
    queueEndTurn("Continuing.");
    const res = await POST(
      makeReq({
        messages: [
          { role: "user", content: "First" },
          { role: "assistant", content: "Response" },
          { role: "user", content: "Second" },
        ],
      })
    );
    expect(res.status).toBe(200);
  });
});

// ── 2. Response Shape ──────────────────────────────────────────────────────────

describe("POST /api/chatbot — response shape", () => {
  it("returns { reply: string } with the assistant text", async () => {
    queueEndTurn("Here are your teams.");
    const res = await POST(makeReq({ messages: [{ role: "user", content: "Status?" }] }));
    expect(res.status).toBe(200);
    const body = await res.json() as { reply: string };
    expect(body).toHaveProperty("reply");
    expect(body.reply).toBe("Here are your teams.");
  });

  it("returns Content-Type: application/json", async () => {
    queueEndTurn("OK");
    const res = await POST(makeReq({ messages: [{ role: "user", content: "Hi" }] }));
    expect(res.headers.get("content-type")).toMatch("application/json");
  });

  it("returns empty string reply when max iterations reached", async () => {
    for (let i = 0; i < 12; i++) {
      queueToolUse(`t${i}`, "list_teams");
    }
    const res = await POST(makeReq({ messages: [{ role: "user", content: "Loop" }] }));
    expect(res.status).toBe(200);
    const body = await res.json() as { reply: string };
    expect(typeof body.reply).toBe("string");
  });
});

// ── 3. Agentic Loop ────────────────────────────────────────────────────────────

describe("POST /api/chatbot — agentic loop", () => {
  it("makes exactly 1 SDK call for end_turn", async () => {
    queueEndTurn("Done.");
    await POST(makeReq({ messages: [{ role: "user", content: "Hi" }] }));
    expect(getCallCount()).toBe(1);
  });

  it("makes 2 calls for tool_use + end_turn", async () => {
    queueToolUse("t1", "list_teams");
    queueEndTurn("0 teams.");
    const res = await POST(makeReq({ messages: [{ role: "user", content: "Teams?" }] }));
    expect(res.status).toBe(200);
    const body = await res.json() as { reply: string };
    expect(body.reply).toBe("0 teams.");
    expect(getCallCount()).toBe(2);
  });

  it("stops at MAX_ITERATIONS (10)", async () => {
    for (let i = 0; i < 15; i++) {
      queueToolUse(`t${i}`, "list_teams");
    }
    await POST(makeReq({ messages: [{ role: "user", content: "Loop" }] }));
    expect(getCallCount()).toBeLessThanOrEqual(10);
  });

  it("includes tool_result in user message of second call", async () => {
    queueToolUse("t1", "list_teams");
    queueEndTurn("Done.");
    await POST(makeReq({ messages: [{ role: "user", content: "Teams?" }] }));

    const secondCall = getCall(1) as { messages: Array<{ role: string; content: unknown }> };
    const lastMsg = secondCall.messages[secondCall.messages.length - 1];
    expect(lastMsg.role).toBe("user");
    expect(Array.isArray(lastMsg.content)).toBe(true);
    const content = lastMsg.content as Array<{ type: string }>;
    expect(content.some((c) => c.type === "tool_result")).toBe(true);
  });
});

// ── 4. Tool: list_teams ─────────────────────────────────────────────────────────

describe("POST /api/chatbot — tool: list_teams", () => {
  it("returns empty list when listTeams returns []", async () => {
    mockListTeams.mockReturnValue([]);

    queueToolUse("t1", "list_teams");
    queueEndTurn("No teams.");
    await POST(makeReq({ messages: [{ role: "user", content: "Teams?" }] }));

    const raw = getToolResultContent();
    expect(raw).not.toBeNull();
    const result = JSON.parse(raw!) as { teams: unknown[]; count: number };
    expect(result.count).toBe(0);
    expect(result.teams).toHaveLength(0);
  });

  it("returns team with correct member count and task stats", async () => {
    mockListTeams.mockReturnValue([
      makeTeam("alpha-team", [
        { name: "alice", agentId: "a1", agentType: "dev" },
        { name: "bob", agentId: "b1", agentType: "qa" },
      ]),
    ]);
    mockReadTaskList.mockImplementation((teamName: string) => {
      if (teamName === "alpha-team") {
        return [
          makeTask("t1", "Fix bug", "completed"),
          makeTask("t2", "Feature", "in_progress"),
          makeTask("t3", "Tests", "pending"),
        ];
      }
      return [];
    });

    queueToolUse("t1", "list_teams");
    queueEndTurn("1 team.");
    await POST(makeReq({ messages: [{ role: "user", content: "Teams?" }] }));

    const raw = getToolResultContent();
    expect(raw).not.toBeNull();
    const result = JSON.parse(raw!) as {
      teams: Array<{
        name: string;
        memberCount: number;
        tasks: { total: number; completed: number; inProgress: number; pending: number };
      }>;
      count: number;
    };
    expect(result.count).toBe(1);
    expect(result.teams[0].name).toBe("alpha-team");
    expect(result.teams[0].memberCount).toBe(2);
    expect(result.teams[0].tasks.total).toBe(3);
    expect(result.teams[0].tasks.completed).toBe(1);
    expect(result.teams[0].tasks.inProgress).toBe(1);
    expect(result.teams[0].tasks.pending).toBe(1);
  });

  it("lists multiple teams", async () => {
    mockListTeams.mockReturnValue([
      makeTeam("team-a"),
      makeTeam("team-b"),
      makeTeam("team-c"),
    ]);

    queueToolUse("t1", "list_teams");
    queueEndTurn("3 teams.");
    await POST(makeReq({ messages: [{ role: "user", content: "Teams?" }] }));

    const raw = getToolResultContent();
    const result = JSON.parse(raw!) as { count: number };
    expect(result.count).toBe(3);
  });
});

// ── 5. Tool: get_team_detail ───────────────────────────────────────────────────

describe("POST /api/chatbot — tool: get_team_detail", () => {
  it("returns team config and tasks", async () => {
    mockReadTeamConfig.mockImplementation((name: string) => {
      if (name === "beta-team") {
        return makeTeam("beta-team", [{ name: "charlie", agentId: "c1", agentType: "backend" }]);
      }
      return null;
    });
    mockReadTaskList.mockImplementation((name: string) => {
      if (name === "beta-team") {
        return [makeTask("x1", "Implement API", "in_progress", "charlie")];
      }
      return [];
    });

    queueToolUse("t1", "get_team_detail", { teamName: "beta-team" });
    queueEndTurn("Team found.");
    await POST(makeReq({ messages: [{ role: "user", content: "Show beta-team" }] }));

    const raw = getToolResultContent();
    expect(raw).not.toBeNull();
    const result = JSON.parse(raw!) as {
      team: { name: string; members: unknown[] };
      tasks: Array<{ subject: string }>;
    };
    expect(result.team.name).toBe("beta-team");
    expect(result.team.members).toHaveLength(1);
    expect(result.tasks[0].subject).toBe("Implement API");
  });

  it("returns error when team not found", async () => {
    mockReadTeamConfig.mockReturnValue(null);

    queueToolUse("t1", "get_team_detail", { teamName: "ghost" });
    queueEndTurn("Not found.");
    await POST(makeReq({ messages: [{ role: "user", content: "Ghost team?" }] }));

    const raw = getToolResultContent();
    expect(raw).not.toBeNull();
    const result = JSON.parse(raw!) as { error: string };
    expect(result.error).toMatch(/not found/i);
  });
});

// ── 6. Tool: submit_queue_task ─────────────────────────────────────────────────

describe("POST /api/chatbot — tool: submit_queue_task", () => {
  it("creates a task with correct fields", async () => {
    const now = new Date().toISOString();
    mockQueuedTaskCreate.mockResolvedValueOnce({
      id: 42, goal: "Build dashboard", projectPath: "/project",
      priority: 2, status: "pending", teamName: null, result: null, createdAt: now,
    });

    queueToolUse("t1", "submit_queue_task", {
      goal: "Build dashboard", projectPath: "/project", priority: 2,
    });
    queueEndTurn("Submitted.");
    await POST(makeReq({ messages: [{ role: "user", content: "Submit a task" }] }));

    expect(mockQueuedTaskCreate).toHaveBeenCalledOnce();
    const createArg = mockQueuedTaskCreate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(createArg.data.goal).toBe("Build dashboard");
    expect(createArg.data.projectPath).toBe("/project");
    expect(createArg.data.priority).toBe(2);

    const raw = getToolResultContent();
    expect(raw).not.toBeNull();
    const result = JSON.parse(raw!) as { success: boolean; task: { id: number } };
    expect(result.success).toBe(true);
    expect(result.task.id).toBe(42);
  });

  it("defaults projectPath to cwd when not provided", async () => {
    mockQueuedTaskCreate.mockResolvedValueOnce({
      id: 1, goal: "Fix", projectPath: process.cwd(),
      priority: 0, status: "pending", teamName: null, result: null,
      createdAt: new Date().toISOString(),
    });

    queueToolUse("t1", "submit_queue_task", { goal: "Fix" });
    queueEndTurn("Done.");
    await POST(makeReq({ messages: [{ role: "user", content: "Fix it" }] }));

    const createArg = mockQueuedTaskCreate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(createArg.data.projectPath).toBe(process.cwd());
    expect(createArg.data.priority).toBe(0);
  });
});

// ── 7. Tool: list_queue_tasks ──────────────────────────────────────────────────

describe("POST /api/chatbot — tool: list_queue_tasks", () => {
  it("returns all tasks without filter", async () => {
    mockQueuedTaskFindMany.mockResolvedValueOnce([
      { id: 1, goal: "Task A", status: "pending" },
      { id: 2, goal: "Task B", status: "running" },
    ]);

    queueToolUse("t1", "list_queue_tasks", {});
    queueEndTurn("2 tasks.");
    await POST(makeReq({ messages: [{ role: "user", content: "Queue?" }] }));

    const raw = getToolResultContent();
    expect(raw).not.toBeNull();
    const result = JSON.parse(raw!) as { tasks: unknown[]; count: number };
    expect(result.count).toBe(2);
  });

  it("passes status filter to DB", async () => {
    mockQueuedTaskFindMany.mockResolvedValueOnce([{ id: 3, goal: "Pending", status: "pending" }]);

    queueToolUse("t1", "list_queue_tasks", { status: "pending" });
    queueEndTurn("1 pending.");
    await POST(makeReq({ messages: [{ role: "user", content: "Pending?" }] }));

    const findArg = mockQueuedTaskFindMany.mock.calls[0][0] as { where?: Record<string, unknown> };
    expect(findArg.where?.status).toBe("pending");
  });
});

// ── 8. Tool: cancel_queue_task ─────────────────────────────────────────────────

describe("POST /api/chatbot — tool: cancel_queue_task", () => {
  it("cancels a pending task", async () => {
    mockQueuedTaskFindUnique.mockResolvedValueOnce({ id: 7, status: "pending", goal: "Old task" });
    mockQueuedTaskUpdate.mockResolvedValueOnce({ id: 7, status: "cancelled", goal: "Old task" });

    queueToolUse("t1", "cancel_queue_task", { taskId: 7 });
    queueEndTurn("Cancelled.");
    await POST(makeReq({ messages: [{ role: "user", content: "Cancel 7" }] }));

    expect(mockQueuedTaskUpdate).toHaveBeenCalledOnce();
    const raw = getToolResultContent();
    const result = JSON.parse(raw!) as { success: boolean; taskId: number; status: string };
    expect(result.success).toBe(true);
    expect(result.taskId).toBe(7);
    expect(result.status).toBe("cancelled");
  });

  it("returns error when task not found", async () => {
    mockQueuedTaskFindUnique.mockResolvedValueOnce(null);

    queueToolUse("t1", "cancel_queue_task", { taskId: 999 });
    queueEndTurn("Not found.");
    await POST(makeReq({ messages: [{ role: "user", content: "Cancel 999" }] }));

    const raw = getToolResultContent();
    const result = JSON.parse(raw!) as { error: string };
    expect(result.error).toMatch(/not found/i);
    expect(mockQueuedTaskUpdate).not.toHaveBeenCalled();
  });

  it("returns error when task is already completed", async () => {
    mockQueuedTaskFindUnique.mockResolvedValueOnce({ id: 3, status: "completed", goal: "Done" });

    queueToolUse("t1", "cancel_queue_task", { taskId: 3 });
    queueEndTurn("Already done.");
    await POST(makeReq({ messages: [{ role: "user", content: "Cancel 3" }] }));

    const raw = getToolResultContent();
    const result = JSON.parse(raw!) as { error: string };
    expect(result.error).toMatch(/already completed/i);
    expect(mockQueuedTaskUpdate).not.toHaveBeenCalled();
  });

  it("cancels a running task", async () => {
    mockQueuedTaskFindUnique.mockResolvedValueOnce({ id: 5, status: "running", goal: "Active" });
    mockQueuedTaskUpdate.mockResolvedValueOnce({ id: 5, status: "cancelled", goal: "Active" });

    queueToolUse("t1", "cancel_queue_task", { taskId: 5 });
    queueEndTurn("Cancelled running.");
    await POST(makeReq({ messages: [{ role: "user", content: "Cancel 5" }] }));

    const raw = getToolResultContent();
    const result = JSON.parse(raw!) as { success: boolean };
    expect(result.success).toBe(true);
  });
});

// ── 9. Tool: get_queue_worker_status ──────────────────────────────────────────

describe("POST /api/chatbot — tool: get_queue_worker_status", () => {
  it("reports worker stopped when heartbeat file is absent", async () => {
    mockQueuedTaskGroupBy.mockResolvedValueOnce([
      { status: "pending", _count: { status: 3 } },
      { status: "running", _count: { status: 1 } },
      { status: "completed", _count: { status: 5 } },
    ]);

    queueToolUse("t1", "get_queue_worker_status", {});
    queueEndTurn("Checked.");
    await POST(makeReq({ messages: [{ role: "user", content: "Worker?" }] }));

    const raw = getToolResultContent();
    expect(raw).not.toBeNull();
    const result = JSON.parse(raw!) as {
      workerRunning: boolean;
      lastHeartbeat: null;
      queueDepth: number;
      counts: Record<string, number>;
    };
    expect(result.workerRunning).toBe(false);
    expect(result.lastHeartbeat).toBeNull();
    expect(result.queueDepth).toBe(4);
    expect(result.counts.pending).toBe(3);
    expect(result.counts.running).toBe(1);
  });

  it("reports worker running with a fresh heartbeat", async () => {
    // Write heartbeat to HOME (which the route reads via process.env.HOME)
    const hbDir = path.join(tmpDir, ".claude");
    fs.mkdirSync(hbDir, { recursive: true });
    fs.writeFileSync(
      path.join(hbDir, "queue-worker.heartbeat"),
      JSON.stringify({ timestamp: new Date().toISOString() }),
      "utf-8"
    );
    mockQueuedTaskGroupBy.mockResolvedValueOnce([]);

    queueToolUse("t1", "get_queue_worker_status", {});
    queueEndTurn("Running.");
    await POST(makeReq({ messages: [{ role: "user", content: "Worker?" }] }));

    const raw = getToolResultContent();
    const result = JSON.parse(raw!) as { workerRunning: boolean };
    expect(result.workerRunning).toBe(true);
  });

  it("reports worker stopped with stale heartbeat (>60s)", async () => {
    const hbDir = path.join(tmpDir, ".claude");
    fs.mkdirSync(hbDir, { recursive: true });
    const staleTime = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    fs.writeFileSync(
      path.join(hbDir, "queue-worker.heartbeat"),
      JSON.stringify({ timestamp: staleTime }),
      "utf-8"
    );
    mockQueuedTaskGroupBy.mockResolvedValueOnce([]);

    queueToolUse("t1", "get_queue_worker_status", {});
    queueEndTurn("Stale.");
    await POST(makeReq({ messages: [{ role: "user", content: "Worker?" }] }));

    const raw = getToolResultContent();
    const result = JSON.parse(raw!) as { workerRunning: boolean };
    expect(result.workerRunning).toBe(false);
  });
});

// ── 10. Tool: get_analytics_summary ───────────────────────────────────────────

describe("POST /api/chatbot — tool: get_analytics_summary", () => {
  it("uses 7d period by default", async () => {
    mockProxyLogAggregate.mockResolvedValueOnce({
      _count: { id: 100 },
      _sum: { inputTokens: 400000, outputTokens: 100000, cacheReadTokens: 20000, cacheCreationTokens: 5000 },
    });

    queueToolUse("t1", "get_analytics_summary", {});
    queueEndTurn("Analytics.");
    await POST(makeReq({ messages: [{ role: "user", content: "Analytics?" }] }));

    const raw = getToolResultContent();
    expect(raw).not.toBeNull();
    const result = JSON.parse(raw!) as { period: string; totalRequests: number; tokens: Record<string, number> };
    expect(result.period).toBe("7d");
    expect(result.totalRequests).toBe(100);
    expect(result.tokens.input).toBe(400000);
    expect(result.tokens.output).toBe(100000);
  });

  it("uses 30d period when specified", async () => {
    mockProxyLogAggregate.mockResolvedValueOnce({
      _count: { id: 500 },
      _sum: { inputTokens: 2000000, outputTokens: 500000, cacheReadTokens: 0, cacheCreationTokens: 0 },
    });

    queueToolUse("t1", "get_analytics_summary", { period: "30d" });
    queueEndTurn("30d analytics.");
    await POST(makeReq({ messages: [{ role: "user", content: "30d?" }] }));

    const raw = getToolResultContent();
    const result = JSON.parse(raw!) as { period: string };
    expect(result.period).toBe("30d");
  });

  it("uses epoch start as cutoff for 'all' period", async () => {
    mockProxyLogAggregate.mockResolvedValueOnce({
      _count: { id: 1200 },
      _sum: { inputTokens: 5000000, outputTokens: 1000000, cacheReadTokens: 0, cacheCreationTokens: 0 },
    });

    queueToolUse("t1", "get_analytics_summary", { period: "all" });
    queueEndTurn("All-time.")
    await POST(makeReq({ messages: [{ role: "user", content: "All analytics?" }] }));

    expect(mockProxyLogAggregate).toHaveBeenCalledOnce();
    const aggArg = mockProxyLogAggregate.mock.calls[0][0] as {
      where: { timestamp: { gte: Date | string } };
    };
    // For 'all', the route passes new Date(0) (epoch). After deep-clone via
    // JSON.parse/stringify, Dates serialize to ISO strings. Accept either form,
    // but verify the cutoff is at or near the Unix epoch (year <= 1970).
    const cutoff = aggArg.where.timestamp.gte;
    if (cutoff instanceof Date) {
      expect(cutoff.getTime()).toBeLessThanOrEqual(0);
    } else {
      // ISO string serialization of new Date(0) — "1970-01-01T00:00:00.000Z"
      expect(new Date(cutoff as string).getTime()).toBeLessThanOrEqual(0);
    }
  });
});

// ── 11. Tool: get_stuck_tasks ──────────────────────────────────────────────────

describe("POST /api/chatbot — tool: get_stuck_tasks", () => {
  it("returns empty when listTeams returns []", async () => {
    mockListTeams.mockReturnValue([]);

    queueToolUse("t1", "get_stuck_tasks", {});
    queueEndTurn("No stuck tasks.");
    await POST(makeReq({ messages: [{ role: "user", content: "Stuck?" }] }));

    const raw = getToolResultContent();
    const result = JSON.parse(raw!) as { stuckTasks: unknown[]; count: number };
    expect(result.count).toBe(0);
  });

  it("detects stale in_progress tasks by inspecting task files", async () => {
    // The route uses module-level CLAUDE_DIR = path.join(HOME_AT_LOAD_TIME, ".claude")
    // We must write the task file to the same path the route will look in.
    const stuckTeamName = `test-stuck-${Date.now()}`;
    const taskDir = path.join(REAL_CLAUDE_DIR, "tasks", stuckTeamName);
    fs.mkdirSync(taskDir, { recursive: true });

    const staleTask = {
      id: "s1", subject: "Stuck on migration", status: "in_progress",
      owner: "agent-1",
      metadata: { blockerType: "error", blockerSummary: "DB connection failed" },
    };
    const taskFile = path.join(taskDir, "s1.json");
    fs.writeFileSync(taskFile, JSON.stringify(staleTask), "utf-8");

    // Backdate the file to 15 minutes ago (beyond 10-min threshold)
    const fifteenAgo = new Date(Date.now() - 15 * 60 * 1000);
    fs.utimesSync(taskFile, fifteenAgo, fifteenAgo);

    // Route reads taskList from claude-files mock, but checks mtime from real fs
    mockListTeams.mockReturnValue([makeTeam(stuckTeamName)]);
    mockReadTaskList.mockImplementation((name: string) => {
      if (name === stuckTeamName) return [staleTask];
      return [];
    });

    try {
      queueToolUse("t1", "get_stuck_tasks", {});
      queueEndTurn("1 stuck.");
      await POST(makeReq({ messages: [{ role: "user", content: "Stuck?" }] }));

      const raw = getToolResultContent();
      const result = JSON.parse(raw!) as {
        stuckTasks: Array<{ teamName: string; taskId: string; subject: string; blockerType: string }>;
        count: number;
      };
      expect(result.count).toBe(1);
      expect(result.stuckTasks[0].teamName).toBe(stuckTeamName);
      expect(result.stuckTasks[0].taskId).toBe("s1");
      expect(result.stuckTasks[0].blockerType).toBe("error");
    } finally {
      // Clean up the test task dir from real CLAUDE_DIR
      fs.rmSync(taskDir, { recursive: true, force: true });
    }
  });

  it("ignores recently-modified in_progress tasks (<10 min)", async () => {
    // Task file does NOT exist in CLAUDE_DIR → statSync throws → route skips the task
    // This is the "not stuck" path: in_progress task with no accessible file
    mockListTeams.mockReturnValue([makeTeam("active-no-file-team")]);
    const freshTask = { id: "f1", subject: "Fresh task", status: "in_progress", owner: "agent-2" };
    mockReadTaskList.mockImplementation((name: string) => {
      if (name === "active-no-file-team") return [freshTask];
      return [];
    });

    queueToolUse("t1", "get_stuck_tasks", {});
    queueEndTurn("No stuck.");
    await POST(makeReq({ messages: [{ role: "user", content: "Stuck?" }] }));

    const raw = getToolResultContent();
    const result = JSON.parse(raw!) as { count: number };
    // File doesn't exist so statSync throws and the task is skipped (not reported stuck)
    expect(result.count).toBe(0);
  });

  it("ignores completed and pending tasks", async () => {
    mockListTeams.mockReturnValue([makeTeam("mixed-team")]);
    mockReadTaskList.mockImplementation((name: string) => {
      if (name === "mixed-team") {
        return [
          makeTask("c1", "Done", "completed"),
          makeTask("p1", "Pending", "pending"),
        ];
      }
      return [];
    });

    queueToolUse("t1", "get_stuck_tasks", {});
    queueEndTurn("No stuck.");
    await POST(makeReq({ messages: [{ role: "user", content: "Stuck?" }] }));

    const raw = getToolResultContent();
    const result = JSON.parse(raw!) as { count: number };
    expect(result.count).toBe(0);
  });
});

// ── 12. Tool: send_message_to_team ─────────────────────────────────────────────

describe("POST /api/chatbot — tool: send_message_to_team", () => {
  it("writes message to recipient inbox file", async () => {
    // The route writes to CLAUDE_DIR (module-level = real HOME/.claude), not tmpDir.
    const msgTeamName = `test-msg-${Date.now()}`;
    mockReadTeamConfig.mockImplementation((name: string) => {
      if (name === msgTeamName) {
        return makeTeam(msgTeamName, [{ name: "diana", agentId: "d1", agentType: "frontend" }]);
      }
      return null;
    });

    const inboxDir = path.join(REAL_CLAUDE_DIR, "teams", msgTeamName, "inboxes");

    try {
      queueToolUse("t1", "send_message_to_team", {
        teamName: msgTeamName,
        recipient: "diana",
        content: "Fix the CSS overflow issue.",
      });
      queueEndTurn("Sent.");
      await POST(makeReq({ messages: [{ role: "user", content: "Message diana" }] }));

      const raw = getToolResultContent();
      expect(raw).not.toBeNull();
      const result = JSON.parse(raw!) as {
        success: boolean;
        message: { content: string; from: string };
      };
      expect(result.success).toBe(true);
      expect(result.message.content).toBe("Fix the CSS overflow issue.");
      expect(result.message.from).toBe("chatbot");

      // Inbox file written to REAL_CLAUDE_DIR/teams/{teamName}/inboxes/diana.json
      const inboxFile = path.join(inboxDir, "diana.json");
      expect(fs.existsSync(inboxFile)).toBe(true);
      const msgs = JSON.parse(fs.readFileSync(inboxFile, "utf-8")) as unknown[];
      expect(msgs).toHaveLength(1);
    } finally {
      // Clean up test team dir from real CLAUDE_DIR
      const teamDir = path.join(REAL_CLAUDE_DIR, "teams", msgTeamName);
      fs.rmSync(teamDir, { recursive: true, force: true });
    }
  });

  it("appends to an existing inbox", async () => {
    // The route writes to CLAUDE_DIR (module-level = real HOME/.claude), not tmpDir.
    const msg2TeamName = `test-msg2-${Date.now()}`;
    mockReadTeamConfig.mockImplementation((name: string) => {
      if (name === msg2TeamName) {
        return makeTeam(msg2TeamName, [{ name: "evan", agentId: "e1", agentType: "backend" }]);
      }
      return null;
    });

    // Pre-populate inbox in REAL_CLAUDE_DIR (where the route will look)
    const inboxDir = path.join(REAL_CLAUDE_DIR, "teams", msg2TeamName, "inboxes");
    fs.mkdirSync(inboxDir, { recursive: true });
    fs.writeFileSync(
      path.join(inboxDir, "evan.json"),
      JSON.stringify([{ id: "old-1", content: "Old message" }]),
      "utf-8"
    );

    try {
      queueToolUse("t1", "send_message_to_team", {
        teamName: msg2TeamName,
        recipient: "evan",
        content: "New message.",
      });
      queueEndTurn("Appended.");
      await POST(makeReq({ messages: [{ role: "user", content: "Message evan" }] }));

      const inboxFile = path.join(inboxDir, "evan.json");
      const msgs = JSON.parse(fs.readFileSync(inboxFile, "utf-8")) as unknown[];
      expect(msgs).toHaveLength(2);
    } finally {
      // Clean up test team dir from real CLAUDE_DIR
      const teamDir = path.join(REAL_CLAUDE_DIR, "teams", msg2TeamName);
      fs.rmSync(teamDir, { recursive: true, force: true });
    }
  });

  it("returns error when recipient not found in team", async () => {
    mockReadTeamConfig.mockImplementation((name: string) => {
      if (name === "msg3-team") {
        return makeTeam("msg3-team", [{ name: "fiona", agentId: "f1", agentType: "devops" }]);
      }
      return null;
    });

    queueToolUse("t1", "send_message_to_team", {
      teamName: "msg3-team", recipient: "nobody", content: "Hi",
    });
    queueEndTurn("Not found.");
    await POST(makeReq({ messages: [{ role: "user", content: "Message nobody" }] }));

    const raw = getToolResultContent();
    expect(raw).not.toBeNull();
    const result = JSON.parse(raw!) as { error: string };
    expect(result.error).toMatch(/not found/i);
  });

  it("returns error when team not found", async () => {
    mockReadTeamConfig.mockReturnValue(null);

    queueToolUse("t1", "send_message_to_team", {
      teamName: "phantom-team", recipient: "anyone", content: "Hi",
    });
    queueEndTurn("Team not found.");
    await POST(makeReq({ messages: [{ role: "user", content: "Message phantom" }] }));

    const raw = getToolResultContent();
    expect(raw).not.toBeNull();
    const result = JSON.parse(raw!) as { error: string };
    expect(result.error).toMatch(/not found/i);
  });
});

// ── 13. Tool: get_proxy_logs ───────────────────────────────────────────────────

describe("POST /api/chatbot — tool: get_proxy_logs", () => {
  it("returns logs from DB", async () => {
    mockProxyLogFindMany.mockResolvedValueOnce([
      { id: 1, model: "claude-sonnet-4-5", inputTokens: 1000, outputTokens: 400, statusCode: 200 },
      { id: 2, model: "claude-3-5-haiku", inputTokens: 500, outputTokens: 200, statusCode: 200 },
    ]);

    queueToolUse("t1", "get_proxy_logs", { limit: 20 });
    queueEndTurn("Logs.");
    await POST(makeReq({ messages: [{ role: "user", content: "Logs?" }] }));

    const raw = getToolResultContent();
    expect(raw).not.toBeNull();
    const result = JSON.parse(raw!) as { logs: unknown[]; count: number };
    expect(result.count).toBe(2);
    expect(result.logs).toHaveLength(2);
  });

  it("applies teamName filter", async () => {
    mockProxyLogFindMany.mockResolvedValueOnce([]);

    queueToolUse("t1", "get_proxy_logs", { teamName: "my-team", limit: 5 });
    queueEndTurn("Filtered.")
    await POST(makeReq({ messages: [{ role: "user", content: "Team logs" }] }));

    const findArg = mockProxyLogFindMany.mock.calls[0][0] as { where?: Record<string, unknown> };
    expect(findArg.where?.teamName).toBe("my-team");
  });

  it("caps limit at 100", async () => {
    mockProxyLogFindMany.mockResolvedValueOnce([]);

    queueToolUse("t1", "get_proxy_logs", { limit: 9999 });
    queueEndTurn("Capped.")
    await POST(makeReq({ messages: [{ role: "user", content: "All logs" }] }));

    const findArg = mockProxyLogFindMany.mock.calls[0][0] as { take?: number };
    expect(findArg.take).toBeLessThanOrEqual(100);
  });
});

// ── 14. Tool: get_dashboard_stats ─────────────────────────────────────────────

describe("POST /api/chatbot — tool: get_dashboard_stats", () => {
  it("aggregates team, task, and queue stats", async () => {
    mockListTeams.mockReturnValue([makeTeam("team-x"), makeTeam("team-y")]);
    mockReadTaskList.mockImplementation((name: string) => {
      if (name === "team-x") {
        return [
          makeTask("dx1", "Done", "completed"),
          makeTask("dx2", "Active", "in_progress"),
        ];
      }
      if (name === "team-y") {
        return [makeTask("dy1", "Pending", "pending")];
      }
      return [];
    });
    mockQueuedTaskGroupBy.mockResolvedValueOnce([
      { status: "pending", _count: { status: 5 } },
      { status: "running", _count: { status: 2 } },
      { status: "completed", _count: { status: 20 } },
      { status: "failed", _count: { status: 1 } },
    ]);

    queueToolUse("t1", "get_dashboard_stats", {});
    queueEndTurn("Stats.");
    await POST(makeReq({ messages: [{ role: "user", content: "Overview?" }] }));

    const raw = getToolResultContent();
    expect(raw).not.toBeNull();
    const result = JSON.parse(raw!) as {
      teams: { total: number };
      tasks: { total: number; completed: number; active: number };
      queue: { pending: number; running: number; completed: number; failed: number };
    };
    expect(result.teams.total).toBe(2);
    expect(result.tasks.total).toBe(3);
    expect(result.tasks.completed).toBe(1);
    expect(result.tasks.active).toBe(1);
    expect(result.queue.pending).toBe(5);
    expect(result.queue.running).toBe(2);
    expect(result.queue.failed).toBe(1);
  });
});

// ── 15. Unknown Tool ──────────────────────────────────────────────────────────

describe("POST /api/chatbot — unknown tool", () => {
  it("returns error JSON for unrecognized tool name", async () => {
    queueToolUse("t1", "totally_unknown_tool", {});
    queueEndTurn("Error handled.");
    await POST(makeReq({ messages: [{ role: "user", content: "Unknown" }] }));

    const raw = getToolResultContent();
    expect(raw).not.toBeNull();
    const result = JSON.parse(raw!) as { error: string };
    expect(result.error).toMatch(/unknown tool/i);
  });
});

// ── 16. SDK Error Handling ────────────────────────────────────────────────────

describe("POST /api/chatbot — SDK error handling", () => {
  it("returns 500 when Anthropic SDK throws", async () => {
    queueSdkError("Authentication failed: invalid API key");
    const res = await POST(makeReq({ messages: [{ role: "user", content: "Hello" }] }));
    expect(res.status).toBe(500);
    const body = await res.json() as { error: string };
    expect(body.error).toBe("Internal server error");
  });
});

// ── 17. Message History Forwarding ───────────────────────────────────────────

describe("POST /api/chatbot — message history forwarding", () => {
  it("passes all messages to Anthropic API", async () => {
    queueEndTurn("OK.");
    await POST(
      makeReq({
        messages: [
          { role: "user", content: "First message" },
          { role: "assistant", content: "First reply" },
          { role: "user", content: "Second message" },
        ],
      })
    );
    const call = getCall(0) as { messages: Array<{ role: string; content: string }> };
    expect(call.messages).toHaveLength(3);
    expect(call.messages[0].content).toBe("First message");
    expect(call.messages[2].content).toBe("Second message");
  });

  it("uses claude-sonnet-4-5 model", async () => {
    queueEndTurn("OK");
    await POST(makeReq({ messages: [{ role: "user", content: "Hi" }] }));
    const call = getCall(0) as { model: string };
    expect(call.model).toBe("claude-sonnet-4-5");
  });

  it("includes a non-empty system prompt", async () => {
    queueEndTurn("OK");
    await POST(makeReq({ messages: [{ role: "user", content: "Hi" }] }));
    const call = getCall(0) as { system: string };
    expect(typeof call.system).toBe("string");
    expect(call.system.length).toBeGreaterThan(100);
  });

  it("includes tools array with at least 6 entries", async () => {
    queueEndTurn("OK");
    await POST(makeReq({ messages: [{ role: "user", content: "Hi" }] }));
    const call = getCall(0) as { tools: unknown[] };
    expect(Array.isArray(call.tools)).toBe(true);
    expect(call.tools.length).toBeGreaterThanOrEqual(6);
  });
});
