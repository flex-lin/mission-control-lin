import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

/**
 * Tests for projectPath support in team configs and the teams API.
 *
 * Covers:
 * 1. readTeamConfig() returns projectPath when present in config.json
 * 2. GET /api/teams includes projectPath in the response
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
      ],
      createdAt: new Date().toISOString(),
      ...overrides,
    }),
    "utf-8"
  );
}

// ── Setup / Teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-e2e-projectpath-"));
  vi.stubEnv("HOME", tmpDir);
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 1. readTeamConfig() — projectPath support
// ═══════════════════════════════════════════════════════════════════════════════

describe("readTeamConfig — projectPath", () => {
  it("returns projectPath when present in config.json", async () => {
    createTeamConfig("path-team", {
      projectPath: "/home/user/my-project",
    });

    vi.resetModules();
    const { readTeamConfig } = await import("@/lib/claude-files");
    const team = readTeamConfig("path-team");

    expect(team).not.toBeNull();
    expect(team!.projectPath).toBe("/home/user/my-project");
  });

  it("returns undefined projectPath when not in config.json", async () => {
    createTeamConfig("no-path-team");

    vi.resetModules();
    const { readTeamConfig } = await import("@/lib/claude-files");
    const team = readTeamConfig("no-path-team");

    expect(team).not.toBeNull();
    expect(team!.projectPath).toBeUndefined();
  });

  it("includes projectPath in listTeams() results", async () => {
    createTeamConfig("listed-team", {
      projectPath: "/repos/cool-project",
    });

    vi.resetModules();
    const { listTeams } = await import("@/lib/claude-files");
    const teams = listTeams();

    expect(teams).toHaveLength(1);
    expect(teams[0].projectPath).toBe("/repos/cool-project");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. GET /api/teams — projectPath in API response
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /api/teams — projectPath in response", () => {
  it("includes projectPath for teams that have it", async () => {
    createTeamConfig("api-path-team", {
      projectPath: "/home/user/workspace/repo",
    });

    vi.resetModules();
    const { GET } = await import("@/app/api/teams/route");
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].name).toBe("api-path-team");
    expect(body.data[0].projectPath).toBe("/home/user/workspace/repo");
  });

  it("omits projectPath for teams without it", async () => {
    createTeamConfig("api-no-path-team");

    vi.resetModules();
    const { GET } = await import("@/app/api/teams/route");
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].name).toBe("api-no-path-team");
    expect(body.data[0].projectPath).toBeUndefined();
  });

  it("returns projectPath for some teams and not others in mixed listing", async () => {
    createTeamConfig("with-path", {
      projectPath: "/projects/alpha",
    });
    createTeamConfig("without-path");

    vi.resetModules();
    const { GET } = await import("@/app/api/teams/route");
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(2);

    const withPath = body.data.find((t: { name: string }) => t.name === "with-path");
    const withoutPath = body.data.find((t: { name: string }) => t.name === "without-path");

    expect(withPath.projectPath).toBe("/projects/alpha");
    expect(withoutPath.projectPath).toBeUndefined();
  });
});
