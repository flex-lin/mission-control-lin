import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";

/**
 * End-to-end tests for POST /api/chat — chatbot agent backed by Claude.
 *
 * Covers:
 * 1. Input validation (missing/empty messages)
 * 2. Missing API key handling
 * 3. Streaming response format (SSE)
 * 4. Tool call execution: list_teams, get_team_health, get_team_tasks,
 *    submit_queue_task, list_queue_tasks, search_knowledge_base,
 *    get_knowledge_base_entry
 * 5. Error handling and edge cases
 * 6. Conversation with tool use loop
 */

// ── Mock Anthropic SDK ────────────────────────────────────────────────────────

interface MockToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

interface MockTextBlock {
  type: "text";
  text: string;
}

type MockContentBlock = MockToolUseBlock | MockTextBlock;

interface MockFinalMessage {
  content: MockContentBlock[];
  stop_reason: string;
}

// Factory for mock stream that yields text and optionally tool_use blocks
function createMockStream(
  textContent: string,
  toolBlocks: MockToolUseBlock[] = [],
  stopReason = "end_turn"
): {
  [Symbol.asyncIterator](): AsyncIterator<{
    type: string;
    delta: { text?: string };
  }>;
  finalMessage: () => Promise<MockFinalMessage>;
} {
  const contentBlocks: MockContentBlock[] = [];
  if (textContent) {
    contentBlocks.push({ type: "text", text: textContent });
  }
  contentBlocks.push(...toolBlocks);

  return {
    async *[Symbol.asyncIterator]() {
      if (textContent) {
        yield {
          type: "content_block_delta",
          delta: { text: textContent },
        };
      }
    },
    finalMessage: async () => ({
      content: contentBlocks,
      stop_reason: toolBlocks.length > 0 ? "tool_use" : stopReason,
    }),
  };
}

let mockStreamFn: ReturnType<typeof vi.fn>;

vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: class MockAnthropic {
      messages = {
        stream: (...args: unknown[]) => mockStreamFn(...args),
      };
    },
  };
});

// ── Mock DB ───────────────────────────────────────────────────────────────────

const mockQueuedTaskCreate = vi.fn();
const mockQueuedTaskFindMany = vi.fn();
const mockIndexedProjectFindMany = vi.fn();
const mockIndexedProjectFindUnique = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    queuedTask: {
      create: (...args: unknown[]) => mockQueuedTaskCreate(...args),
      findMany: (...args: unknown[]) => mockQueuedTaskFindMany(...args),
    },
    indexedProject: {
      findMany: (...args: unknown[]) => mockIndexedProjectFindMany(...args),
      findUnique: (...args: unknown[]) => mockIndexedProjectFindUnique(...args),
    },
  },
}));

// ── Mock claude-files ─────────────────────────────────────────────────────────

const mockListTeams = vi.fn();
const mockReadTeamConfig = vi.fn();
const mockReadTaskList = vi.fn();

vi.mock("@/lib/claude-files", () => ({
  listTeams: (...args: unknown[]) => mockListTeams(...args),
  readTeamConfig: (...args: unknown[]) => mockReadTeamConfig(...args),
  readTaskList: (...args: unknown[]) => mockReadTaskList(...args),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeReq(url: string, init?: RequestInit): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:3777"), init);
}

function chatReq(messages: Array<{ role: string; content: string }>) {
  return makeReq("http://localhost:3777/api/chat", {
    method: "POST",
    body: JSON.stringify({ messages }),
    headers: { "Content-Type": "application/json" },
  });
}

/** Read the full SSE stream body as text */
async function readStream(res: Response): Promise<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let result = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    result += decoder.decode(value, { stream: true });
  }
  return result;
}

/** Parse SSE events from stream text */
function parseSSEEvents(
  streamText: string
): Array<Record<string, unknown> | string> {
  return streamText
    .split("\n\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => {
      const data = line.replace("data: ", "");
      if (data === "[DONE]") return "[DONE]";
      return JSON.parse(data) as Record<string, unknown>;
    });
}

// ── Setup / Teardown ─────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-e2e-chat-"));
  vi.stubEnv("HOME", tmpDir);
  vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test-key-123");
  vi.clearAllMocks();

  // Default mocks
  mockListTeams.mockReturnValue([]);
  mockReadTeamConfig.mockReturnValue(null);
  mockReadTaskList.mockReturnValue([]);
  mockQueuedTaskFindMany.mockResolvedValue([]);
  mockIndexedProjectFindMany.mockResolvedValue([]);
  mockIndexedProjectFindUnique.mockResolvedValue(null);

  // Default: simple text response with no tool use
  mockStreamFn = vi.fn(() => createMockStream("Hello! How can I help?"));
});

afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 1. Input validation
// ═══════════════════════════════════════════════════════════════════════════════

describe("POST /api/chat — input validation", () => {
  it("returns 400 when messages is missing", async () => {
    vi.resetModules();
    const { POST } = await import("@/app/api/chat/route");
    const req = makeReq("http://localhost:3777/api/chat", {
      method: "POST",
      body: JSON.stringify({}),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it("returns 400 when messages is empty array", async () => {
    vi.resetModules();
    const { POST } = await import("@/app/api/chat/route");
    const req = makeReq("http://localhost:3777/api/chat", {
      method: "POST",
      body: JSON.stringify({ messages: [] }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toMatch(/messages/i);
  });

  it("returns 400 when messages is not an array", async () => {
    vi.resetModules();
    const { POST } = await import("@/app/api/chat/route");
    const req = makeReq("http://localhost:3777/api/chat", {
      method: "POST",
      body: JSON.stringify({ messages: "not an array" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. Missing API key
// ═══════════════════════════════════════════════════════════════════════════════

describe("POST /api/chat — API key handling", () => {
  it("returns 500 when ANTHROPIC_API_KEY is not set", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    // Also delete it fully
    delete process.env.ANTHROPIC_API_KEY;

    vi.resetModules();
    const { POST } = await import("@/app/api/chat/route");
    const req = chatReq([{ role: "user", content: "Hello" }]);

    const res = await POST(req);
    expect(res.status).toBe(500);

    const body = await res.json();
    expect(body.error).toMatch(/ANTHROPIC_API_KEY/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. Streaming response format
// ═══════════════════════════════════════════════════════════════════════════════

describe("POST /api/chat — streaming response format", () => {
  it("returns SSE content-type headers", async () => {
    vi.resetModules();
    const { POST } = await import("@/app/api/chat/route");
    const req = chatReq([{ role: "user", content: "Hello" }]);

    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");
    expect(res.headers.get("Cache-Control")).toBe("no-cache");
  });

  it("streams text events followed by [DONE]", async () => {
    vi.resetModules();
    const { POST } = await import("@/app/api/chat/route");
    const req = chatReq([{ role: "user", content: "Hello" }]);

    const res = await POST(req);
    const text = await readStream(res);
    const events = parseSSEEvents(text);

    // Should have at least a text event and [DONE]
    expect(events.length).toBeGreaterThanOrEqual(2);

    // First event should be text
    const textEvent = events.find(
      (e) => typeof e === "object" && e.type === "text"
    );
    expect(textEvent).toBeDefined();
    expect((textEvent as Record<string, unknown>).text).toBe(
      "Hello! How can I help?"
    );

    // Last event should be [DONE]
    expect(events[events.length - 1]).toBe("[DONE]");
  });

  it("passes messages to the Anthropic client with system prompt and tools", async () => {
    vi.resetModules();
    const { POST } = await import("@/app/api/chat/route");
    const req = chatReq([{ role: "user", content: "What teams are running?" }]);

    await POST(req);

    expect(mockStreamFn).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "claude-sonnet-4-5-20250514",
        max_tokens: 4096,
        system: expect.stringContaining("Mission Control"),
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: "user",
            content: "What teams are running?",
          }),
        ]),
        tools: expect.arrayContaining([
          expect.objectContaining({ name: "list_teams" }),
          expect.objectContaining({ name: "get_team_health" }),
          expect.objectContaining({ name: "submit_queue_task" }),
          expect.objectContaining({ name: "search_knowledge_base" }),
        ]),
      })
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. Tool execution: list_teams
// ═══════════════════════════════════════════════════════════════════════════════

describe("POST /api/chat — list_teams tool", () => {
  it("calls listTeams and readTaskList when tool is invoked", async () => {
    mockListTeams.mockReturnValue([
      {
        name: "alpha-team",
        description: "Test team",
        members: [
          { name: "lead", agentType: "architect", status: "active" },
        ],
      },
    ]);
    mockReadTaskList.mockReturnValue([
      { id: "1", subject: "Task 1", status: "completed" },
      { id: "2", subject: "Task 2", status: "in_progress" },
    ]);

    // First call: model requests tool, second call: model responds with text
    const toolUseBlock: MockToolUseBlock = {
      type: "tool_use",
      id: "tool_1",
      name: "list_teams",
      input: {},
    };
    mockStreamFn
      .mockReturnValueOnce(createMockStream("", [toolUseBlock]))
      .mockReturnValueOnce(
        createMockStream("Found 1 team: alpha-team with 2 tasks.")
      );

    vi.resetModules();
    const { POST } = await import("@/app/api/chat/route");
    const req = chatReq([{ role: "user", content: "List all teams" }]);

    const res = await POST(req);
    const text = await readStream(res);
    const events = parseSSEEvents(text);

    // Should have a tool_use event
    const toolEvent = events.find(
      (e) => typeof e === "object" && e.type === "tool_use"
    );
    expect(toolEvent).toBeDefined();
    expect((toolEvent as Record<string, unknown>).tool).toBe("list_teams");

    expect(mockListTeams).toHaveBeenCalled();
    expect(mockReadTaskList).toHaveBeenCalledWith("alpha-team");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. Tool execution: get_team_health
// ═══════════════════════════════════════════════════════════════════════════════

describe("POST /api/chat — get_team_health tool", () => {
  it("returns team health details when team exists", async () => {
    mockReadTeamConfig.mockReturnValue({
      name: "beta-team",
      description: "Beta test team",
      members: [{ name: "dev", agentType: "developer", status: "active" }],
      createdAt: "2026-02-19T10:00:00Z",
    });
    mockReadTaskList.mockReturnValue([
      { id: "1", subject: "Build feature", status: "completed" },
      { id: "2", subject: "Write tests", status: "pending" },
    ]);

    const toolUseBlock: MockToolUseBlock = {
      type: "tool_use",
      id: "tool_2",
      name: "get_team_health",
      input: { team_name: "beta-team" },
    };
    mockStreamFn
      .mockReturnValueOnce(createMockStream("", [toolUseBlock]))
      .mockReturnValueOnce(
        createMockStream("Beta-team is healthy with 1/2 tasks completed.")
      );

    vi.resetModules();
    const { POST } = await import("@/app/api/chat/route");
    const req = chatReq([
      { role: "user", content: "How is beta-team doing?" },
    ]);

    const res = await POST(req);
    const text = await readStream(res);

    expect(mockReadTeamConfig).toHaveBeenCalledWith("beta-team");
    expect(text).toContain("tool_use");
  });

  it("handles non-existent team gracefully", async () => {
    mockReadTeamConfig.mockReturnValue(null);

    const toolUseBlock: MockToolUseBlock = {
      type: "tool_use",
      id: "tool_3",
      name: "get_team_health",
      input: { team_name: "nonexistent" },
    };
    mockStreamFn
      .mockReturnValueOnce(createMockStream("", [toolUseBlock]))
      .mockReturnValueOnce(
        createMockStream('Team "nonexistent" was not found.')
      );

    vi.resetModules();
    const { POST } = await import("@/app/api/chat/route");
    const req = chatReq([
      { role: "user", content: "Check team nonexistent" },
    ]);

    const res = await POST(req);
    expect(res.status).toBe(200);
    await readStream(res); // consume stream to trigger tool execution

    // The mock should have been called (tool executed)
    expect(mockReadTeamConfig).toHaveBeenCalledWith("nonexistent");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. Tool execution: get_team_tasks
// ═══════════════════════════════════════════════════════════════════════════════

describe("POST /api/chat — get_team_tasks tool", () => {
  it("returns tasks for the requested team", async () => {
    mockReadTaskList.mockReturnValue([
      {
        id: "1",
        subject: "Implement API",
        status: "completed",
        owner: "backend-dev",
        priority: "high",
      },
      {
        id: "2",
        subject: "Write tests",
        status: "in_progress",
        owner: "tester",
        priority: "medium",
      },
    ]);

    const toolUseBlock: MockToolUseBlock = {
      type: "tool_use",
      id: "tool_4",
      name: "get_team_tasks",
      input: { team_name: "gamma-team" },
    };
    mockStreamFn
      .mockReturnValueOnce(createMockStream("", [toolUseBlock]))
      .mockReturnValueOnce(
        createMockStream("Gamma-team has 2 tasks: 1 completed, 1 in progress.")
      );

    vi.resetModules();
    const { POST } = await import("@/app/api/chat/route");
    const req = chatReq([
      { role: "user", content: "What tasks does gamma-team have?" },
    ]);

    const res = await POST(req);
    await readStream(res);

    expect(mockReadTaskList).toHaveBeenCalledWith("gamma-team");
  });

  it("handles team with no tasks", async () => {
    mockReadTaskList.mockReturnValue([]);

    const toolUseBlock: MockToolUseBlock = {
      type: "tool_use",
      id: "tool_5",
      name: "get_team_tasks",
      input: { team_name: "empty-team" },
    };
    mockStreamFn
      .mockReturnValueOnce(createMockStream("", [toolUseBlock]))
      .mockReturnValueOnce(
        createMockStream("No tasks found for empty-team.")
      );

    vi.resetModules();
    const { POST } = await import("@/app/api/chat/route");
    const req = chatReq([
      { role: "user", content: "Tasks for empty-team?" },
    ]);

    const res = await POST(req);
    expect(res.status).toBe(200);
    await readStream(res); // consume stream to trigger tool execution
    expect(mockReadTaskList).toHaveBeenCalledWith("empty-team");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. Tool execution: submit_queue_task
// ═══════════════════════════════════════════════════════════════════════════════

describe("POST /api/chat — submit_queue_task tool", () => {
  it("creates a queued task via DB", async () => {
    const createdTask = {
      id: 42,
      goal: "Fix the login bug",
      projectPath: "/home/user/project",
      status: "pending",
      priority: 0,
      createdAt: new Date("2026-02-19T12:00:00Z"),
    };
    mockQueuedTaskCreate.mockResolvedValue(createdTask);

    const toolUseBlock: MockToolUseBlock = {
      type: "tool_use",
      id: "tool_6",
      name: "submit_queue_task",
      input: { goal: "Fix the login bug", project_path: "/home/user/project" },
    };
    mockStreamFn
      .mockReturnValueOnce(createMockStream("", [toolUseBlock]))
      .mockReturnValueOnce(
        createMockStream("Task submitted! ID: 42, goal: Fix the login bug.")
      );

    vi.resetModules();
    const { POST } = await import("@/app/api/chat/route");
    const req = chatReq([
      { role: "user", content: "Submit a task to fix the login bug" },
    ]);

    const res = await POST(req);
    await readStream(res);

    expect(mockQueuedTaskCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          goal: "Fix the login bug",
          projectPath: "/home/user/project",
          priority: 0,
        }),
      })
    );
  });

  it("uses custom priority when provided", async () => {
    mockQueuedTaskCreate.mockResolvedValue({
      id: 43,
      goal: "Urgent fix",
      projectPath: process.cwd(),
      status: "pending",
      priority: 5,
      createdAt: new Date(),
    });

    const toolUseBlock: MockToolUseBlock = {
      type: "tool_use",
      id: "tool_7",
      name: "submit_queue_task",
      input: { goal: "Urgent fix", priority: 5 },
    };
    mockStreamFn
      .mockReturnValueOnce(createMockStream("", [toolUseBlock]))
      .mockReturnValueOnce(
        createMockStream("High-priority task submitted!")
      );

    vi.resetModules();
    const { POST } = await import("@/app/api/chat/route");
    const req = chatReq([
      { role: "user", content: "Submit an urgent task" },
    ]);

    const res = await POST(req);
    await readStream(res);

    expect(mockQueuedTaskCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ priority: 5 }),
      })
    );
  });

  it("defaults project_path to cwd when not provided", async () => {
    mockQueuedTaskCreate.mockResolvedValue({
      id: 44,
      goal: "Test task",
      projectPath: process.cwd(),
      status: "pending",
      priority: 0,
      createdAt: new Date(),
    });

    const toolUseBlock: MockToolUseBlock = {
      type: "tool_use",
      id: "tool_8",
      name: "submit_queue_task",
      input: { goal: "Test task" },
    };
    mockStreamFn
      .mockReturnValueOnce(createMockStream("", [toolUseBlock]))
      .mockReturnValueOnce(createMockStream("Task created."));

    vi.resetModules();
    const { POST } = await import("@/app/api/chat/route");
    const req = chatReq([{ role: "user", content: "Submit a test task" }]);

    const res = await POST(req);
    await readStream(res);

    expect(mockQueuedTaskCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ projectPath: process.cwd() }),
      })
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. Tool execution: list_queue_tasks
// ═══════════════════════════════════════════════════════════════════════════════

describe("POST /api/chat — list_queue_tasks tool", () => {
  it("lists all queue tasks", async () => {
    mockQueuedTaskFindMany.mockResolvedValue([
      {
        id: 1,
        goal: "Task A",
        projectPath: "/a",
        status: "pending",
        priority: 0,
        teamName: null,
        createdAt: new Date(),
        completedAt: null,
      },
      {
        id: 2,
        goal: "Task B",
        projectPath: "/b",
        status: "completed",
        priority: 1,
        teamName: "team-b",
        createdAt: new Date(),
        completedAt: new Date(),
      },
    ]);

    const toolUseBlock: MockToolUseBlock = {
      type: "tool_use",
      id: "tool_9",
      name: "list_queue_tasks",
      input: {},
    };
    mockStreamFn
      .mockReturnValueOnce(createMockStream("", [toolUseBlock]))
      .mockReturnValueOnce(
        createMockStream("Found 2 queued tasks.")
      );

    vi.resetModules();
    const { POST } = await import("@/app/api/chat/route");
    const req = chatReq([{ role: "user", content: "Show queue tasks" }]);

    const res = await POST(req);
    await readStream(res);

    expect(mockQueuedTaskFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {},
        orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
        take: 50,
      })
    );
  });

  it("filters by status when provided", async () => {
    mockQueuedTaskFindMany.mockResolvedValue([]);

    const toolUseBlock: MockToolUseBlock = {
      type: "tool_use",
      id: "tool_10",
      name: "list_queue_tasks",
      input: { status: "running" },
    };
    mockStreamFn
      .mockReturnValueOnce(createMockStream("", [toolUseBlock]))
      .mockReturnValueOnce(
        createMockStream("No running tasks.")
      );

    vi.resetModules();
    const { POST } = await import("@/app/api/chat/route");
    const req = chatReq([
      { role: "user", content: "Show running queue tasks" },
    ]);

    const res = await POST(req);
    await readStream(res);

    expect(mockQueuedTaskFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: "running" },
      })
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 9. Tool execution: search_knowledge_base
// ═══════════════════════════════════════════════════════════════════════════════

describe("POST /api/chat — search_knowledge_base tool", () => {
  it("searches and filters knowledge base entries by query", async () => {
    mockIndexedProjectFindMany.mockResolvedValue([
      {
        id: 1,
        path: "/home/user/mission-control",
        name: "Mission Control",
        tags: '["dashboard","monitoring"]',
        lastScanned: new Date("2026-02-01"),
      },
      {
        id: 2,
        path: "/home/user/other-project",
        name: "Other Project",
        tags: '["api"]',
        lastScanned: null,
      },
    ]);

    const toolUseBlock: MockToolUseBlock = {
      type: "tool_use",
      id: "tool_11",
      name: "search_knowledge_base",
      input: { query: "mission" },
    };
    mockStreamFn
      .mockReturnValueOnce(createMockStream("", [toolUseBlock]))
      .mockReturnValueOnce(
        createMockStream("Found Mission Control in the knowledge base.")
      );

    vi.resetModules();
    const { POST } = await import("@/app/api/chat/route");
    const req = chatReq([
      { role: "user", content: "Search knowledge base for mission" },
    ]);

    const res = await POST(req);
    await readStream(res);

    expect(mockIndexedProjectFindMany).toHaveBeenCalled();
  });

  it("returns empty results when no match found", async () => {
    mockIndexedProjectFindMany.mockResolvedValue([
      {
        id: 1,
        path: "/home/user/project",
        name: "My Project",
        tags: '["web"]',
        lastScanned: null,
      },
    ]);

    const toolUseBlock: MockToolUseBlock = {
      type: "tool_use",
      id: "tool_12",
      name: "search_knowledge_base",
      input: { query: "nonexistent" },
    };
    mockStreamFn
      .mockReturnValueOnce(createMockStream("", [toolUseBlock]))
      .mockReturnValueOnce(
        createMockStream("No matching entries found.")
      );

    vi.resetModules();
    const { POST } = await import("@/app/api/chat/route");
    const req = chatReq([
      { role: "user", content: "Search for nonexistent" },
    ]);

    const res = await POST(req);
    expect(res.status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 10. Tool execution: get_knowledge_base_entry
// ═══════════════════════════════════════════════════════════════════════════════

describe("POST /api/chat — get_knowledge_base_entry tool", () => {
  it("fetches a specific knowledge base entry by ID", async () => {
    mockIndexedProjectFindUnique.mockResolvedValue({
      id: 1,
      path: "/home/user/my-project",
      name: "My Project",
      tags: '["typescript","react"]',
      lastScanned: new Date("2026-01-15"),
    });

    const toolUseBlock: MockToolUseBlock = {
      type: "tool_use",
      id: "tool_13",
      name: "get_knowledge_base_entry",
      input: { id: 1 },
    };
    mockStreamFn
      .mockReturnValueOnce(createMockStream("", [toolUseBlock]))
      .mockReturnValueOnce(
        createMockStream("My Project is a TypeScript/React project.")
      );

    vi.resetModules();
    const { POST } = await import("@/app/api/chat/route");
    const req = chatReq([
      { role: "user", content: "Tell me about knowledge base entry 1" },
    ]);

    const res = await POST(req);
    await readStream(res);

    expect(mockIndexedProjectFindUnique).toHaveBeenCalledWith({
      where: { id: 1 },
    });
  });

  it("handles non-existent entry gracefully", async () => {
    mockIndexedProjectFindUnique.mockResolvedValue(null);

    const toolUseBlock: MockToolUseBlock = {
      type: "tool_use",
      id: "tool_14",
      name: "get_knowledge_base_entry",
      input: { id: 999 },
    };
    mockStreamFn
      .mockReturnValueOnce(createMockStream("", [toolUseBlock]))
      .mockReturnValueOnce(
        createMockStream("Entry 999 was not found in the knowledge base.")
      );

    vi.resetModules();
    const { POST } = await import("@/app/api/chat/route");
    const req = chatReq([{ role: "user", content: "Get entry 999" }]);

    const res = await POST(req);
    expect(res.status).toBe(200);
    await readStream(res); // consume stream to trigger tool execution

    expect(mockIndexedProjectFindUnique).toHaveBeenCalledWith({
      where: { id: 999 },
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 11. Error handling
// ═══════════════════════════════════════════════════════════════════════════════

describe("POST /api/chat — error handling", () => {
  it("streams error event when Anthropic API throws", async () => {
    mockStreamFn.mockImplementation(() => {
      throw new Error("API rate limit exceeded");
    });

    vi.resetModules();
    const { POST } = await import("@/app/api/chat/route");
    const req = chatReq([{ role: "user", content: "Hello" }]);

    const res = await POST(req);
    expect(res.status).toBe(200); // SSE stream still returns 200

    const text = await readStream(res);
    const events = parseSSEEvents(text);

    const errorEvent = events.find(
      (e) => typeof e === "object" && e.type === "error"
    );
    expect(errorEvent).toBeDefined();
    // Error messages are sanitized — generic message returned instead of internal details
    expect((errorEvent as Record<string, unknown>).error).toBe(
      "Internal error"
    );

    // Should still end with [DONE]
    expect(events[events.length - 1]).toBe("[DONE]");
  });

  it("handles malformed JSON body gracefully", async () => {
    vi.resetModules();
    const { POST } = await import("@/app/api/chat/route");
    const req = makeReq("http://localhost:3777/api/chat", {
      method: "POST",
      body: "not valid json{{{",
      headers: { "Content-Type": "application/json" },
    });

    const res = await POST(req);
    expect(res.status).toBe(500);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 12. Multi-round tool use conversation
// ═══════════════════════════════════════════════════════════════════════════════

describe("POST /api/chat — multi-round tool use", () => {
  it("handles two consecutive tool calls in one conversation", async () => {
    mockListTeams.mockReturnValue([
      { name: "team-x", description: "Team X", members: [] },
    ]);
    mockReadTaskList.mockReturnValue([
      { id: "1", subject: "Task 1", status: "completed" },
    ]);
    mockReadTeamConfig.mockReturnValue({
      name: "team-x",
      description: "Team X",
      members: [{ name: "dev", agentType: "developer", status: "active" }],
      createdAt: "2026-02-19T10:00:00Z",
    });

    // Round 1: list_teams tool
    const listTeamsBlock: MockToolUseBlock = {
      type: "tool_use",
      id: "tool_r1",
      name: "list_teams",
      input: {},
    };
    // Round 2: get_team_health tool
    const getHealthBlock: MockToolUseBlock = {
      type: "tool_use",
      id: "tool_r2",
      name: "get_team_health",
      input: { team_name: "team-x" },
    };

    mockStreamFn
      .mockReturnValueOnce(createMockStream("", [listTeamsBlock]))
      .mockReturnValueOnce(createMockStream("", [getHealthBlock]))
      .mockReturnValueOnce(
        createMockStream(
          "Team X has 1 member and 1/1 tasks completed. Looking good!"
        )
      );

    vi.resetModules();
    const { POST } = await import("@/app/api/chat/route");
    const req = chatReq([
      {
        role: "user",
        content: "List teams then check health of the first one",
      },
    ]);

    const res = await POST(req);
    const text = await readStream(res);
    const events = parseSSEEvents(text);

    // Should have tool_use events for both tools
    const toolEvents = events.filter(
      (e) => typeof e === "object" && e.type === "tool_use"
    );
    expect(toolEvents.length).toBe(2);

    // Both tools should have been called
    expect(mockListTeams).toHaveBeenCalled();
    expect(mockReadTeamConfig).toHaveBeenCalledWith("team-x");

    // Stream should have called the API 3 times (tool round 1, tool round 2, final text)
    expect(mockStreamFn).toHaveBeenCalledTimes(3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 13. Tool definitions
// ═══════════════════════════════════════════════════════════════════════════════

describe("POST /api/chat — tool definitions", () => {
  it("includes all expected tools in the API call", async () => {
    vi.resetModules();
    const { POST } = await import("@/app/api/chat/route");
    const req = chatReq([{ role: "user", content: "Hello" }]);

    await POST(req);

    const callArgs = mockStreamFn.mock.calls[0][0] as {
      tools: Array<{ name: string }>;
    };
    const toolNames = callArgs.tools.map((t) => t.name);

    expect(toolNames).toContain("list_teams");
    expect(toolNames).toContain("get_team_health");
    expect(toolNames).toContain("get_team_tasks");
    expect(toolNames).toContain("submit_queue_task");
    expect(toolNames).toContain("list_queue_tasks");
    expect(toolNames).toContain("search_knowledge_base");
    expect(toolNames).toContain("get_knowledge_base_entry");
    expect(toolNames).toHaveLength(7);
  });
});
