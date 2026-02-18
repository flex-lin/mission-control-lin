import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

/**
 * Tests for team-spawner.ts — the spawnTeam function that orchestrates
 * team config creation, task file writing, and leader launch.
 */

// Mock tmux/agent-launcher to avoid real process spawning
vi.mock("@/lib/tmux-manager", () => ({
  getSessionName: (team: string, member: string) => `mc-${team}-${member}`,
  sessionExists: vi.fn(() => false),
  createSession: vi.fn(),
  sessionProcessAlive: vi.fn(() => false),
  killSession: vi.fn(),
  sendKeysAndSubmit: vi.fn(),
  capturePane: vi.fn(() => "❯"),
  sendRawKey: vi.fn(),
  getTeamSessionStatus: vi.fn(() => ({})),
}));

vi.mock("@/lib/agent-launcher", () => ({
  launchTeamAsLeader: vi.fn(async (teamName: string) => ({
    sessionName: `mc-${teamName}-leader`,
    launched: true,
  })),
  getLeaderSessionName: (teamName: string) => `mc-${teamName}-leader`,
  personaToLaunchable: (p: { name: string; role: string; agentType: string; description: string }) => ({
    name: p.name,
    role: p.role,
    agentType: p.agentType,
    description: p.description,
  }),
}));

let tmpDir: string;

describe("team-spawner", () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-spawner-test-"));
    vi.stubEnv("HOME", tmpDir);
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  async function getModule() {
    return await import("@/lib/team-spawner");
  }

  it("creates team config directory and file", async () => {
    const mod = await getModule();
    const result = await mod.spawnTeam({
      teamName: "test-team",
      description: "A test team",
      personas: [
        { name: "dev", role: "Developer", agentType: "general-purpose", description: "Code" },
      ],
      initialTasks: [],
    });

    expect(result.teamName).toBe("test-team");
    const configPath = path.join(tmpDir, ".claude", "teams", "test-team", "config.json");
    expect(fs.existsSync(configPath)).toBe(true);

    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    expect(config.name).toBe("test-team");
    expect(config.members).toHaveLength(2); // leader + dev
    expect(config.members[0].name).toBe("leader");
    expect(config.members[1].name).toBe("dev");
  });

  it("creates task files in the tasks directory", async () => {
    const mod = await getModule();
    await mod.spawnTeam({
      teamName: "task-team",
      description: "Team with tasks",
      personas: [
        { name: "worker", role: "Worker", agentType: "general-purpose", description: "Work" },
      ],
      initialTasks: [
        { subject: "Task One", description: "Do task one", assignTo: "worker" },
        { subject: "Task Two", description: "Do task two" },
      ],
    });

    const taskDir = path.join(tmpDir, ".claude", "tasks", "task-team");
    expect(fs.existsSync(taskDir)).toBe(true);

    const task1 = JSON.parse(fs.readFileSync(path.join(taskDir, "1.json"), "utf-8"));
    expect(task1.subject).toBe("Task One");
    expect(task1.owner).toBe("worker");
    expect(task1.status).toBe("pending");

    const task2 = JSON.parse(fs.readFileSync(path.join(taskDir, "2.json"), "utf-8"));
    expect(task2.subject).toBe("Task Two");
    expect(task2.owner).toBeUndefined();
  });

  it("returns correct member and task counts", async () => {
    const mod = await getModule();
    const result = await mod.spawnTeam({
      teamName: "count-team",
      description: "Count test",
      personas: [
        { name: "a", role: "A", agentType: "general-purpose", description: "A" },
        { name: "b", role: "B", agentType: "general-purpose", description: "B" },
      ],
      initialTasks: [
        { subject: "T1", description: "D1" },
        { subject: "T2", description: "D2" },
        { subject: "T3", description: "D3" },
      ],
    });

    expect(result.membersCreated).toBe(3); // leader + 2 personas
    expect(result.tasksCreated).toBe(3);
  });

  it("rejects invalid team names", async () => {
    const mod = await getModule();
    await expect(
      mod.spawnTeam({
        teamName: "../evil",
        description: "Bad",
        personas: [],
        initialTasks: [],
      })
    ).rejects.toThrow("Invalid name");
  });

  it("rejects team names with special characters", async () => {
    const mod = await getModule();
    await expect(
      mod.spawnTeam({
        teamName: "bad name!",
        description: "Bad",
        personas: [],
        initialTasks: [],
      })
    ).rejects.toThrow("Invalid name");
  });

  it("includes projectPath in config when provided", async () => {
    const mod = await getModule();
    await mod.spawnTeam(
      {
        teamName: "proj-team",
        description: "With project",
        personas: [],
        initialTasks: [],
      },
      "/home/user/project"
    );

    const configPath = path.join(tmpDir, ".claude", "teams", "proj-team", "config.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    expect(config.projectPath).toBe("/home/user/project");
  });

  it("handles empty personas and tasks", async () => {
    const mod = await getModule();
    const result = await mod.spawnTeam({
      teamName: "empty-team",
      description: "Empty",
      personas: [],
      initialTasks: [],
    });

    expect(result.membersCreated).toBe(1); // leader only
    expect(result.tasksCreated).toBe(0);
  });

  it("calls launchTeamAsLeader with correct args", async () => {
    const mod = await getModule();
    const { launchTeamAsLeader } = await import("@/lib/agent-launcher");
    await mod.spawnTeam({
      teamName: "launch-team",
      description: "Launcher test",
      personas: [
        { name: "dev", role: "Dev", agentType: "general-purpose", description: "Code" },
      ],
      initialTasks: [
        { subject: "Build feature", description: "Build it", assignTo: "dev" },
      ],
    });

    expect(launchTeamAsLeader).toHaveBeenCalledWith(
      "launch-team",
      "Launcher test",
      [{ name: "dev", role: "Dev", agentType: "general-purpose", description: "Code" }],
      undefined,
      expect.arrayContaining([
        expect.objectContaining({ subject: "Build feature", owner: "dev" }),
      ])
    );
  });
});
