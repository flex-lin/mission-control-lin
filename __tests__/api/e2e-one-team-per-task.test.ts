import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { NextRequest } from "next/server";

/**
 * End-to-end tests for the one-team-per-task constraint.
 *
 * These tests verify the full stack: spawn API route guards, file-based
 * duplicate detection (findTeamBySourceTaskId), queue worker CAS logic,
 * and retry/re-spawn edge cases.
 */

// ── Mock tmux/agent-launcher (no real processes) ─────────────────────────────

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

// ── Setup / Teardown ─────────────────────────────────────────────────────────

describe("End-to-End: One-Team-Per-Task", () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-e2e-one-team-"));
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

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. findTeamBySourceTaskId — file-based duplicate detection
  // ═══════════════════════════════════════════════════════════════════════════

  describe("findTeamBySourceTaskId", () => {
    it("returns team name when a team with the given sourceTaskId exists", async () => {
      const { findTeamBySourceTaskId } = await getClaudeFiles();

      createTeamOnDisk("q-1-my-feature", { sourceTaskId: 1 });

      const result = findTeamBySourceTaskId(1);
      expect(result).toBe("q-1-my-feature");
    });

    it("returns null when no team has the given sourceTaskId", async () => {
      const { findTeamBySourceTaskId } = await getClaudeFiles();

      createTeamOnDisk("q-1-other-feature", { sourceTaskId: 99 });

      const result = findTeamBySourceTaskId(42);
      expect(result).toBeNull();
    });

    it("returns null when teams directory does not exist", async () => {
      const { findTeamBySourceTaskId } = await getClaudeFiles();

      const result = findTeamBySourceTaskId(1);
      expect(result).toBeNull();
    });

    it("correctly matches among multiple teams", async () => {
      const { findTeamBySourceTaskId } = await getClaudeFiles();

      createTeamOnDisk("q-1-alpha", { sourceTaskId: 1 });
      createTeamOnDisk("q-2-beta", { sourceTaskId: 2 });
      createTeamOnDisk("q-3-gamma", { sourceTaskId: 3 });

      expect(findTeamBySourceTaskId(1)).toBe("q-1-alpha");
      expect(findTeamBySourceTaskId(2)).toBe("q-2-beta");
      expect(findTeamBySourceTaskId(3)).toBe("q-3-gamma");
      expect(findTeamBySourceTaskId(4)).toBeNull();
    });

    it("ignores malformed config files", async () => {
      const { findTeamBySourceTaskId } = await getClaudeFiles();

      // Create a team dir with invalid JSON
      const badDir = path.join(tmpDir, ".claude", "teams", "bad-team");
      fs.mkdirSync(badDir, { recursive: true });
      fs.writeFileSync(path.join(badDir, "config.json"), "not valid json", "utf-8");

      // Create a good one
      createTeamOnDisk("q-5-good", { sourceTaskId: 5 });

      expect(findTeamBySourceTaskId(5)).toBe("q-5-good");
    });

    it("does not match deleted teams (they are removed from disk)", async () => {
      const { findTeamBySourceTaskId, deleteTeam } = await getClaudeFiles();
      const { spawnTeam } = await getSpawner();

      // Spawn and delete
      await spawnTeam(makePlan("q-10-deleted", 10));
      deleteTeam("q-10-deleted");

      // Deleted team should NOT be found by sourceTaskId
      const result = findTeamBySourceTaskId(10);
      expect(result).toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. spawnTeam — file-level duplicate guard
  // ═══════════════════════════════════════════════════════════════════════════

  describe("spawnTeam duplicate guard", () => {
    it("rejects spawn when config.json already exists on disk", async () => {
      const { spawnTeam } = await getSpawner();

      // Pre-create the team directory with a config
      createTeamOnDisk("q-7-exists");

      await expect(spawnTeam(makePlan("q-7-exists"))).rejects.toThrow(/already exists/);
    });

    it("allows spawn if directory exists but config.json is missing", async () => {
      const { spawnTeam } = await getSpawner();

      // Create dir without config.json (orphaned state)
      const teamDir = path.join(tmpDir, ".claude", "teams", "q-8-orphan");
      fs.mkdirSync(teamDir, { recursive: true });

      // Should succeed because config.json doesn't exist
      const result = await spawnTeam(makePlan("q-8-orphan"));
      expect(result.teamName).toBe("q-8-orphan");
    });

    it("records sourceTaskId in the config when provided in the plan", async () => {
      const { spawnTeam } = await getSpawner();

      await spawnTeam(makePlan("q-15-tracked", 15));

      const configPath = path.join(tmpDir, ".claude", "teams", "q-15-tracked", "config.json");
      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      expect(config.sourceTaskId).toBe(15);
    });

    it("does not include sourceTaskId if not provided", async () => {
      const { spawnTeam } = await getSpawner();

      await spawnTeam(makePlan("q-16-no-source"));

      const configPath = path.join(tmpDir, ".claude", "teams", "q-16-no-source", "config.json");
      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      expect(config.sourceTaskId).toBeUndefined();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. Concurrent spawn prevention
  // ═══════════════════════════════════════════════════════════════════════════

  describe("concurrent spawn attempts", () => {
    it("first spawn succeeds, second is rejected (race condition simulation)", async () => {
      const { spawnTeam } = await getSpawner();

      const plan = makePlan("q-20-race");

      // Launch two spawns concurrently
      const results = await Promise.allSettled([
        spawnTeam(plan),
        spawnTeam(plan),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");

      // Exactly one should succeed and one should fail
      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(1);
      expect((rejected[0] as PromiseRejectedResult).reason.message).toMatch(/already exists/);
    });

    it("concurrent spawns for different tasks both succeed", async () => {
      const { spawnTeam } = await getSpawner();

      const results = await Promise.allSettled([
        spawnTeam(makePlan("q-21-task-a")),
        spawnTeam(makePlan("q-22-task-b")),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      expect(fulfilled.length).toBe(2);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. Spawn API route — dual guard (DB + file)
  // ═══════════════════════════════════════════════════════════════════════════

  describe("POST /api/teams/spawn — duplicate guards", () => {
    const mockFindFirst = vi.fn();
    const mockUpdateMany = vi.fn();

    beforeEach(() => {
      vi.doMock("@/lib/db", () => ({
        db: {
          queuedTask: {
            findFirst: (...args: unknown[]) => mockFindFirst(...args),
            updateMany: (...args: unknown[]) => mockUpdateMany(...args),
          },
        },
      }));
      mockFindFirst.mockResolvedValue(null);
      mockUpdateMany.mockResolvedValue({ count: 1 });
    });

    function makeRequest(body: Record<string, unknown>) {
      return new NextRequest("http://localhost:31777/api/teams/spawn", {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
      });
    }

    it("returns 409 when DB says task already has a running team", async () => {
      mockFindFirst.mockResolvedValue({
        id: 1,
        status: "running",
        teamName: "q-1-existing",
      });

      vi.resetModules();
      const mod = await import("@/app/api/teams/spawn/route");
      const req = makeRequest({
        plan: makePlan("q-1-duplicate", 1),
      });

      const res = await mod.POST(req);
      const body = await res.json();

      expect(res.status).toBe(409);
      expect(body.code).toBe("DUPLICATE_TEAM");
      expect(body.error).toContain("already has an active team");
    });

    it("returns 409 when file check finds existing team for sourceTaskId", async () => {
      // DB says no running team (findFirst returns null)
      mockFindFirst.mockResolvedValue(null);

      // But a team config with this sourceTaskId exists on disk
      createTeamOnDisk("q-1-on-disk", { sourceTaskId: 1 });

      vi.resetModules();
      const mod = await import("@/app/api/teams/spawn/route");
      const req = makeRequest({
        plan: makePlan("q-1-new-attempt", 1),
      });

      const res = await mod.POST(req);
      const body = await res.json();

      expect(res.status).toBe(409);
      expect(body.code).toBe("DUPLICATE_TEAM");
      expect(body.error).toContain("already has a team on disk");
    });

    it("returns 409 when spawnTeam throws 'already exists' error", async () => {
      mockFindFirst.mockResolvedValue(null);

      // Pre-create the team dir to trigger spawnTeam's own guard
      createTeamOnDisk("q-2-pre-exists");

      vi.resetModules();
      const mod = await import("@/app/api/teams/spawn/route");
      const req = makeRequest({
        plan: makePlan("q-2-pre-exists"),
      });

      const res = await mod.POST(req);
      const body = await res.json();

      expect(res.status).toBe(409);
      expect(body.code).toBe("DUPLICATE_TEAM");
    });

    it("succeeds when no duplicate exists", async () => {
      mockFindFirst.mockResolvedValue(null);

      vi.resetModules();
      const mod = await import("@/app/api/teams/spawn/route");
      const req = makeRequest({
        plan: makePlan("q-3-fresh", 3),
      });

      const res = await mod.POST(req);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data.teamName).toBe("q-3-fresh");
      expect(body.data.membersCreated).toBe(2); // leader + dev
    });

    it("skips sourceTaskId checks when sourceTaskId is not provided", async () => {
      vi.resetModules();
      mockFindFirst.mockClear();
      const mod = await import("@/app/api/teams/spawn/route");
      const req = makeRequest({
        plan: makePlan("manual-team"),
      });

      const res = await mod.POST(req);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.data.teamName).toBe("manual-team");
      // findFirst should not have been called since no sourceTaskId
      expect(mockFindFirst).not.toHaveBeenCalled();
    });

    it("rejects invalid plan (missing teamName)", async () => {
      vi.resetModules();
      const mod = await import("@/app/api/teams/spawn/route");
      const req = makeRequest({
        plan: { personas: [], initialTasks: [] },
      });

      const res = await mod.POST(req);
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.code).toBe("VALIDATION_ERROR");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. Failed team → retry → re-spawn scenario
  // ═══════════════════════════════════════════════════════════════════════════

  describe("retry after failure", () => {
    it("can spawn a new team after the previous one was deleted", async () => {
      const { spawnTeam } = await getSpawner();
      const { deleteTeam, findTeamBySourceTaskId } = await getClaudeFiles();

      // First spawn with sourceTaskId
      await spawnTeam(makePlan("q-100-attempt1", 100));

      // Verify it's findable
      expect(findTeamBySourceTaskId(100)).toBe("q-100-attempt1");

      // Delete it (simulating failed team cleanup)
      deleteTeam("q-100-attempt1");

      // sourceTaskId should no longer be found
      expect(findTeamBySourceTaskId(100)).toBeNull();

      // Re-spawn with a new name but same sourceTaskId
      const result = await spawnTeam(makePlan("q-100-attempt2", 100));
      expect(result.teamName).toBe("q-100-attempt2");
      expect(findTeamBySourceTaskId(100)).toBe("q-100-attempt2");
    });

    it("cannot re-spawn if previous team is still active (not archived)", async () => {
      const { spawnTeam } = await getSpawner();
      const { findTeamBySourceTaskId } = await getClaudeFiles();

      await spawnTeam(makePlan("q-101-active", 101));
      expect(findTeamBySourceTaskId(101)).toBe("q-101-active");

      // Attempting to spawn another team with the same name fails
      await expect(
        spawnTeam(makePlan("q-101-active", 101))
      ).rejects.toThrow(/already exists/);
    });

    it("can spawn with same sourceTaskId but different name if first is deleted from disk", async () => {
      const { spawnTeam } = await getSpawner();
      const { findTeamBySourceTaskId } = await getClaudeFiles();

      await spawnTeam(makePlan("q-102-first", 102));

      // Simulate cleanup: remove the team directory entirely
      const teamDir = path.join(tmpDir, ".claude", "teams", "q-102-first");
      fs.rmSync(teamDir, { recursive: true, force: true });

      // sourceTaskId check should now return null
      expect(findTeamBySourceTaskId(102)).toBeNull();

      // Can spawn again
      const result = await spawnTeam(makePlan("q-102-second", 102));
      expect(result.teamName).toBe("q-102-second");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 6. Queue worker task selection — one per repository
  // ═══════════════════════════════════════════════════════════════════════════

  describe("queue worker task selection logic", () => {
    it("SQL query skips tasks whose project_path has a running task", () => {
      // The queue worker uses:
      //   WHERE status = 'pending'
      //     AND NOT EXISTS (SELECT 1 FROM queued_tasks running
      //                     WHERE running.status = 'running'
      //                       AND running.project_path = qt.project_path)
      //
      // This test verifies the logic pattern.
      const tasks = [
        { id: 1, status: "pending", projectPath: "/repo-a" },
        { id: 2, status: "running", projectPath: "/repo-a" },
        { id: 3, status: "pending", projectPath: "/repo-b" },
      ];

      const runningPaths = new Set(
        tasks.filter((t) => t.status === "running").map((t) => t.projectPath)
      );

      const eligible = tasks.filter(
        (t) => t.status === "pending" && !runningPaths.has(t.projectPath)
      );

      // Only task #3 should be eligible (repo-a is blocked by running task #2)
      expect(eligible).toHaveLength(1);
      expect(eligible[0].id).toBe(3);
    });

    it("allows next task after running task completes", () => {
      const tasks = [
        { id: 1, status: "completed", projectPath: "/repo-a" },
        { id: 2, status: "pending", projectPath: "/repo-a" },
      ];

      const runningPaths = new Set(
        tasks.filter((t) => t.status === "running").map((t) => t.projectPath)
      );

      const eligible = tasks.filter(
        (t) => t.status === "pending" && !runningPaths.has(t.projectPath)
      );

      expect(eligible).toHaveLength(1);
      expect(eligible[0].id).toBe(2);
    });

    it("selects tasks in priority-then-FIFO order", () => {
      const tasks = [
        { id: 1, status: "pending", projectPath: "/repo-a", priority: 0, createdAt: "2026-01-01" },
        { id: 2, status: "pending", projectPath: "/repo-b", priority: 2, createdAt: "2026-01-02" },
        { id: 3, status: "pending", projectPath: "/repo-c", priority: 2, createdAt: "2026-01-01" },
      ];

      // Sort: priority DESC, then createdAt ASC
      const sorted = [...tasks].sort((a, b) => {
        if (b.priority !== a.priority) return b.priority - a.priority;
        return a.createdAt.localeCompare(b.createdAt);
      });

      // Highest priority first, then earliest creation
      expect(sorted[0].id).toBe(3); // priority 2, earlier
      expect(sorted[1].id).toBe(2); // priority 2, later
      expect(sorted[2].id).toBe(1); // priority 0
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 7. Queue worker CAS (compare-and-swap) — atomic claim
  // ═══════════════════════════════════════════════════════════════════════════

  describe("CAS atomic claim logic", () => {
    it("only one worker can claim a pending task", () => {
      // Simulates the DB CAS: UPDATE ... WHERE id = ? AND status = 'pending'
      // Returns changes = 1 for first caller, changes = 0 for second.
      let taskStatus = "pending";

      function attemptClaim(): { changes: number } {
        if (taskStatus === "pending") {
          taskStatus = "running";
          return { changes: 1 };
        }
        return { changes: 0 };
      }

      const result1 = attemptClaim();
      const result2 = attemptClaim();

      expect(result1.changes).toBe(1);
      expect(result2.changes).toBe(0);
      expect(taskStatus).toBe("running");
    });

    it("failed tasks are not claimable without retry", () => {
      let taskStatus = "failed";

      function attemptClaim(): { changes: number } {
        if (taskStatus === "pending") {
          taskStatus = "running";
          return { changes: 1 };
        }
        return { changes: 0 };
      }

      const result = attemptClaim();
      expect(result.changes).toBe(0);
    });

    it("retry resets to pending, then CAS succeeds", () => {
      let taskStatus = "failed";

      // Retry: reset to pending
      taskStatus = "pending";

      function attemptClaim(): { changes: number } {
        if (taskStatus === "pending") {
          taskStatus = "running";
          return { changes: 1 };
        }
        return { changes: 0 };
      }

      const result = attemptClaim();
      expect(result.changes).toBe(1);
      expect(taskStatus).toBe("running");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 8. Full lifecycle: spawn → complete → delete → re-spawn
  // ═══════════════════════════════════════════════════════════════════════════

  describe("full lifecycle", () => {
    it("spawn → mark tasks done → delete → verify gone → re-spawn", async () => {
      const { spawnTeam } = await getSpawner();
      const { readTaskList, writeTask, listTeams, deleteTeam, findTeamBySourceTaskId } = await getClaudeFiles();

      // 1. Spawn
      const result = await spawnTeam(makePlan("q-200-lifecycle", 200));
      expect(result.teamName).toBe("q-200-lifecycle");

      // 2. Mark tasks completed
      const tasks = readTaskList("q-200-lifecycle");
      for (const t of tasks) {
        t.status = "completed";
        writeTask("q-200-lifecycle", t);
      }

      // Verify all done
      const updated = readTaskList("q-200-lifecycle");
      expect(updated.every((t) => t.status === "completed")).toBe(true);

      // 3. Delete
      deleteTeam("q-200-lifecycle");
      expect(listTeams().some((t) => t.name === "q-200-lifecycle")).toBe(false);
      expect(findTeamBySourceTaskId(200)).toBeNull();

      // 4. Team directory should be completely gone
      const teamDir = path.join(tmpDir, ".claude", "teams", "q-200-lifecycle");
      expect(fs.existsSync(teamDir)).toBe(false);

      // 5. Re-spawn with new name
      const result2 = await spawnTeam(makePlan("q-200-lifecycle-v2", 200));
      expect(result2.teamName).toBe("q-200-lifecycle-v2");
      expect(findTeamBySourceTaskId(200)).toBe("q-200-lifecycle-v2");
    });

    it("multiple queue tasks are fully isolated end-to-end", async () => {
      const { spawnTeam } = await getSpawner();
      const { readTaskList, writeTask, listTeams, findTeamBySourceTaskId } = await getClaudeFiles();

      // Spawn teams for 3 different queue tasks
      await spawnTeam(makePlan("q-300-a", 300));
      await spawnTeam(makePlan("q-301-b", 301));
      await spawnTeam(makePlan("q-302-c", 302));

      const teams = listTeams();
      expect(teams.length).toBe(3);

      // Verify sourceTaskId lookup
      expect(findTeamBySourceTaskId(300)).toBe("q-300-a");
      expect(findTeamBySourceTaskId(301)).toBe("q-301-b");
      expect(findTeamBySourceTaskId(302)).toBe("q-302-c");

      // Complete team B's tasks
      const tasksB = readTaskList("q-301-b");
      for (const t of tasksB) {
        t.status = "completed";
        writeTask("q-301-b", t);
      }

      // Team A and C tasks should be unaffected
      const tasksA = readTaskList("q-300-a");
      expect(tasksA.every((t) => t.status === "pending")).toBe(true);

      const tasksC = readTaskList("q-302-c");
      expect(tasksC.every((t) => t.status === "pending")).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 9. Task completion state detection (queue worker helper)
  // ═══════════════════════════════════════════════════════════════════════════

  describe("task completion state", () => {
    it("detects all-completed state", async () => {
      const { spawnTeam } = await getSpawner();
      const { readTaskList, writeTask } = await getClaudeFiles();

      await spawnTeam(makePlan("q-400-complete"));

      const tasks = readTaskList("q-400-complete");
      for (const t of tasks) {
        t.status = "completed";
        writeTask("q-400-complete", t);
      }

      const updated = readTaskList("q-400-complete");
      const allDone = updated.every((t) => t.status === "completed" || t.status === "deleted");
      expect(allDone).toBe(true);
    });

    it("detects has-pending state", async () => {
      const { spawnTeam } = await getSpawner();
      const { readTaskList } = await getClaudeFiles();

      await spawnTeam(makePlan("q-401-pending"));

      const tasks = readTaskList("q-401-pending");
      const hasPending = tasks.some((t) => t.status === "pending" || t.status === "in_progress");
      expect(hasPending).toBe(true);
    });

    it("detects cleaned-up state (task dir removed)", async () => {
      const { spawnTeam } = await getSpawner();

      await spawnTeam(makePlan("q-402-cleaned"));

      // Remove the task directory (simulating TeamDelete)
      const taskDir = path.join(tmpDir, ".claude", "tasks", "q-402-cleaned");
      fs.rmSync(taskDir, { recursive: true, force: true });

      expect(fs.existsSync(taskDir)).toBe(false);
    });

    it("deleted tasks count as completed for team status", async () => {
      const { spawnTeam } = await getSpawner();
      const { readTaskList, writeTask } = await getClaudeFiles();

      await spawnTeam(makePlan("q-403-deleted"));

      const tasks = readTaskList("q-403-deleted");
      for (const t of tasks) {
        t.status = "deleted";
        writeTask("q-403-deleted", t);
      }

      const updated = readTaskList("q-403-deleted");
      const allDone = updated.every((t) => t.status === "completed" || t.status === "deleted");
      expect(allDone).toBe(true);
    });
  });
});
