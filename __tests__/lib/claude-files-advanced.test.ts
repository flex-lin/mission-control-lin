import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

/**
 * Advanced tests for claude-files.ts — covers findInternalTeamName,
 * archiveTeam, symlinkInternalTaskDir, listProjects, readProjectContext.
 */

let tmpDir: string;

describe("claude-files advanced", () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-cf-adv-"));
    vi.stubEnv("HOME", tmpDir);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  async function getModule() {
    vi.resetModules();
    return await import("@/lib/claude-files");
  }

  // ── archiveTeam ──────────────────────────────────────────────────────────

  describe("archiveTeam", () => {
    it("moves team to archive directory", async () => {
      const mod = await getModule();
      const teamDir = path.join(tmpDir, ".claude", "teams", "arch-team");
      fs.mkdirSync(teamDir, { recursive: true });
      fs.writeFileSync(
        path.join(teamDir, "config.json"),
        JSON.stringify({ name: "arch-team", members: [] })
      );

      mod.archiveTeam("arch-team");

      // Original should be gone
      expect(fs.existsSync(teamDir)).toBe(false);

      // Archive should exist
      const archivePath = path.join(tmpDir, ".claude", "teams-archive", "arch-team", "config.json");
      expect(fs.existsSync(archivePath)).toBe(true);

      const archived = JSON.parse(fs.readFileSync(archivePath, "utf-8"));
      expect(archived.archivedAt).toBeDefined();
    });

    it("archives tasks alongside team config", async () => {
      const mod = await getModule();
      const teamDir = path.join(tmpDir, ".claude", "teams", "task-arch");
      const taskDir = path.join(tmpDir, ".claude", "tasks", "task-arch");
      fs.mkdirSync(teamDir, { recursive: true });
      fs.mkdirSync(taskDir, { recursive: true });
      fs.writeFileSync(
        path.join(teamDir, "config.json"),
        JSON.stringify({ name: "task-arch", members: [] })
      );
      fs.writeFileSync(
        path.join(taskDir, "1.json"),
        JSON.stringify({ id: "1", subject: "Task", status: "completed" })
      );

      mod.archiveTeam("task-arch");

      expect(fs.existsSync(taskDir)).toBe(false);
      const archivedTaskPath = path.join(tmpDir, ".claude", "tasks-archive", "task-arch", "1.json");
      expect(fs.existsSync(archivedTaskPath)).toBe(true);
    });

    it("throws when team does not exist", async () => {
      const mod = await getModule();
      expect(() => mod.archiveTeam("nonexistent")).toThrow("not found");
    });

    it("overwrites existing archive", async () => {
      const mod = await getModule();

      // Create archive first
      const archiveDir = path.join(tmpDir, ".claude", "teams-archive", "dup-team");
      fs.mkdirSync(archiveDir, { recursive: true });
      fs.writeFileSync(
        path.join(archiveDir, "config.json"),
        JSON.stringify({ name: "dup-team", old: true })
      );

      // Create active team
      const teamDir = path.join(tmpDir, ".claude", "teams", "dup-team");
      fs.mkdirSync(teamDir, { recursive: true });
      fs.writeFileSync(
        path.join(teamDir, "config.json"),
        JSON.stringify({ name: "dup-team", members: [], old: false })
      );

      mod.archiveTeam("dup-team");

      const archived = JSON.parse(
        fs.readFileSync(path.join(archiveDir, "config.json"), "utf-8")
      );
      expect(archived.old).toBe(false);
      expect(archived.archivedAt).toBeDefined();
    });
  });

  // ── findInternalTeamName ─────────────────────────────────────────────────

  describe("findInternalTeamName", () => {
    function setupMcTeam(name: string, createdAt: string, projectPath?: string, tasks?: Array<{ id: string; subject: string }>) {
      const teamDir = path.join(tmpDir, ".claude", "teams", name);
      fs.mkdirSync(teamDir, { recursive: true });
      fs.writeFileSync(
        path.join(teamDir, "config.json"),
        JSON.stringify({ name, createdAt, projectPath })
      );

      if (tasks) {
        const taskDir = path.join(tmpDir, ".claude", "tasks", name);
        fs.mkdirSync(taskDir, { recursive: true });
        for (const t of tasks) {
          fs.writeFileSync(
            path.join(taskDir, `${t.id}.json`),
            JSON.stringify({ id: t.id, subject: t.subject, status: "pending" })
          );
        }
      }
    }

    it("returns null when MC team does not exist", async () => {
      const mod = await getModule();
      expect(mod.findInternalTeamName("nonexistent")).toBeNull();
    });

    it("matches by projectPath and creation time", async () => {
      const mod = await getModule();
      const now = new Date().toISOString();

      setupMcTeam("q-1-my-team", now, "/home/user/project");
      setupMcTeam("woolly-forging-eich", now, "/home/user/project");

      const result = mod.findInternalTeamName("q-1-my-team");
      expect(result).toBe("woolly-forging-eich");
    });

    it("matches by task subject overlap", async () => {
      const mod = await getModule();
      const now = new Date().toISOString();

      setupMcTeam("q-2-api-team", now, undefined, [
        { id: "1", subject: "Build REST API" },
        { id: "2", subject: "Write tests" },
      ]);
      setupMcTeam("internal-team", now, undefined, [
        { id: "1", subject: "Build REST API" },
        { id: "2", subject: "Write tests" },
      ]);

      const result = mod.findInternalTeamName("q-2-api-team");
      expect(result).toBe("internal-team");
    });

    it("returns null when no matching team is found", async () => {
      const mod = await getModule();
      const now = new Date().toISOString();
      const past = new Date(Date.now() - 20 * 60 * 1000).toISOString(); // 20 min ago

      setupMcTeam("q-3-lonely", now, "/path/a");
      setupMcTeam("unrelated", past, "/path/b"); // too far apart in time

      const result = mod.findInternalTeamName("q-3-lonely");
      expect(result).toBeNull();
    });

    it("skips other q- prefixed teams", async () => {
      const mod = await getModule();
      const now = new Date().toISOString();

      setupMcTeam("q-4-team-a", now, "/home/user/proj");
      setupMcTeam("q-5-team-b", now, "/home/user/proj"); // another MC team

      const result = mod.findInternalTeamName("q-4-team-a");
      // Should not match q-5-team-b because it's also an MC team
      expect(result).toBeNull();
    });

    it("skips default team", async () => {
      const mod = await getModule();
      const now = new Date().toISOString();

      setupMcTeam("q-6-my-team", now, "/path");
      setupMcTeam("default", now, "/path");

      const result = mod.findInternalTeamName("q-6-my-team");
      expect(result).toBeNull();
    });

    it("handles numeric timestamps from Claude Code", async () => {
      const mod = await getModule();
      const nowMs = Date.now();

      // MC uses ISO string
      setupMcTeam("q-7-team", new Date(nowMs).toISOString(), "/proj");

      // Internal team uses numeric timestamp
      const internalDir = path.join(tmpDir, ".claude", "teams", "internal-numeric");
      fs.mkdirSync(internalDir, { recursive: true });
      fs.writeFileSync(
        path.join(internalDir, "config.json"),
        JSON.stringify({ name: "internal-numeric", createdAt: nowMs, projectPath: "/proj" })
      );

      const result = mod.findInternalTeamName("q-7-team");
      expect(result).toBe("internal-numeric");
    });
  });

  // ── readTaskList with symlink ────────────────────────────────────────────

  describe("readTaskList symlink behavior", () => {
    it("reads tasks from task directory", async () => {
      const mod = await getModule();
      mod.writeTask("symlink-test", {
        id: "1",
        subject: "Test task",
        status: "pending",
      });

      const tasks = mod.readTaskList("symlink-test");
      expect(tasks).toHaveLength(1);
      expect(tasks[0].subject).toBe("Test task");
    });

    it("returns empty for nonexistent team", async () => {
      const mod = await getModule();
      expect(mod.readTaskList("ghost-team")).toEqual([]);
    });
  });

  // ── listProjects ─────────────────────────────────────────────────────────

  describe("listProjects", () => {
    it("returns empty when projects dir does not exist", async () => {
      const mod = await getModule();
      expect(mod.listProjects()).toEqual([]);
    });

    it("reads project directories", async () => {
      const projDir = path.join(tmpDir, ".claude", "projects", "-home-user-myapp");
      fs.mkdirSync(projDir, { recursive: true });

      const mod = await getModule();
      const projects = mod.listProjects();
      expect(projects).toHaveLength(1);
      expect(projects[0].id).toBe("-home-user-myapp");
      expect(projects[0].path).toBe("/home/user/myapp");
    });
  });

  // ── readProjectContext ──────────────────────────────────────────────────

  describe("readProjectContext", () => {
    it("reads CLAUDE.md from project directory", async () => {
      const projDir = path.join(tmpDir, ".claude", "projects", "-home-user-proj");
      fs.mkdirSync(projDir, { recursive: true });
      fs.writeFileSync(path.join(projDir, "CLAUDE.md"), "# My Project");

      const mod = await getModule();
      const ctx = mod.readProjectContext("-home-user-proj");
      expect(ctx.claudeMd).toBe("# My Project");
    });

    it("reads memory files from memory subdirectory", async () => {
      const projDir = path.join(tmpDir, ".claude", "projects", "-home-user-proj2");
      const memDir = path.join(projDir, "memory");
      fs.mkdirSync(memDir, { recursive: true });
      fs.writeFileSync(path.join(memDir, "patterns.md"), "pattern content");
      fs.writeFileSync(path.join(memDir, "debugging.md"), "debug content");

      const mod = await getModule();
      const ctx = mod.readProjectContext("-home-user-proj2");
      expect(ctx.memoryFiles["patterns.md"]).toBe("pattern content");
      expect(ctx.memoryFiles["debugging.md"]).toBe("debug content");
    });

    it("returns empty context when project has no files", async () => {
      const projDir = path.join(tmpDir, ".claude", "projects", "-home-user-empty");
      fs.mkdirSync(projDir, { recursive: true });

      const mod = await getModule();
      const ctx = mod.readProjectContext("-home-user-empty");
      expect(ctx.claudeMd).toBeUndefined();
      expect(ctx.memoryFiles).toEqual({});
    });
  });

  // ── member reconciliation edge cases ─────────────────────────────────────

  describe("member reconciliation edge cases", () => {
    it("handles multiple spawned members matching same base name", async () => {
      const teamDir = path.join(tmpDir, ".claude", "teams", "multi-spawn");
      fs.mkdirSync(teamDir, { recursive: true });
      fs.writeFileSync(
        path.join(teamDir, "config.json"),
        JSON.stringify({
          name: "multi-spawn",
          members: [
            { name: "dev", agentId: "placeholder", agentType: "general-purpose" },
            { name: "dev-2", agentId: "spawned1", agentType: "general-purpose", joinedAt: "2026-01-01" },
            { name: "dev-3", agentId: "spawned2", agentType: "general-purpose", joinedAt: "2026-01-01" },
          ],
        })
      );

      const mod = await getModule();
      const team = mod.readTeamConfig("multi-spawn");
      expect(team).not.toBeNull();
      // First spawned member replaces placeholder, second keeps its name
      expect(team!.members.some((m) => m.name === "dev")).toBe(true);
    });

    it("preserves isActive → active status mapping", async () => {
      const teamDir = path.join(tmpDir, ".claude", "teams", "active-team");
      fs.mkdirSync(teamDir, { recursive: true });
      fs.writeFileSync(
        path.join(teamDir, "config.json"),
        JSON.stringify({
          name: "active-team",
          members: [
            { name: "worker", agentId: "p1", agentType: "dev" },
            { name: "worker-2", agentId: "s1", agentType: "dev", joinedAt: "2026-01-01", isActive: true },
          ],
        })
      );

      const mod = await getModule();
      const team = mod.readTeamConfig("active-team");
      // Spawned member with isActive=true should have status "active"
      const worker = team!.members.find((m) => m.name === "worker");
      expect(worker?.status).toBe("active");
    });

    it("maps isActive=false to offline status", async () => {
      const teamDir = path.join(tmpDir, ".claude", "teams", "offline-team");
      fs.mkdirSync(teamDir, { recursive: true });
      fs.writeFileSync(
        path.join(teamDir, "config.json"),
        JSON.stringify({
          name: "offline-team",
          members: [
            { name: "worker", agentId: "p1", agentType: "dev" },
            { name: "worker-2", agentId: "s1", agentType: "dev", joinedAt: "2026-01-01", isActive: false },
          ],
        })
      );

      const mod = await getModule();
      const team = mod.readTeamConfig("offline-team");
      const worker = team!.members.find((m) => m.name === "worker");
      expect(worker?.status).toBe("offline");
    });
  });
});
