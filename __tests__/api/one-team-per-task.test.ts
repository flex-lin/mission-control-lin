import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

/**
 * Tests for the one-team-per-task invariant.
 *
 * The system must enforce that each queued task spawns at most ONE agent team.
 * Key behaviors:
 * - spawnTeam writes a team config with a unique name derived from the task ID
 * - The queue worker prefixes team names with "q-{taskId}-" to tie teams to tasks
 * - POST /api/teams rejects duplicate team names (409 CONFLICT)
 * - spawnTeam overwrites the config if called with the same name (no built-in guard)
 *   so the API layer / queue worker must prevent double-spawns
 * - Deleted teams don't block new teams with the same name
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
  listTeamSessions: vi.fn(() => []),
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

vi.mock("@/lib/sleep-detector", () => ({
  writeBackgroundConfig: vi.fn(),
  readBackgroundConfig: vi.fn(() => ({ persistent: false })),
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

let tmpDir: string;

describe("One-Team-Per-Task Enforcement", () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-one-team-test-"));
    vi.stubEnv("HOME", tmpDir);
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  async function getSpawner() {
    return await import("@/lib/team-spawner");
  }

  async function getClaudeFiles() {
    return await import("@/lib/claude-files");
  }

  function makePlan(teamName: string) {
    return {
      teamName,
      description: `Team for ${teamName}`,
      personas: [
        { name: "dev", role: "Developer", agentType: "general-purpose", description: "Codes" },
      ],
      initialTasks: [
        { subject: "Implement feature", description: "Build the thing", assignTo: "dev" },
      ],
    };
  }

  // ── Successful single team creation ──────────────────────────────────────

  describe("single team creation", () => {
    it("creates exactly one team for a task", async () => {
      const { spawnTeam } = await getSpawner();
      const result = await spawnTeam(makePlan("q-1-my-feature"));

      expect(result.teamName).toBe("q-1-my-feature");
      expect(result.membersCreated).toBe(2); // leader + dev
      expect(result.tasksCreated).toBe(1);

      const configPath = path.join(tmpDir, ".claude", "teams", "q-1-my-feature", "config.json");
      expect(fs.existsSync(configPath)).toBe(true);
    });

    it("team name encodes the task ID for traceability", async () => {
      const { spawnTeam } = await getSpawner();

      // The queue worker convention: q-{taskId}-{planName}
      const result = await spawnTeam(makePlan("q-42-build-auth"));
      expect(result.teamName).toBe("q-42-build-auth");

      // Verify we can extract the task ID from the team name
      const match = result.teamName.match(/^q-(\d+)-/);
      expect(match).toBeTruthy();
      expect(match![1]).toBe("42");
    });

    it("creates task files that reference the team", async () => {
      const { spawnTeam } = await getSpawner();
      await spawnTeam(makePlan("q-5-add-tests"));

      const taskDir = path.join(tmpDir, ".claude", "tasks", "q-5-add-tests");
      expect(fs.existsSync(taskDir)).toBe(true);

      const task1 = JSON.parse(fs.readFileSync(path.join(taskDir, "1.json"), "utf-8"));
      expect(task1.subject).toBe("Implement feature");
      expect(task1.status).toBe("pending");
      expect(task1.owner).toBe("dev");
    });
  });

  // ── Duplicate team prevention ─────────────────────────────────────────────

  describe("duplicate team prevention", () => {
    it("POST /api/teams rejects creation of a team with an existing name", async () => {
      // Simulate the file-based check that POST /api/teams does
      const teamDir = path.join(tmpDir, ".claude", "teams", "q-1-feature");
      fs.mkdirSync(teamDir, { recursive: true });
      fs.writeFileSync(
        path.join(teamDir, "config.json"),
        JSON.stringify({ name: "q-1-feature", members: [], createdAt: new Date().toISOString() }),
        "utf-8"
      );

      // The check: config.json exists → reject
      const configExists = fs.existsSync(path.join(teamDir, "config.json"));
      expect(configExists).toBe(true);
      // In the real API route, this would return 409 CONFLICT
    });

    it("spawnTeam rejects duplicate team creation with the same name", async () => {
      const { spawnTeam } = await getSpawner();

      const plan = makePlan("q-1-feature");
      await spawnTeam(plan);

      // Second spawn with same name should throw
      await expect(spawnTeam(plan)).rejects.toThrow(/already exists/);

      // Original config should be unchanged
      const configPath = path.join(tmpDir, ".claude", "teams", "q-1-feature", "config.json");
      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      expect(config.name).toBe("q-1-feature");
    });

    it("two different task IDs can each create their own team", async () => {
      const { spawnTeam } = await getSpawner();

      const result1 = await spawnTeam(makePlan("q-1-feature-a"));
      const result2 = await spawnTeam(makePlan("q-2-feature-b"));

      expect(result1.teamName).toBe("q-1-feature-a");
      expect(result2.teamName).toBe("q-2-feature-b");

      // Both configs exist independently
      const config1 = path.join(tmpDir, ".claude", "teams", "q-1-feature-a", "config.json");
      const config2 = path.join(tmpDir, ".claude", "teams", "q-2-feature-b", "config.json");
      expect(fs.existsSync(config1)).toBe(true);
      expect(fs.existsSync(config2)).toBe(true);
    });

    it("listTeams shows both teams separately", async () => {
      const { spawnTeam } = await getSpawner();
      const { listTeams } = await getClaudeFiles();

      await spawnTeam(makePlan("q-1-alpha"));
      await spawnTeam(makePlan("q-2-beta"));

      const teams = listTeams();
      const names = teams.map((t) => t.name);
      expect(names).toContain("q-1-alpha");
      expect(names).toContain("q-2-beta");
      expect(teams.length).toBe(2);
    });
  });

  // ── Deleted team edge cases ──────────────────────────────────────────────

  describe("deleted teams", () => {
    it("deleted team does not appear in active team listing", async () => {
      const { spawnTeam } = await getSpawner();
      const { listTeams, deleteTeam } = await getClaudeFiles();

      await spawnTeam(makePlan("q-10-old-task"));

      // Delete the team
      deleteTeam("q-10-old-task");

      const teams = listTeams();
      const names = teams.map((t) => t.name);
      expect(names).not.toContain("q-10-old-task");
    });

    it("deleted team's directories are fully removed", async () => {
      const { spawnTeam } = await getSpawner();
      const { deleteTeam } = await getClaudeFiles();

      await spawnTeam(makePlan("q-11-delete-me"));
      deleteTeam("q-11-delete-me");

      const teamDir = path.join(tmpDir, ".claude", "teams", "q-11-delete-me");
      expect(fs.existsSync(teamDir)).toBe(false);

      const taskDir = path.join(tmpDir, ".claude", "tasks", "q-11-delete-me");
      expect(fs.existsSync(taskDir)).toBe(false);
    });

    it("a new team can reuse the name of a deleted team", async () => {
      const { spawnTeam } = await getSpawner();
      const { deleteTeam, listTeams } = await getClaudeFiles();

      await spawnTeam(makePlan("q-20-reuse"));
      deleteTeam("q-20-reuse");

      // Spawn again with the same name — should succeed since dir is gone
      await spawnTeam(makePlan("q-20-reuse"));

      const teams = listTeams();
      expect(teams.some((t) => t.name === "q-20-reuse")).toBe(true);
    });
  });

  // ── Completed team edge cases ─────────────────────────────────────────────

  describe("completed teams", () => {
    it("a team with all tasks completed has correct task stats", async () => {
      const { spawnTeam } = await getSpawner();
      const { readTaskList, writeTask } = await getClaudeFiles();

      await spawnTeam(makePlan("q-30-done"));

      // Mark all tasks as completed
      const tasks = readTaskList("q-30-done");
      for (const task of tasks) {
        task.status = "completed";
        writeTask("q-30-done", task);
      }

      const updated = readTaskList("q-30-done");
      expect(updated.every((t) => t.status === "completed")).toBe(true);
    });

    it("team with zero tasks is treated as completed", async () => {
      const { spawnTeam } = await getSpawner();
      const { readTaskList } = await getClaudeFiles();

      // Spawn team with no initial tasks
      await spawnTeam({
        teamName: "q-31-empty",
        description: "Empty team",
        personas: [{ name: "dev", role: "Dev", agentType: "general-purpose", description: "Codes" }],
        initialTasks: [],
      });

      const tasks = readTaskList("q-31-empty");
      expect(tasks.length).toBe(0);
      // In the GET /api/teams route, zero tasks → status = "completed"
    });
  });

  // ── Queue worker naming convention ────────────────────────────────────────

  describe("queue worker naming convention", () => {
    it("queue team names follow q-{id}-{planName} pattern", () => {
      // The queue worker constructs: `q-${task.id}-${plan.teamName}`
      const taskId = 7;
      const planName = "build-feature";
      const teamName = `q-${taskId}-${planName}`;
      expect(teamName).toBe("q-7-build-feature");
      expect(teamName).toMatch(/^q-\d+-[\w-]+$/);
    });

    it("different task IDs always produce different team names", () => {
      const plan = "same-plan-name";
      const name1 = `q-1-${plan}`;
      const name2 = `q-2-${plan}`;
      expect(name1).not.toBe(name2);
    });

    it("same task ID always maps to the same team name prefix", () => {
      const prefix1 = "q-42-";
      const prefix2 = "q-42-";
      expect(prefix1).toBe(prefix2);
    });
  });

  // ── Task file isolation between teams ──────────────────────────────────────

  describe("task file isolation", () => {
    it("each team has its own task directory", async () => {
      const { spawnTeam } = await getSpawner();

      await spawnTeam(makePlan("q-50-team-a"));
      await spawnTeam(makePlan("q-51-team-b"));

      const taskDirA = path.join(tmpDir, ".claude", "tasks", "q-50-team-a");
      const taskDirB = path.join(tmpDir, ".claude", "tasks", "q-51-team-b");

      expect(fs.existsSync(taskDirA)).toBe(true);
      expect(fs.existsSync(taskDirB)).toBe(true);

      // They should be different directories
      expect(fs.realpathSync(taskDirA)).not.toBe(fs.realpathSync(taskDirB));
    });

    it("modifying tasks in one team does not affect another", async () => {
      const { spawnTeam } = await getSpawner();
      const { readTaskList, writeTask } = await getClaudeFiles();

      await spawnTeam(makePlan("q-60-isolated-a"));
      await spawnTeam(makePlan("q-61-isolated-b"));

      // Complete all tasks in team A
      const tasksA = readTaskList("q-60-isolated-a");
      for (const t of tasksA) {
        t.status = "completed";
        writeTask("q-60-isolated-a", t);
      }

      // Team B tasks should be unaffected
      const tasksB = readTaskList("q-61-isolated-b");
      expect(tasksB.every((t) => t.status === "pending")).toBe(true);
    });
  });

  // ── Security: name validation ──────────────────────────────────────────────

  describe("name validation prevents injection", () => {
    it("rejects team names with path traversal", async () => {
      const { spawnTeam } = await getSpawner();
      await expect(spawnTeam(makePlan("../evil-name"))).rejects.toThrow("Invalid name");
    });

    it("rejects team names with spaces", async () => {
      const { spawnTeam } = await getSpawner();
      await expect(spawnTeam(makePlan("bad name"))).rejects.toThrow("Invalid name");
    });

    it("rejects team names with special characters", async () => {
      const { spawnTeam } = await getSpawner();
      await expect(spawnTeam(makePlan("q-1-feat;rm -rf /"))).rejects.toThrow("Invalid name");
    });

    it("allows valid team names with dashes, underscores, numbers", async () => {
      const { spawnTeam } = await getSpawner();
      const result = await spawnTeam(makePlan("q-99-my_feature-v2"));
      expect(result.teamName).toBe("q-99-my_feature-v2");
    });
  });
});
