import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";

/**
 * Integration tests for manually stopping and waking (restarting) teams.
 *
 * Covers:
 * 1. POST /api/teams/[name]/shutdown — graceful shutdown (inbox message)
 * 2. POST /api/teams/[name]/shutdown — force shutdown (kill tmux sessions)
 * 3. POST /api/teams/[name]/wake     — wake alive leader (send message)
 * 4. POST /api/teams/[name]/wake     — wake dead leader (restart session)
 * 5. Edge cases and error handling
 */

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockKillAllTeamSessions = vi.fn(() => ["mc-test-team-leader"]);
const mockSessionExists = vi.fn(() => false);
const mockSessionProcessAlive = vi.fn(() => false);
const mockSendKeys = vi.fn();
const mockKillSession = vi.fn();
const mockResumeTeamAsLeader = vi.fn(async () => ({
  sessionName: "mc-test-team-leader",
  launched: true,
}));

vi.mock("@/lib/tmux-manager", () => ({
  getSessionName: (team: string, member: string) => `mc-${team}-${member}`,
  sessionExists: (...args: unknown[]) => mockSessionExists(...args),
  sessionProcessAlive: (...args: unknown[]) => mockSessionProcessAlive(...args),
  killSession: (...args: unknown[]) => mockKillSession(...args),
  killAllTeamSessions: (...args: unknown[]) => mockKillAllTeamSessions(...args),
  sendKeys: (...args: unknown[]) => mockSendKeys(...args),
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
  resumeTeamAsLeader: (...args: unknown[]) => mockResumeTeamAsLeader(...args),
  getLeaderSessionName: (teamName: string) => `mc-${teamName}-leader`,
  personaToLaunchable: (p: {
    name: string;
    role: string;
    agentType: string;
    description: string;
  }) => ({
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
        { name: "tester", agentId: "tester-1", agentType: "general-purpose" },
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
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-e2e-stop-wake-"));
  vi.stubEnv("HOME", tmpDir);
  vi.resetModules();
  mockKillAllTeamSessions.mockClear();
  mockSessionExists.mockClear();
  mockSessionProcessAlive.mockClear();
  mockSendKeys.mockClear();
  mockKillSession.mockClear();
  mockResumeTeamAsLeader.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 1. POST /api/teams/[name]/shutdown — graceful shutdown
// ═══════════════════════════════════════════════════════════════════════════════

describe("POST /api/teams/[name]/shutdown — graceful shutdown", () => {
  it("sends shutdown_request message to the recipient's inbox", async () => {
    createTeamConfig("stop-team");

    const { POST } = await import(
      "@/app/api/teams/[name]/shutdown/route"
    );
    const req = makeReq("http://localhost:31777/api/teams/stop-team/shutdown", {
      method: "POST",
      body: JSON.stringify({ recipient: "dev", reason: "Manual stop" }),
    });
    const res = await POST(req, {
      params: Promise.resolve({ name: "stop-team" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.status).toBe("shutdown_requested");
    expect(body.data.requestId).toMatch(/^shutdown-\d+$/);

    // Verify inbox file was created with correct message
    const inboxFile = path.join(
      tmpDir,
      ".claude",
      "teams",
      "stop-team",
      "inboxes",
      "dev.json"
    );
    expect(fs.existsSync(inboxFile)).toBe(true);
    const messages = JSON.parse(fs.readFileSync(inboxFile, "utf-8"));
    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe("shutdown_request");
    expect(messages[0].from).toBe("dashboard");
    expect(messages[0].to).toBe("dev");
    expect(messages[0].content).toBe("Manual stop");
  });

  it("uses default reason when none provided", async () => {
    createTeamConfig("stop-default");

    const { POST } = await import(
      "@/app/api/teams/[name]/shutdown/route"
    );
    const req = makeReq(
      "http://localhost:31777/api/teams/stop-default/shutdown",
      {
        method: "POST",
        body: JSON.stringify({ recipient: "dev" }),
      }
    );
    const res = await POST(req, {
      params: Promise.resolve({ name: "stop-default" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);

    const inboxFile = path.join(
      tmpDir,
      ".claude",
      "teams",
      "stop-default",
      "inboxes",
      "dev.json"
    );
    const messages = JSON.parse(fs.readFileSync(inboxFile, "utf-8"));
    expect(messages[0].content).toBe("Shutdown requested from dashboard");
  });

  it("appends to existing inbox messages", async () => {
    createTeamConfig("stop-append");

    // Pre-populate inbox with an existing message
    const inboxDir = path.join(
      tmpDir,
      ".claude",
      "teams",
      "stop-append",
      "inboxes"
    );
    fs.mkdirSync(inboxDir, { recursive: true });
    fs.writeFileSync(
      path.join(inboxDir, "dev.json"),
      JSON.stringify([
        { id: "old-msg", type: "message", content: "Hello" },
      ]),
      "utf-8"
    );

    const { POST } = await import(
      "@/app/api/teams/[name]/shutdown/route"
    );
    const req = makeReq(
      "http://localhost:31777/api/teams/stop-append/shutdown",
      {
        method: "POST",
        body: JSON.stringify({ recipient: "dev" }),
      }
    );
    const res = await POST(req, {
      params: Promise.resolve({ name: "stop-append" }),
    });

    expect(res.status).toBe(200);

    const inboxFile = path.join(inboxDir, "dev.json");
    const messages = JSON.parse(fs.readFileSync(inboxFile, "utf-8"));
    expect(messages).toHaveLength(2);
    expect(messages[0].id).toBe("old-msg");
    expect(messages[1].type).toBe("shutdown_request");
  });

  it("returns 404 when team does not exist", async () => {
    const { POST } = await import(
      "@/app/api/teams/[name]/shutdown/route"
    );
    const req = makeReq(
      "http://localhost:31777/api/teams/nonexistent/shutdown",
      {
        method: "POST",
        body: JSON.stringify({ recipient: "dev" }),
      }
    );
    const res = await POST(req, {
      params: Promise.resolve({ name: "nonexistent" }),
    });

    expect(res.status).toBe(404);
  });

  it("returns validation error when recipient is missing", async () => {
    createTeamConfig("stop-no-recip");

    const { POST } = await import(
      "@/app/api/teams/[name]/shutdown/route"
    );
    const req = makeReq(
      "http://localhost:31777/api/teams/stop-no-recip/shutdown",
      {
        method: "POST",
        body: JSON.stringify({}),
      }
    );
    const res = await POST(req, {
      params: Promise.resolve({ name: "stop-no-recip" }),
    });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("returns 404 when recipient is not a team member", async () => {
    createTeamConfig("stop-bad-member");

    const { POST } = await import(
      "@/app/api/teams/[name]/shutdown/route"
    );
    const req = makeReq(
      "http://localhost:31777/api/teams/stop-bad-member/shutdown",
      {
        method: "POST",
        body: JSON.stringify({ recipient: "ghost" }),
      }
    );
    const res = await POST(req, {
      params: Promise.resolve({ name: "stop-bad-member" }),
    });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toContain("ghost");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. POST /api/teams/[name]/shutdown — force shutdown
// ═══════════════════════════════════════════════════════════════════════════════

describe("POST /api/teams/[name]/shutdown — force shutdown", () => {
  it("kills all tmux sessions immediately", async () => {
    createTeamConfig("force-team");
    mockKillAllTeamSessions.mockReturnValue([
      "mc-force-team-leader",
      "mc-force-team-dev",
    ]);

    const { POST } = await import(
      "@/app/api/teams/[name]/shutdown/route"
    );
    const req = makeReq(
      "http://localhost:31777/api/teams/force-team/shutdown",
      {
        method: "POST",
        body: JSON.stringify({ force: true }),
      }
    );
    const res = await POST(req, {
      params: Promise.resolve({ name: "force-team" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.status).toBe("force_killed");
    expect(body.data.killed).toEqual([
      "mc-force-team-leader",
      "mc-force-team-dev",
    ]);
    expect(mockKillAllTeamSessions).toHaveBeenCalledWith("force-team");
  });

  it("force shutdown does not require recipient", async () => {
    createTeamConfig("force-no-recip");

    const { POST } = await import(
      "@/app/api/teams/[name]/shutdown/route"
    );
    const req = makeReq(
      "http://localhost:31777/api/teams/force-no-recip/shutdown",
      {
        method: "POST",
        body: JSON.stringify({ force: true }),
      }
    );
    const res = await POST(req, {
      params: Promise.resolve({ name: "force-no-recip" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.status).toBe("force_killed");
  });

  it("does not write to inbox on force shutdown", async () => {
    createTeamConfig("force-no-inbox");

    const { POST } = await import(
      "@/app/api/teams/[name]/shutdown/route"
    );
    const req = makeReq(
      "http://localhost:31777/api/teams/force-no-inbox/shutdown",
      {
        method: "POST",
        body: JSON.stringify({ force: true }),
      }
    );
    await POST(req, {
      params: Promise.resolve({ name: "force-no-inbox" }),
    });

    const inboxDir = path.join(
      tmpDir,
      ".claude",
      "teams",
      "force-no-inbox",
      "inboxes"
    );
    expect(fs.existsSync(inboxDir)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. POST /api/teams/[name]/wake — wake alive leader
// ═══════════════════════════════════════════════════════════════════════════════

describe("POST /api/teams/[name]/wake — wake alive leader", () => {
  it("sends wake message to alive leader session", async () => {
    createTeamConfig("wake-alive");
    mockSessionExists.mockReturnValue(true);
    mockSessionProcessAlive.mockReturnValue(true);

    const { POST } = await import("@/app/api/teams/[name]/wake/route");
    const req = makeReq("http://localhost:31777/api/teams/wake-alive/wake", {
      method: "POST",
      body: JSON.stringify({ message: "Time to work!" }),
    });
    const res = await POST(req, {
      params: Promise.resolve({ name: "wake-alive" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.woken).toBe(true);
    expect(body.data.teamName).toBe("wake-alive");
    expect(body.data.message).toContain("Sent wake message");
    expect(mockSendKeys).toHaveBeenCalledWith(
      "mc-wake-alive-leader",
      "Time to work!"
    );
    expect(mockResumeTeamAsLeader).not.toHaveBeenCalled();
  });

  it("uses default wake message when none provided", async () => {
    createTeamConfig("wake-default-msg");
    mockSessionExists.mockReturnValue(true);
    mockSessionProcessAlive.mockReturnValue(true);

    const { POST } = await import("@/app/api/teams/[name]/wake/route");
    const req = makeReq(
      "http://localhost:31777/api/teams/wake-default-msg/wake",
      {
        method: "POST",
        body: JSON.stringify({}),
      }
    );
    const res = await POST(req, {
      params: Promise.resolve({ name: "wake-default-msg" }),
    });

    expect(res.status).toBe(200);
    expect(mockSendKeys).toHaveBeenCalledWith(
      "mc-wake-default-msg-leader",
      expect.stringContaining("Check your task list")
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. POST /api/teams/[name]/wake — restart dead leader
// ═══════════════════════════════════════════════════════════════════════════════

describe("POST /api/teams/[name]/wake — restart dead leader", () => {
  it("restarts leader when session does not exist", async () => {
    createTeamConfig("wake-dead", {
      projectPath: "/home/user/project",
      description: "Test project",
    });
    createTask("wake-dead", {
      id: "1",
      subject: "Pending work",
      status: "pending",
    });
    mockSessionExists.mockReturnValue(false);
    mockSessionProcessAlive.mockReturnValue(false);

    const { POST } = await import("@/app/api/teams/[name]/wake/route");
    const req = makeReq("http://localhost:31777/api/teams/wake-dead/wake", {
      method: "POST",
      body: JSON.stringify({}),
    });
    const res = await POST(req, {
      params: Promise.resolve({ name: "wake-dead" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.woken).toBe(true);
    expect(body.data.message).toContain("Restarted leader session");
    expect(mockResumeTeamAsLeader).toHaveBeenCalledWith(
      "wake-dead",
      "Test project",
      expect.any(Array),
      "/home/user/project",
      expect.any(Array)
    );
    expect(mockSendKeys).not.toHaveBeenCalled();
  });

  it("kills stale session before restart when session exists but process is dead", async () => {
    createTeamConfig("wake-stale");
    mockSessionExists.mockReturnValue(true);
    mockSessionProcessAlive.mockReturnValue(false);

    const { POST } = await import("@/app/api/teams/[name]/wake/route");
    const req = makeReq("http://localhost:31777/api/teams/wake-stale/wake", {
      method: "POST",
      body: JSON.stringify({}),
    });
    const res = await POST(req, {
      params: Promise.resolve({ name: "wake-stale" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.message).toContain("Restarted");
    expect(mockKillSession).toHaveBeenCalledWith("mc-wake-stale-leader");
    expect(mockResumeTeamAsLeader).toHaveBeenCalled();
  });

  it("rebuilds personas from team members excluding leader", async () => {
    createTeamConfig("wake-personas", {
      members: [
        { name: "leader", agentId: "l-1", agentType: "general-purpose" },
        { name: "frontend", agentId: "f-1", agentType: "frontend-dev" },
        { name: "backend", agentId: "b-1", agentType: "backend-dev" },
      ],
    });
    mockSessionExists.mockReturnValue(false);
    mockSessionProcessAlive.mockReturnValue(false);

    const { POST } = await import("@/app/api/teams/[name]/wake/route");
    const req = makeReq(
      "http://localhost:31777/api/teams/wake-personas/wake",
      {
        method: "POST",
        body: JSON.stringify({}),
      }
    );
    await POST(req, {
      params: Promise.resolve({ name: "wake-personas" }),
    });

    // resumeTeamAsLeader receives launchable personas (leader excluded)
    const launchables = mockResumeTeamAsLeader.mock.calls[0][2];
    expect(launchables).toHaveLength(2);
    expect(launchables.map((l: { name: string }) => l.name)).toEqual([
      "frontend",
      "backend",
    ]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. Edge cases and error handling
// ═══════════════════════════════════════════════════════════════════════════════

describe("Stop/Wake — edge cases", () => {
  it("wake returns 404 for nonexistent team", async () => {
    const { POST } = await import("@/app/api/teams/[name]/wake/route");
    const req = makeReq("http://localhost:31777/api/teams/ghost-team/wake", {
      method: "POST",
      body: JSON.stringify({}),
    });
    const res = await POST(req, {
      params: Promise.resolve({ name: "ghost-team" }),
    });

    expect(res.status).toBe(404);
  });

  it("wake rejects invalid team names", async () => {
    const { POST } = await import("@/app/api/teams/[name]/wake/route");
    const req = makeReq(
      "http://localhost:31777/api/teams/../../etc/passwd/wake",
      {
        method: "POST",
        body: JSON.stringify({}),
      }
    );
    const res = await POST(req, {
      params: Promise.resolve({ name: "../../etc/passwd" }),
    });

    // safeName() throws, caught by serverError
    expect(res.status).toBe(500);
  });

  it("wake works with empty body (no JSON)", async () => {
    createTeamConfig("wake-nobody");
    mockSessionExists.mockReturnValue(true);
    mockSessionProcessAlive.mockReturnValue(true);

    const { POST } = await import("@/app/api/teams/[name]/wake/route");
    const req = makeReq("http://localhost:31777/api/teams/wake-nobody/wake", {
      method: "POST",
    });
    const res = await POST(req, {
      params: Promise.resolve({ name: "wake-nobody" }),
    });

    expect(res.status).toBe(200);
    expect(mockSendKeys).toHaveBeenCalledWith(
      "mc-wake-nobody-leader",
      expect.stringContaining("Check your task list")
    );
  });

  it("shutdown then wake flow works end-to-end", async () => {
    createTeamConfig("lifecycle-team");
    mockKillAllTeamSessions.mockReturnValue(["mc-lifecycle-team-leader"]);

    // Step 1: Force shutdown
    const shutdown = await import(
      "@/app/api/teams/[name]/shutdown/route"
    );
    const shutdownReq = makeReq(
      "http://localhost:31777/api/teams/lifecycle-team/shutdown",
      {
        method: "POST",
        body: JSON.stringify({ force: true }),
      }
    );
    const shutdownRes = await shutdown.POST(shutdownReq, {
      params: Promise.resolve({ name: "lifecycle-team" }),
    });
    expect(shutdownRes.status).toBe(200);
    const shutdownBody = await shutdownRes.json();
    expect(shutdownBody.data.status).toBe("force_killed");

    // Step 2: Wake (leader should be dead after force kill)
    mockSessionExists.mockReturnValue(false);
    mockSessionProcessAlive.mockReturnValue(false);

    const wake = await import("@/app/api/teams/[name]/wake/route");
    const wakeReq = makeReq(
      "http://localhost:31777/api/teams/lifecycle-team/wake",
      {
        method: "POST",
        body: JSON.stringify({ message: "Resume work" }),
      }
    );
    const wakeRes = await wake.POST(wakeReq, {
      params: Promise.resolve({ name: "lifecycle-team" }),
    });
    expect(wakeRes.status).toBe(200);
    const wakeBody = await wakeRes.json();
    expect(wakeBody.data.woken).toBe(true);
    expect(wakeBody.data.message).toContain("Restarted");
    expect(mockResumeTeamAsLeader).toHaveBeenCalled();
  });
});
