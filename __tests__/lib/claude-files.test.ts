import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

// We need to mock HOME to use a temp directory so tests don't touch real ~/.claude
let tmpDir: string;

describe("claude-files", () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-test-"));
    // Set HOME so claude-files resolves paths under our temp dir
    vi.stubEnv("HOME", tmpDir);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // Dynamically import after HOME is stubbed
  async function getModule() {
    // Clear module cache so it re-reads HOME
    vi.resetModules();
    return await import("@/lib/claude-files");
  }

  describe("safeName validation", () => {
    it("rejects names with path traversal", async () => {
      const mod = await getModule();
      expect(() => mod.readTeamConfig("../etc")).toThrow("Invalid name");
    });

    it("rejects names with dots", async () => {
      const mod = await getModule();
      expect(() => mod.readTeamConfig("foo.bar")).toThrow("Invalid name");
    });

    it("rejects names with slashes", async () => {
      const mod = await getModule();
      expect(() => mod.readTeamConfig("foo/bar")).toThrow("Invalid name");
    });

    it("accepts valid alphanumeric names with dashes and underscores", async () => {
      const mod = await getModule();
      // Should not throw, just return null (team doesn't exist)
      expect(mod.readTeamConfig("my-team_123")).toBeNull();
    });
  });

  describe("listTeams", () => {
    it("returns empty array when no teams dir exists", async () => {
      const mod = await getModule();
      expect(mod.listTeams()).toEqual([]);
    });

    it("reads team configs from directories", async () => {
      const teamsDir = path.join(tmpDir, ".claude", "teams", "test-team");
      fs.mkdirSync(teamsDir, { recursive: true });
      fs.writeFileSync(
        path.join(teamsDir, "config.json"),
        JSON.stringify({
          name: "test-team",
          members: [
            { name: "leader", agentId: "abc123", agentType: "team-lead" },
          ],
          description: "A test team",
        })
      );

      const mod = await getModule();
      const teams = mod.listTeams();
      expect(teams).toHaveLength(1);
      expect(teams[0].name).toBe("test-team");
      expect(teams[0].members).toHaveLength(1);
      expect(teams[0].members[0].name).toBe("leader");
    });

    it("skips malformed config files", async () => {
      const teamsDir = path.join(tmpDir, ".claude", "teams", "bad-team");
      fs.mkdirSync(teamsDir, { recursive: true });
      fs.writeFileSync(path.join(teamsDir, "config.json"), "not json{{{");

      const mod = await getModule();
      const teams = mod.listTeams();
      expect(teams).toEqual([]);
    });
  });

  describe("readTaskList / writeTask", () => {
    it("returns empty array when no tasks exist", async () => {
      const mod = await getModule();
      expect(mod.readTaskList("nonexistent")).toEqual([]);
    });

    it("writes and reads tasks", async () => {
      const mod = await getModule();
      const task = {
        id: "1",
        subject: "Test task",
        description: "Do the thing",
        status: "pending" as const,
        owner: "leader",
      };

      mod.writeTask("my-team", task);
      const tasks = mod.readTaskList("my-team");
      expect(tasks).toHaveLength(1);
      expect(tasks[0].subject).toBe("Test task");
      expect(tasks[0].status).toBe("pending");
    });

    it("reads multiple tasks", async () => {
      const mod = await getModule();
      mod.writeTask("my-team", {
        id: "1",
        subject: "First",
        status: "pending",
      });
      mod.writeTask("my-team", {
        id: "2",
        subject: "Second",
        status: "in_progress",
      });

      const tasks = mod.readTaskList("my-team");
      expect(tasks).toHaveLength(2);
    });
  });

  describe("readSettings / writeSettings", () => {
    it("returns empty object when no settings file", async () => {
      const mod = await getModule();
      expect(mod.readSettings()).toEqual({});
    });

    it("writes and reads settings", async () => {
      const mod = await getModule();
      mod.writeSettings({ theme: "dark", refreshInterval: 5000 });
      const settings = mod.readSettings();
      expect(settings.theme).toBe("dark");
      expect(settings.refreshInterval).toBe(5000);
    });
  });

  describe("member reconciliation", () => {
    it("reconciles spawned members with placeholders", async () => {
      const teamsDir = path.join(tmpDir, ".claude", "teams", "recon-team");
      fs.mkdirSync(teamsDir, { recursive: true });
      fs.writeFileSync(
        path.join(teamsDir, "config.json"),
        JSON.stringify({
          name: "recon-team",
          members: [
            { name: "analyst", agentId: "placeholder1", agentType: "researcher" },
            { name: "analyst-2", agentId: "real1", agentType: "researcher", joinedAt: "2026-01-01" },
          ],
        })
      );

      const mod = await getModule();
      const team = mod.readTeamConfig("recon-team");
      expect(team).not.toBeNull();
      // Placeholder "analyst" should be replaced by spawned "analyst-2" renamed to "analyst"
      expect(team!.members).toHaveLength(1);
      expect(team!.members[0].name).toBe("analyst");
      expect(team!.members[0].agentId).toBe("real1");
    });

    it("preserves members that don't need reconciliation", async () => {
      const teamsDir = path.join(tmpDir, ".claude", "teams", "no-recon");
      fs.mkdirSync(teamsDir, { recursive: true });
      fs.writeFileSync(
        path.join(teamsDir, "config.json"),
        JSON.stringify({
          name: "no-recon",
          members: [
            { name: "leader", agentId: "abc", agentType: "lead" },
            { name: "worker", agentId: "def", agentType: "dev" },
          ],
        })
      );

      const mod = await getModule();
      const team = mod.readTeamConfig("no-recon");
      expect(team!.members).toHaveLength(2);
      expect(team!.members[0].name).toBe("leader");
      expect(team!.members[1].name).toBe("worker");
    });
  });

  describe("readTeamPlan", () => {
    it("returns null when no plan file exists", async () => {
      const mod = await getModule();
      expect(mod.readTeamPlan("nonexistent-team")).toBeNull();
    });

    it("reads a valid plan.json file", async () => {
      const teamsDir = path.join(tmpDir, ".claude", "teams", "plan-team");
      fs.mkdirSync(teamsDir, { recursive: true });
      const plan = {
        teamName: "plan-team",
        description: "A planned team",
        personas: [
          { name: "dev", role: "Developer", agentType: "general-purpose", description: "Writes code" },
        ],
        initialTasks: [
          { subject: "Build feature", description: "Build it", assignTo: "dev" },
        ],
      };
      fs.writeFileSync(path.join(teamsDir, "plan.json"), JSON.stringify(plan));

      const mod = await getModule();
      const result = mod.readTeamPlan("plan-team");
      expect(result).not.toBeNull();
      expect(result!.teamName).toBe("plan-team");
      expect(result!.description).toBe("A planned team");
      expect(result!.personas).toHaveLength(1);
      expect(result!.personas[0].name).toBe("dev");
      expect(result!.initialTasks).toHaveLength(1);
      expect(result!.initialTasks[0].subject).toBe("Build feature");
    });

    it("returns null for malformed plan.json", async () => {
      const teamsDir = path.join(tmpDir, ".claude", "teams", "bad-plan");
      fs.mkdirSync(teamsDir, { recursive: true });
      fs.writeFileSync(path.join(teamsDir, "plan.json"), "not valid json{{{");

      const mod = await getModule();
      expect(mod.readTeamPlan("bad-plan")).toBeNull();
    });

    it("rejects team names with path traversal", async () => {
      const mod = await getModule();
      expect(() => mod.readTeamPlan("../etc")).toThrow("Invalid name");
    });
  });

  describe("getTeamLastActivity", () => {
    it("returns null when no tasks exist", async () => {
      const mod = await getModule();
      expect(mod.getTeamLastActivity("nonexistent")).toBeNull();
    });

    it("returns the most recent task modification time", async () => {
      const mod = await getModule();
      mod.writeTask("activity-team", {
        id: "1",
        subject: "Old task",
        status: "completed",
      });

      // Small delay to ensure different mtimes
      await new Promise((r) => setTimeout(r, 50));

      mod.writeTask("activity-team", {
        id: "2",
        subject: "New task",
        status: "pending",
      });

      const lastActivity = mod.getTeamLastActivity("activity-team");
      expect(lastActivity).not.toBeNull();
      // Should be a valid ISO date string
      expect(new Date(lastActivity!).getTime()).toBeGreaterThan(0);
    });
  });
});
