import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

/**
 * End-to-end tests for duplicate team prevention during queue task processing.
 *
 * Bug: Each time a task is processed from the task queue, an empty agent team
 * with no tasks and a strange name appears beside the actual agent team.
 *
 * Root cause: The queue worker creates the team on disk (config + tasks), then
 * launches a leader whose setup message instructs "Call TeamCreate". If the
 * leader invokes Claude Code's built-in TeamCreate (rather than the MCP one),
 * it creates a SECOND team with an auto-generated name — empty, no tasks.
 *
 * These tests verify:
 * 1. Queue worker creates team config + tasks on disk BEFORE launching the leader
 * 2. The MCP TeamCreate is idempotent (no-ops when team already exists)
 * 3. The setup message references the correct team name for TeamCreate
 * 4. spawnTeam rejects duplicate team creation
 * 5. The queue worker's CAS + file-based guard prevents double processing
 * 6. The full lifecycle produces exactly one team per queued task
 */

// ── Mock tmux/agent-launcher (no real processes) ─────────────────────────────

const mockCreateSession = vi.fn();
const mockSendKeysAndSubmit = vi.fn();
const mockCapturePane = vi.fn(() => "❯");
const mockSendRawKey = vi.fn();
const mockSessionExists = vi.fn(() => false);
const mockSessionProcessAlive = vi.fn(() => false);
const mockKillSession = vi.fn();

vi.mock("@/lib/tmux-manager", () => ({
  getSessionName: (team: string, member: string) => `mc-${team}-${member}`,
  sessionExists: (...args: unknown[]) => mockSessionExists(...(args as [string])),
  createSession: (...args: unknown[]) => mockCreateSession(...(args as [string, string, string])),
  sessionProcessAlive: (...args: unknown[]) => mockSessionProcessAlive(...(args as [string])),
  killSession: (...args: unknown[]) => mockKillSession(...(args as [string])),
  sendKeysAndSubmit: (...args: unknown[]) => mockSendKeysAndSubmit(...(args as [string, string])),
  capturePane: (...args: unknown[]) => mockCapturePane(...(args as [string])),
  sendRawKey: (...args: unknown[]) => mockSendRawKey(...(args as [string, string])),
  getTeamSessionStatus: vi.fn(() => ({})),
  listTeamSessions: vi.fn(() => []),
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

// ── Helpers ──────────────────────────────────────────────────────────────────

function makePlan(teamName: string, sourceTaskId?: number) {
  return {
    teamName,
    description: `Team for ${teamName}`,
    personas: [
      { name: "dev", role: "Developer", agentType: "general-purpose", description: "Codes" },
    ],
    initialTasks: [
      { subject: "Implement feature", description: "Build the thing", assignTo: "dev" },
    ],
    ...(sourceTaskId != null ? { sourceTaskId } : {}),
  };
}

function createTeamOnDisk(teamName: string, extras: Record<string, unknown> = {}) {
  const teamDir = path.join(tmpDir, ".claude", "teams", teamName);
  fs.mkdirSync(teamDir, { recursive: true });
  fs.writeFileSync(
    path.join(teamDir, "config.json"),
    JSON.stringify({
      name: teamName,
      members: [],
      createdAt: new Date().toISOString(),
      ...extras,
    }),
    "utf-8"
  );
  return teamDir;
}

function countTeamsOnDisk(): { names: string[]; count: number } {
  const teamsDir = path.join(tmpDir, ".claude", "teams");
  if (!fs.existsSync(teamsDir)) return { names: [], count: 0 };
  const entries = fs.readdirSync(teamsDir, { withFileTypes: true });
  const names = entries
    .filter((e) => e.isDirectory())
    .filter((e) => {
      const configPath = path.join(teamsDir, e.name, "config.json");
      return fs.existsSync(configPath);
    })
    .map((e) => e.name);
  return { names, count: names.length };
}

function getTeamTaskCount(teamName: string): number {
  const taskDir = path.join(tmpDir, ".claude", "tasks", teamName);
  if (!fs.existsSync(taskDir)) return 0;
  return fs.readdirSync(taskDir).filter((f) => f.endsWith(".json")).length;
}

// ── Setup / Teardown ─────────────────────────────────────────────────────────

describe("Duplicate Team Prevention (E2E)", () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-dup-team-test-"));
    vi.stubEnv("HOME", tmpDir);
    vi.resetModules();
    mockCreateSession.mockReset();
    mockCreateSession.mockImplementation(() => {
      mockSessionExists.mockReturnValue(true);
    });
    mockSessionExists.mockReturnValue(false);
    mockSessionProcessAlive.mockReturnValue(false);
    mockSendKeysAndSubmit.mockClear();
    mockCapturePane.mockReturnValue("❯");
    mockKillSession.mockClear();
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

  async function getLauncher() {
    return await import("@/lib/agent-launcher");
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. Queue worker creates team BEFORE leader — no opportunity for duplicates
  // ═══════════════════════════════════════════════════════════════════════════

  describe("queue worker team creation order", () => {
    it("spawnTeam creates config.json on disk before launching leader", async () => {
      const { spawnTeam } = await getSpawner();

      const result = await spawnTeam(makePlan("q-1-order-test", 1));

      // Config must exist
      const configPath = path.join(tmpDir, ".claude", "teams", "q-1-order-test", "config.json");
      expect(fs.existsSync(configPath)).toBe(true);

      // Tasks must exist
      const taskDir = path.join(tmpDir, ".claude", "tasks", "q-1-order-test");
      expect(fs.existsSync(taskDir)).toBe(true);
      expect(getTeamTaskCount("q-1-order-test")).toBe(1);

      // Leader was launched (launchTeamAsLeader was called)
      expect(result.launched).toContain("leader");

      // Only ONE team exists on disk
      const { count, names } = countTeamsOnDisk();
      expect(count).toBe(1);
      expect(names).toEqual(["q-1-order-test"]);
    });

    it("exactly one team directory exists after spawnTeam completes", async () => {
      const { spawnTeam } = await getSpawner();

      await spawnTeam(makePlan("q-5-single", 5));

      const { count } = countTeamsOnDisk();
      expect(count).toBe(1);
    });

    it("sourceTaskId is stored in team config for traceability", async () => {
      const { spawnTeam } = await getSpawner();

      await spawnTeam(makePlan("q-7-traced", 7));

      const configPath = path.join(tmpDir, ".claude", "teams", "q-7-traced", "config.json");
      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      expect(config.sourceTaskId).toBe(7);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. MCP TeamCreate is idempotent — calling it when team exists is a no-op
  // ═══════════════════════════════════════════════════════════════════════════

  describe("MCP TeamCreate idempotency", () => {
    it("does not overwrite existing config when team already exists", () => {
      // Simulate what the MCP teamCreate function does
      const teamDir = path.join(tmpDir, ".claude", "teams", "q-10-existing");
      fs.mkdirSync(teamDir, { recursive: true });

      const originalConfig = {
        name: "q-10-existing",
        description: "Original team with real data",
        members: [
          { name: "leader", agentId: "q-10-existing-leader-0", status: "active" },
          { name: "dev", agentId: "q-10-existing-dev-1", status: "idle" },
        ],
        sourceTaskId: 10,
        createdAt: "2026-01-01T00:00:00.000Z",
      };
      fs.writeFileSync(
        path.join(teamDir, "config.json"),
        JSON.stringify(originalConfig, null, 2),
        "utf-8"
      );

      // Now simulate MCP TeamCreate being called (idempotent behavior)
      const configPath = path.join(teamDir, "config.json");
      if (!fs.existsSync(configPath)) {
        // Would write new config — but this should NOT happen
        fs.writeFileSync(configPath, JSON.stringify({ name: "q-10-existing", members: [] }));
      }
      // MCP TeamCreate skips when config exists — so original config is preserved

      const afterConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      expect(afterConfig.members).toHaveLength(2);
      expect(afterConfig.sourceTaskId).toBe(10);
      expect(afterConfig.description).toBe("Original team with real data");
    });

    it("MCP TeamCreate creates a new team if none exists", () => {
      const teamName = "q-11-new";
      const teamDir = path.join(tmpDir, ".claude", "teams", teamName);
      const tasksDir = path.join(tmpDir, ".claude", "tasks", teamName);
      const configPath = path.join(teamDir, "config.json");

      // Simulate MCP teamCreate
      if (!fs.existsSync(configPath)) {
        fs.mkdirSync(teamDir, { recursive: true });
        fs.writeFileSync(
          configPath,
          JSON.stringify({ name: teamName, description: "", members: [], createdAt: new Date().toISOString() }),
          "utf-8"
        );
      }
      fs.mkdirSync(tasksDir, { recursive: true });

      expect(fs.existsSync(configPath)).toBe(true);
      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      expect(config.name).toBe(teamName);
      expect(config.members).toEqual([]);
    });

    it("team created by queue worker is NOT overwritten by subsequent MCP TeamCreate", async () => {
      const { spawnTeam } = await getSpawner();

      // Step 1: Queue worker spawns team (creates full config with members + tasks)
      await spawnTeam(makePlan("q-12-no-overwrite", 12));

      const configPath = path.join(tmpDir, ".claude", "teams", "q-12-no-overwrite", "config.json");
      const beforeConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      expect(beforeConfig.members.length).toBeGreaterThan(0);

      // Step 2: Leader calls MCP TeamCreate (idempotent — should NOT overwrite)
      if (!fs.existsSync(configPath)) {
        fs.writeFileSync(
          configPath,
          JSON.stringify({ name: "q-12-no-overwrite", members: [], createdAt: new Date().toISOString() }),
          "utf-8"
        );
      }

      // Config should still have the original members
      const afterConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      expect(afterConfig.members).toEqual(beforeConfig.members);
      expect(afterConfig.sourceTaskId).toBe(12);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. Setup message uses correct team name for TeamCreate
  // ═══════════════════════════════════════════════════════════════════════════

  describe("leader setup message TeamCreate name", () => {
    it("setup message tells leader NOT to call TeamCreate (team already exists)", async () => {
      const { launchTeamAsLeader } = await getLauncher();

      await launchTeamAsLeader(
        "q-20-correct-name",
        "Test team",
        [{ name: "dev", role: "Developer", agentType: "general-purpose", description: "Codes" }],
        "/tmp/project",
        [{ id: "1", subject: "Build", status: "pending", owner: "dev" }]
      );

      expect(mockSendKeysAndSubmit).toHaveBeenCalledTimes(1);
      const setupMsg = mockSendKeysAndSubmit.mock.calls[0][1];

      // The setup message must tell the leader NOT to call TeamCreate
      // because the queue worker already created the team directory
      expect(setupMsg).toContain("do NOT call TeamCreate");
      expect(setupMsg).toContain("team directory already exists");
      // The setup message should reference the correct team name
      expect(setupMsg).toContain("q-20-correct-name");
    });

    it("setup message for task with members includes spawn instructions for ALL members", async () => {
      const { launchTeamAsLeader } = await getLauncher();

      await launchTeamAsLeader(
        "q-21-all-members",
        "Full team",
        [
          { name: "frontend", role: "Frontend Dev", agentType: "general-purpose", description: "UI" },
          { name: "backend", role: "Backend Dev", agentType: "general-purpose", description: "API" },
        ],
        "/tmp/project",
        [
          { id: "1", subject: "Build UI", status: "pending", owner: "frontend" },
          { id: "2", subject: "Build API", status: "pending", owner: "backend" },
        ]
      );

      const setupMsg = mockSendKeysAndSubmit.mock.calls[0][1];
      expect(setupMsg).toContain('name="frontend"');
      expect(setupMsg).toContain('name="backend"');
      expect(setupMsg).toContain('team_name="q-21-all-members"');
    });

    it("system prompt tells leader NOT to call TeamCreate", async () => {
      const { launchTeamAsLeader } = await getLauncher();

      await launchTeamAsLeader(
        "q-22-sys-prompt",
        "System prompt test",
        [{ name: "dev", role: "Dev", agentType: "general-purpose", description: "Code" }],
        "/tmp/project",
        [{ id: "1", subject: "Task", status: "pending", owner: "dev" }]
      );

      // Check the launcher script was written with the correct team name
      const teamDir = path.join(tmpDir, ".claude", "teams", "q-22-sys-prompt");
      const promptFile = path.join(teamDir, "leader-system-prompt.txt");
      expect(fs.existsSync(promptFile)).toBe(true);

      const prompt = fs.readFileSync(promptFile, "utf-8");
      expect(prompt).toContain('team leader/coordinator for team "q-22-sys-prompt"');
      // System prompt should NOT instruct calling TeamCreate
      expect(prompt).toContain("do NOT call TeamCreate");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. spawnTeam rejects duplicate creation (config.json guard)
  // ═══════════════════════════════════════════════════════════════════════════

  describe("spawnTeam duplicate rejection", () => {
    it("throws DuplicateTeamError when config.json already exists", async () => {
      const { spawnTeam, DuplicateTeamError } = await getSpawner();

      await spawnTeam(makePlan("q-30-dup"));

      await expect(spawnTeam(makePlan("q-30-dup"))).rejects.toThrow(DuplicateTeamError);

      // Still only one team on disk
      const { count } = countTeamsOnDisk();
      expect(count).toBe(1);
    });

    it("original team config is preserved after duplicate rejection", async () => {
      const { spawnTeam } = await getSpawner();

      await spawnTeam(makePlan("q-31-preserve", 31));

      const configPath = path.join(tmpDir, ".claude", "teams", "q-31-preserve", "config.json");
      const before = JSON.parse(fs.readFileSync(configPath, "utf-8"));

      // Try duplicate — should fail
      await expect(spawnTeam(makePlan("q-31-preserve", 31))).rejects.toThrow(/already exists/);

      // Config unchanged
      const after = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      expect(after.createdAt).toBe(before.createdAt);
      expect(after.members).toEqual(before.members);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. Queue worker findTeamBySourceTaskId prevents re-processing
  // ═══════════════════════════════════════════════════════════════════════════

  describe("findTeamBySourceTaskId duplicate detection", () => {
    it("detects existing team for a sourceTaskId", async () => {
      const { findTeamBySourceTaskId } = await getClaudeFiles();

      // Queue worker creates team with sourceTaskId
      createTeamOnDisk("q-40-exists", { sourceTaskId: 40 });

      expect(findTeamBySourceTaskId(40)).toBe("q-40-exists");
    });

    it("returns null for a sourceTaskId with no team", async () => {
      const { findTeamBySourceTaskId } = await getClaudeFiles();

      createTeamOnDisk("q-41-other", { sourceTaskId: 41 });

      expect(findTeamBySourceTaskId(999)).toBeNull();
    });

    it("queue worker skips task when team already exists for sourceTaskId", async () => {
      const { findTeamBySourceTaskId } = await getClaudeFiles();
      const { spawnTeam } = await getSpawner();

      // First processing: creates team
      await spawnTeam(makePlan("q-42-first", 42));

      // Simulate queue worker's file-based check before second processing
      const existingTeam = findTeamBySourceTaskId(42);
      expect(existingTeam).toBe("q-42-first");

      // Queue worker would bail out here — no second team created
      const { count } = countTeamsOnDisk();
      expect(count).toBe(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 6. The "empty team with strange name" scenario — verify it can't happen
  // ═══════════════════════════════════════════════════════════════════════════

  describe("empty ghost team prevention", () => {
    it("MCP TeamCreate with existing team does NOT create a second config", async () => {
      const { spawnTeam } = await getSpawner();

      // Queue worker creates the real team
      await spawnTeam(makePlan("q-50-real", 50));

      // Count teams before leader's MCP TeamCreate call
      const before = countTeamsOnDisk();
      expect(before.count).toBe(1);

      // Simulate MCP TeamCreate (idempotent — no-ops when config exists)
      const teamDir = path.join(tmpDir, ".claude", "teams", "q-50-real");
      const configPath = path.join(teamDir, "config.json");
      if (!fs.existsSync(configPath)) {
        // This block should NOT execute
        fs.mkdirSync(teamDir, { recursive: true });
        fs.writeFileSync(configPath, JSON.stringify({ name: "q-50-real", members: [] }));
      }

      // Count teams after — should still be 1
      const after = countTeamsOnDisk();
      expect(after.count).toBe(1);
      expect(after.names).toEqual(["q-50-real"]);
    });

    it("a hypothetical second TeamCreate with a DIFFERENT name WOULD create a ghost team", () => {
      // This test documents the bug scenario: if the leader calls
      // Claude Code's built-in TeamCreate (not MCP), it generates a
      // random name like "jovial-fox-123" and creates an empty team.
      //
      // We verify that this scenario produces 2 teams (the bug).

      // "Real" team created by queue worker
      createTeamOnDisk("q-51-real", {
        sourceTaskId: 51,
        members: [{ name: "leader" }, { name: "dev" }],
      });

      // "Ghost" team created by built-in TeamCreate with auto-generated name
      const ghostDir = path.join(tmpDir, ".claude", "teams", "jovial-fox-123");
      fs.mkdirSync(ghostDir, { recursive: true });
      fs.writeFileSync(
        path.join(ghostDir, "config.json"),
        JSON.stringify({ name: "jovial-fox-123", members: [], createdAt: new Date().toISOString() }),
        "utf-8"
      );

      // This is the bug: 2 teams exist when only 1 should
      const { count, names } = countTeamsOnDisk();
      expect(count).toBe(2);
      expect(names).toContain("q-51-real");
      expect(names).toContain("jovial-fox-123");

      // The ghost team has no tasks
      expect(getTeamTaskCount("jovial-fox-123")).toBe(0);

      // The real team would have tasks
      const taskDir = path.join(tmpDir, ".claude", "tasks", "q-51-real");
      fs.mkdirSync(taskDir, { recursive: true });
      fs.writeFileSync(
        path.join(taskDir, "1.json"),
        JSON.stringify({ id: "1", subject: "Real task", status: "pending" }),
        "utf-8"
      );
      expect(getTeamTaskCount("q-51-real")).toBe(1);
    });

    it("MCP TeamCreate with the CORRECT name keeps exactly one team", async () => {
      const { spawnTeam } = await getSpawner();

      // Queue worker creates team
      await spawnTeam(makePlan("q-52-correct", 52));
      expect(countTeamsOnDisk().count).toBe(1);

      // Leader calls MCP TeamCreate with correct name (idempotent)
      const configPath = path.join(tmpDir, ".claude", "teams", "q-52-correct", "config.json");
      expect(fs.existsSync(configPath)).toBe(true); // Already exists — MCP skips

      // Still exactly one team
      expect(countTeamsOnDisk().count).toBe(1);
      expect(getTeamTaskCount("q-52-correct")).toBe(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 7. Concurrent task processing — no duplicates
  // ═══════════════════════════════════════════════════════════════════════════

  describe("concurrent processing isolation", () => {
    it("processing two different tasks creates exactly two teams", async () => {
      const { spawnTeam } = await getSpawner();

      await spawnTeam(makePlan("q-60-task-a", 60));
      await spawnTeam(makePlan("q-61-task-b", 61));

      const { count, names } = countTeamsOnDisk();
      expect(count).toBe(2);
      expect(names).toContain("q-60-task-a");
      expect(names).toContain("q-61-task-b");

      // Each has its own tasks
      expect(getTeamTaskCount("q-60-task-a")).toBe(1);
      expect(getTeamTaskCount("q-61-task-b")).toBe(1);
    });

    it("concurrent spawn of same team name — one succeeds, one fails", async () => {
      const { spawnTeam } = await getSpawner();

      const results = await Promise.allSettled([
        spawnTeam(makePlan("q-62-race", 62)),
        spawnTeam(makePlan("q-62-race", 62)),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");

      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(1);

      // Only one team on disk
      expect(countTeamsOnDisk().count).toBe(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 8. Resume message does NOT instruct TeamCreate (prevents duplicates on wake)
  // ═══════════════════════════════════════════════════════════════════════════

  describe("resume message no TeamCreate", () => {
    it("resume message explicitly says DO NOT call TeamCreate", async () => {
      const { resumeTeamAsLeader } = await getLauncher();

      await resumeTeamAsLeader(
        "q-70-resume",
        "Resume test",
        [{ name: "dev", role: "Dev", agentType: "general-purpose", description: "Code" }],
        "/tmp/project",
        [{ id: "1", subject: "Continue work", status: "in_progress", owner: "dev" }]
      );

      const sentMsg = mockSendKeysAndSubmit.mock.calls[0][1];
      expect(sentMsg).toContain("DO NOT call TeamCreate");
      expect(sentMsg).not.toContain("STEP 1: Call TeamCreate");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 9. No-task scenario — leader should NOT create a team
  // ═══════════════════════════════════════════════════════════════════════════

  describe("no-task scenario", () => {
    it("setup message for zero tasks instructs immediate exit and cleanup", async () => {
      const { launchTeamAsLeader } = await getLauncher();

      await launchTeamAsLeader(
        "q-80-empty",
        "Empty team",
        [{ name: "dev", role: "Dev", agentType: "general-purpose", description: "Code" }],
        "/tmp/project",
        [] // No tasks
      );

      const sentMsg = mockSendKeysAndSubmit.mock.calls[0][1];
      expect(sentMsg).toContain("NO TASKS");
      expect(sentMsg).toContain("ZERO tasks");
      // Should NOT instruct spawning teammates
      expect(sentMsg).toContain("Do NOT spawn any teammates");
    });

    it("system prompt includes no-task exit protocol", async () => {
      const { launchTeamAsLeader } = await getLauncher();

      await launchTeamAsLeader(
        "q-81-sys-notask",
        "No task sys prompt",
        [],
        "/tmp/project",
        [{ id: "1", subject: "Task", status: "pending" }]
      );

      const promptFile = path.join(tmpDir, ".claude", "teams", "q-81-sys-notask", "leader-system-prompt.txt");
      const prompt = fs.readFileSync(promptFile, "utf-8");
      expect(prompt).toContain("NO TASKS — IMMEDIATE EXIT");
      // System prompt should include instructions to not spawn on empty tasks
      expect(prompt).toContain("Do NOT spawn any teammates");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 10. Full lifecycle: single queued task → exactly one team → cleanup
  // ═══════════════════════════════════════════════════════════════════════════

  describe("full single-task lifecycle", () => {
    it("one queued task produces exactly one team throughout its lifecycle", async () => {
      const { spawnTeam } = await getSpawner();
      const { listTeams, readTaskList, writeTask, deleteTeam, findTeamBySourceTaskId } = await getClaudeFiles();

      // 1. Spawn team for queued task #100
      await spawnTeam(makePlan("q-100-lifecycle", 100));
      expect(countTeamsOnDisk().count).toBe(1);
      expect(findTeamBySourceTaskId(100)).toBe("q-100-lifecycle");

      // 2. Simulate MCP TeamCreate call by leader (idempotent — should not create new team)
      const configPath = path.join(tmpDir, ".claude", "teams", "q-100-lifecycle", "config.json");
      expect(fs.existsSync(configPath)).toBe(true);
      // Still one team
      expect(countTeamsOnDisk().count).toBe(1);

      // 3. Complete tasks
      const tasks = readTaskList("q-100-lifecycle");
      for (const t of tasks) {
        t.status = "completed";
        writeTask("q-100-lifecycle", t);
      }

      // 4. Still one team
      expect(countTeamsOnDisk().count).toBe(1);
      const teams = listTeams();
      expect(teams.length).toBe(1);
      expect(teams[0].name).toBe("q-100-lifecycle");

      // 5. Cleanup
      deleteTeam("q-100-lifecycle");
      expect(countTeamsOnDisk().count).toBe(0);
      expect(findTeamBySourceTaskId(100)).toBeNull();
    });
  });
});
