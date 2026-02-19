import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import crypto from "crypto";

/**
 * Tests for POST /api/slack/slash endpoint
 *
 * Covers:
 * 1. Signature verification — invalid sig returns 401
 * 2. Immediate 200 acknowledgement (Slack requires response within 3s)
 * 3. /mc help — processSlashCommand sends help text via replyToSlashCommand
 * 4. /mc teams — lists active agent teams
 * 5. /mc queue list — lists pending/running queue tasks
 * 6. /mc queue add <goal> — adds a task to the queue
 * 7. /mc status — shows system status
 * 8. Unknown command — sends error message
 * 9. Slack not configured — returns 200 with error message
 *
 * Implementation details:
 * - Route uses getSlackConfigRaw() from lib/slack (via db.slackConfig)
 * - Route calls real verifySlackSignature (not mocked) with HMAC
 * - Route returns 200 immediately; async processing via replyToSlashCommand
 * - replyToSlashCommand sends POST to Slack response_url
 * - We mock replyToSlashCommand to capture what would be sent
 * - We must wait for the async void processSlashCommand to settle
 */

// ── DB Mocks ───────────────────────────────────────────────────────────────────

const mockSlackConfigFindMany = vi.fn();
const mockQueuedTaskCreate = vi.fn();
const mockQueuedTaskFindMany = vi.fn();
const mockQueuedTaskGroupBy = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    slackConfig: {
      findMany: (...args: unknown[]) => mockSlackConfigFindMany(...args),
    },
    queuedTask: {
      create: (...args: unknown[]) => mockQueuedTaskCreate(...args),
      findMany: (...args: unknown[]) => mockQueuedTaskFindMany(...args),
      groupBy: (...args: unknown[]) => mockQueuedTaskGroupBy(...args),
    },
  },
}));

// ── Slack lib mock ─────────────────────────────────────────────────────────────
// We mock replyToSlashCommand to capture what text would be sent to Slack.
// We do NOT mock verifySlackSignature (we use real HMAC in tests).

const mockReplyToSlashCommand = vi.fn();

vi.mock("@/lib/slack", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/slack")>();
  return {
    ...actual,
    replyToSlashCommand: (...args: unknown[]) => mockReplyToSlashCommand(...args),
  };
});

// ── Claude-files mock ─────────────────────────────────────────────────────────

const mockListTeams = vi.fn();
const mockReadTaskList = vi.fn();

vi.mock("@/lib/claude-files", () => ({
  listTeams: (...args: unknown[]) => mockListTeams(...args),
  readTeamConfig: vi.fn(() => null),
  readTaskList: (...args: unknown[]) => mockReadTaskList(...args),
  getTeamLastActivity: vi.fn(() => null),
}));

// ── Constants ─────────────────────────────────────────────────────────────────

const TEST_SIGNING_SECRET = "test-signing-secret-abc123";
const TEST_BOT_TOKEN = "xoxb-test-bot-token-123";

function makeFakeDbConfig(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    workspaceId: "T01234567",
    workspaceName: null,
    botToken: TEST_BOT_TOKEN,
    signingSecret: TEST_SIGNING_SECRET,
    appToken: null,
    channelId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// ── Signature helpers ─────────────────────────────────────────────────────────

function computeSlackSignature(body: string, timestamp: string, secret: string): string {
  const sigBase = `v0:${timestamp}:${body}`;
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(sigBase, "utf8");
  return `v0=${hmac.digest("hex")}`;
}

// ── Request builder ───────────────────────────────────────────────────────────

function makeSlashReq(
  text: string,
  options: {
    invalidSig?: boolean;
    noSig?: boolean;
    secret?: string;
    channelId?: string;
    userId?: string;
    teamId?: string;
  } = {}
): NextRequest {
  const params = new URLSearchParams({
    command: "/mc",
    text,
    channel_id: options.channelId ?? "C01234567",
    user_id: options.userId ?? "U01234567",
    team_id: options.teamId ?? "T01234567",
    user_name: "testuser",
    token: "slack-verification-token",
    response_url: "https://hooks.slack.com/commands/test-response-url",
  });
  const bodyStr = params.toString();
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    "x-slack-request-timestamp": timestamp,
  };

  if (options.noSig) {
    // No signature headers at all
  } else if (options.invalidSig) {
    headers["x-slack-signature"] = "v0=invalidsignaturethatislong000000000000000000000000000000000000";
  } else {
    const secret = options.secret ?? TEST_SIGNING_SECRET;
    headers["x-slack-signature"] = computeSlackSignature(bodyStr, timestamp, secret);
  }

  return new NextRequest(new URL("http://localhost:31777/api/slack/slash"), {
    method: "POST",
    headers,
    body: bodyStr,
  });
}

// ── Route caller ──────────────────────────────────────────────────────────────

async function callPOST(
  text: string,
  options: Parameters<typeof makeSlashReq>[1] = {}
) {
  vi.resetModules();
  const mod = await import("@/app/api/slack/slash/route");
  const req = makeSlashReq(text, options);
  const res = await mod.POST(req);
  // Wait a tick for the async void processSlashCommand to settle
  await new Promise((r) => setTimeout(r, 50));
  return { status: res.status, body: await res.json() };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTeam(name: string, memberCount = 0) {
  const members = Array.from({ length: memberCount }, (_, i) => ({
    name: `member-${i}`,
    agentId: `a${i}`,
    agentType: "dev",
  }));
  return { name, description: "Test team", members, createdAt: new Date().toISOString() };
}

function getLastReplyText(): string {
  const lastCall = mockReplyToSlashCommand.mock.calls[mockReplyToSlashCommand.mock.calls.length - 1];
  return (lastCall?.[1] ?? "") as string;
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();

  mockSlackConfigFindMany.mockResolvedValue([makeFakeDbConfig()]);
  mockListTeams.mockReturnValue([]);
  mockReadTaskList.mockReturnValue([]);
  mockQueuedTaskFindMany.mockResolvedValue([]);
  mockQueuedTaskGroupBy.mockResolvedValue([]);
  mockQueuedTaskCreate.mockResolvedValue({
    id: 42,
    goal: "Test task",
    status: "pending",
    projectPath: process.cwd(),
    priority: 0,
    createdAt: new Date().toISOString(),
  });
  mockReplyToSlashCommand.mockResolvedValue(undefined);
});

// ── Slack not configured ──────────────────────────────────────────────────────

describe("POST /api/slack/slash — Slack not configured", () => {
  it("returns 200 with a 'not configured' message when Slack is not set up", async () => {
    mockSlackConfigFindMany.mockResolvedValue([]);

    const { status, body } = await callPOST("help", { noSig: true });

    expect(status).toBe(200);
    const text = (body.text ?? "") as string;
    expect(text.toLowerCase()).toMatch(/not configured/i);
  });
});

// ── Signature verification ─────────────────────────────────────────────────────

describe("POST /api/slack/slash — signature verification", () => {
  it("returns 401 when signature is invalid", async () => {
    const { status } = await callPOST("help", { invalidSig: true });

    expect(status).toBe(401);
  });

  it("returns 401 when signature header is missing", async () => {
    const { status } = await callPOST("help", { noSig: true });

    expect(status).toBe(401);
  });

  it("returns 401 when signed with wrong secret", async () => {
    const { status } = await callPOST("help", { secret: "wrong-signing-secret" });

    expect(status).toBe(401);
  });

  it("returns 200 for valid signature", async () => {
    const { status } = await callPOST("help");

    expect(status).toBe(200);
  });
});

// ── Immediate acknowledgement ─────────────────────────────────────────────────

describe("POST /api/slack/slash — immediate 200 acknowledgement", () => {
  it("always returns 200 immediately with processing message", async () => {
    const { status, body } = await callPOST("help");

    expect(status).toBe(200);
    // Immediate response to prevent Slack timeout
    const text = (body.text ?? "") as string;
    expect(text).toMatch(/processing/i);
  });

  it("response_type is ephemeral in immediate acknowledgement", async () => {
    const { body } = await callPOST("help");

    expect(body.response_type).toBe("ephemeral");
  });
});

// ── /mc help ──────────────────────────────────────────────────────────────────

describe("POST /api/slack/slash — /mc help", () => {
  it("calls replyToSlashCommand with help text", async () => {
    await callPOST("help");

    expect(mockReplyToSlashCommand).toHaveBeenCalledOnce();
    const text = getLastReplyText();
    expect(text.length).toBeGreaterThan(0);
  });

  it("help text mentions key commands", async () => {
    await callPOST("help");

    const text = getLastReplyText();
    expect(text).toMatch(/help/i);
    expect(text).toMatch(/queue/i);
    expect(text).toMatch(/teams/i);
  });

  it("empty text defaults to help", async () => {
    await callPOST("");

    expect(mockReplyToSlashCommand).toHaveBeenCalledOnce();
    const text = getLastReplyText();
    // Should get help text for empty command
    expect(text.length).toBeGreaterThan(0);
  });
});

// ── /mc teams ─────────────────────────────────────────────────────────────────

describe("POST /api/slack/slash — /mc teams", () => {
  it("replies with team list when teams exist", async () => {
    mockListTeams.mockReturnValue([
      makeTeam("alpha-team", 2),
      makeTeam("beta-team", 3),
    ]);

    await callPOST("teams");

    const text = getLastReplyText();
    expect(text).toMatch(/alpha-team/i);
    expect(text).toMatch(/beta-team/i);
  });

  it("includes team count in reply", async () => {
    mockListTeams.mockReturnValue([
      makeTeam("team-a"),
      makeTeam("team-b"),
      makeTeam("team-c"),
    ]);

    await callPOST("teams");

    const text = getLastReplyText();
    expect(text).toMatch(/3/);
  });

  it("replies with 'no teams' message when teams list is empty", async () => {
    mockListTeams.mockReturnValue([]);

    await callPOST("teams");

    const text = getLastReplyText();
    expect(text.toLowerCase()).toMatch(/no.*team|team.*not found/i);
  });

  it("includes member count in team listing", async () => {
    mockListTeams.mockReturnValue([makeTeam("test-team", 3)]);
    mockReadTaskList.mockReturnValue([]);

    await callPOST("teams");

    const text = getLastReplyText();
    expect(text).toMatch(/3.*member|member.*3/i);
  });

  it("includes task stats in team listing", async () => {
    mockListTeams.mockReturnValue([makeTeam("task-team", 1)]);
    mockReadTaskList.mockReturnValue([
      { id: "t1", subject: "Task 1", status: "completed" },
      { id: "t2", subject: "Task 2", status: "in_progress" },
      { id: "t3", subject: "Task 3", status: "pending" },
    ]);

    await callPOST("teams");

    const text = getLastReplyText();
    // Should include counts for active, pending, done tasks
    expect(text).toMatch(/\d+.*active|active.*\d+|in.progress|pending|done|completed/i);
  });
});

// ── /mc queue list ────────────────────────────────────────────────────────────

describe("POST /api/slack/slash — /mc queue list", () => {
  it("replies with task list when tasks exist", async () => {
    mockQueuedTaskFindMany.mockResolvedValue([
      { id: 1, goal: "Build dashboard feature", status: "pending", priority: 0, createdAt: new Date().toISOString() },
      { id: 2, goal: "Fix login bug", status: "running", priority: 1, createdAt: new Date().toISOString() },
    ]);

    await callPOST("queue list");

    const text = getLastReplyText();
    expect(text).toMatch(/Build dashboard feature/i);
    expect(text).toMatch(/Fix login bug/i);
  });

  it("replies with empty queue message when no pending/running tasks", async () => {
    mockQueuedTaskFindMany.mockResolvedValue([]);

    await callPOST("queue list");

    const text = getLastReplyText();
    expect(text.toLowerCase()).toMatch(/no.*task|no.*pending|empty/i);
  });

  it("queries DB for pending and running tasks only", async () => {
    mockQueuedTaskFindMany.mockResolvedValue([]);

    await callPOST("queue list");

    expect(mockQueuedTaskFindMany).toHaveBeenCalledOnce();
    const arg = mockQueuedTaskFindMany.mock.calls[0][0] as {
      where: { status: { in: string[] } };
    };
    expect(arg.where.status.in).toContain("pending");
    expect(arg.where.status.in).toContain("running");
  });

  it("includes task count in reply", async () => {
    mockQueuedTaskFindMany.mockResolvedValue([
      { id: 10, goal: "Task A", status: "pending", priority: 0, createdAt: new Date().toISOString() },
      { id: 11, goal: "Task B", status: "running", priority: 0, createdAt: new Date().toISOString() },
    ]);

    await callPOST("queue list");

    const text = getLastReplyText();
    expect(text).toMatch(/2/);
  });

  it("shows task status in the list", async () => {
    mockQueuedTaskFindMany.mockResolvedValue([
      { id: 5, goal: "Running task", status: "running", priority: 0, createdAt: new Date().toISOString() },
    ]);

    await callPOST("queue list");

    const text = getLastReplyText();
    expect(text).toMatch(/running/i);
  });
});

// ── /mc queue add <goal> ──────────────────────────────────────────────────────

describe("POST /api/slack/slash — /mc queue add", () => {
  it("creates a new queued task with the given goal", async () => {
    const goal = "Build the new reporting feature";
    mockQueuedTaskCreate.mockResolvedValue({
      id: 99,
      goal,
      status: "pending",
      projectPath: process.cwd(),
      priority: 0,
      createdAt: new Date().toISOString(),
    });

    await callPOST(`queue add ${goal}`);

    expect(mockQueuedTaskCreate).toHaveBeenCalledOnce();
    const createArg = mockQueuedTaskCreate.mock.calls[0][0] as {
      data: { goal: string; projectPath: string; priority: number };
    };
    expect(createArg.data.goal).toBe(goal);
    expect(createArg.data.priority).toBe(0);
  });

  it("replies with confirmation including task ID", async () => {
    mockQueuedTaskCreate.mockResolvedValue({
      id: 77,
      goal: "Test feature",
      status: "pending",
      priority: 0,
      createdAt: new Date().toISOString(),
    });

    await callPOST("queue add Test feature");

    const text = getLastReplyText();
    expect(text).toMatch(/77/);
  });

  it("replies with confirmation including the goal text", async () => {
    mockQueuedTaskCreate.mockResolvedValue({
      id: 55,
      goal: "Implement user authentication",
      status: "pending",
      priority: 0,
      createdAt: new Date().toISOString(),
    });

    await callPOST("queue add Implement user authentication");

    const text = getLastReplyText();
    expect(text).toMatch(/Implement user authentication/i);
  });

  it("replies with usage hint when goal is empty", async () => {
    await callPOST("queue add");

    // Should NOT create a task
    expect(mockQueuedTaskCreate).not.toHaveBeenCalled();
    const text = getLastReplyText();
    expect(text.toLowerCase()).toMatch(/usage|goal|description|queue add/i);
  });

  it("handles multi-word goal correctly", async () => {
    const goal = "Fix the authentication bug in the login endpoint";
    await callPOST(`queue add ${goal}`);

    const createArg = mockQueuedTaskCreate.mock.calls[0][0] as {
      data: { goal: string };
    };
    expect(createArg.data.goal).toBe(goal);
  });
});

// ── /mc status ────────────────────────────────────────────────────────────────

describe("POST /api/slack/slash — /mc status", () => {
  it("replies with system status information", async () => {
    mockListTeams.mockReturnValue([makeTeam("team-a"), makeTeam("team-b")]);
    mockQueuedTaskGroupBy.mockResolvedValue([
      { status: "pending", _count: { status: 3 } },
      { status: "running", _count: { status: 1 } },
      { status: "completed", _count: { status: 10 } },
    ]);

    await callPOST("status");

    const text = getLastReplyText();
    expect(text.length).toBeGreaterThan(0);
    // Should show team count
    expect(text).toMatch(/2.*team|team.*2/i);
  });

  it("includes queue counts in status", async () => {
    mockListTeams.mockReturnValue([]);
    mockQueuedTaskGroupBy.mockResolvedValue([
      { status: "pending", _count: { status: 5 } },
      { status: "running", _count: { status: 2 } },
    ]);

    await callPOST("status");

    const text = getLastReplyText();
    expect(text).toMatch(/5.*pending|pending.*5/i);
    expect(text).toMatch(/2.*running|running.*2/i);
  });
});

// ── Unknown command ───────────────────────────────────────────────────────────

describe("POST /api/slack/slash — unknown command", () => {
  it("replies with error message for unrecognized command", async () => {
    await callPOST("totally-unknown-command");

    const text = getLastReplyText();
    expect(text).toMatch(/unknown.*command|unrecognized|not.*recognized/i);
  });

  it("mentions the unrecognized command in the error reply", async () => {
    await callPOST("do-something-weird");

    const text = getLastReplyText();
    expect(text).toMatch(/do-something-weird/i);
  });

  it("suggests /mc help in the error reply", async () => {
    await callPOST("gibberish");

    const text = getLastReplyText();
    expect(text).toMatch(/\/mc help|help/i);
  });

  it("returns 200 for unknown commands (Slack always gets 200)", async () => {
    const { status } = await callPOST("something-unknown");

    expect(status).toBe(200);
  });
});

// ── Unknown queue action ──────────────────────────────────────────────────────

describe("POST /api/slack/slash — unknown queue action", () => {
  it("replies with error for unknown queue subcommand", async () => {
    await callPOST("queue badaction");

    const text = getLastReplyText();
    expect(text.toLowerCase()).toMatch(/unknown|use.*list|use.*add/i);
  });

  it("mentions 'list' and 'add' as valid queue actions", async () => {
    await callPOST("queue badaction");

    const text = getLastReplyText();
    expect(text).toMatch(/list|add/i);
  });
});
