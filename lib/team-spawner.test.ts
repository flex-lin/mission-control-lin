import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";

// Mock agent-launcher before importing team-spawner
vi.mock("@/lib/agent-launcher", () => ({
  getLeaderSessionName: (teamName: string) => `mc-${teamName}-leader`,
  personaToLaunchable: (p: { name: string; role: string; agentType: string; description: string }) => ({
    name: p.name,
    role: p.role,
    agentType: p.agentType,
    description: p.description,
  }),
  launchTeamAsLeader: vi.fn().mockResolvedValue({
    launched: true,
    sessionName: "mc-test-team-leader",
  }),
}));

import { spawnTeam } from "./team-spawner";
import type { TeamPlan } from "@/types";

const CLAUDE_DIR = path.join(process.env.HOME ?? "/root", ".claude");

function makePlan(overrides: Partial<TeamPlan> = {}): TeamPlan {
  return {
    teamName: "test-team",
    description: "A test team",
    personas: [
      { name: "dev", role: "Developer", agentType: "general-purpose", description: "Writes code" },
    ],
    initialTasks: [
      { subject: "Do something", description: "Task description", assignTo: "dev" },
    ],
    ...overrides,
  };
}

describe("spawnTeam", () => {
  const testTeamDir = path.join(CLAUDE_DIR, "teams", "test-team");
  const testTaskDir = path.join(CLAUDE_DIR, "tasks", "test-team");

  afterEach(() => {
    // Cleanup test dirs
    try { fs.rmSync(testTeamDir, { recursive: true, force: true }); } catch { /* ok */ }
    try { fs.rmSync(testTaskDir, { recursive: true, force: true }); } catch { /* ok */ }
  });

  it("creates team config directory and file", async () => {
    const result = await spawnTeam(makePlan());
    const configPath = path.join(testTeamDir, "config.json");
    expect(fs.existsSync(configPath)).toBe(true);

    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    expect(config.name).toBe("test-team");
    expect(config.description).toBe("A test team");
    expect(config.members).toBeDefined();
    expect(config.createdAt).toBeDefined();
  });

  it("creates leader + persona members in config", async () => {
    await spawnTeam(makePlan());
    const config = JSON.parse(
      fs.readFileSync(path.join(testTeamDir, "config.json"), "utf-8")
    );
    // Leader + 1 persona = 2 members
    expect(config.members.length).toBe(2);
    expect(config.members[0].name).toBe("leader");
    expect(config.members[1].name).toBe("dev");
  });

  it("creates task files on disk", async () => {
    await spawnTeam(makePlan());
    const taskFile = path.join(testTaskDir, "1.json");
    expect(fs.existsSync(taskFile)).toBe(true);

    const task = JSON.parse(fs.readFileSync(taskFile, "utf-8"));
    expect(task.id).toBe("1");
    expect(task.subject).toBe("Do something");
    expect(task.status).toBe("pending");
    expect(task.owner).toBe("dev");
  });

  it("returns correct SpawnResult shape", async () => {
    const result = await spawnTeam(makePlan());
    expect(result.teamName).toBe("test-team");
    expect(result.membersCreated).toBe(2);
    expect(result.tasksCreated).toBe(1);
    expect(result.launched).toEqual(["leader"]);
    expect(result.sessions.length).toBe(1);
    expect(result.sessions[0].name).toBe("leader");
    expect(result.sessions[0].attachCmd).toContain("tmux attach");
  });

  it("saves projectPath to config when provided", async () => {
    await spawnTeam(makePlan(), "/home/user/project");
    const config = JSON.parse(
      fs.readFileSync(path.join(testTeamDir, "config.json"), "utf-8")
    );
    expect(config.projectPath).toBe("/home/user/project");
  });

  it("handles multiple personas and tasks", async () => {
    const plan = makePlan({
      personas: [
        { name: "frontend", role: "Frontend Dev", agentType: "general-purpose", description: "UI" },
        { name: "backend", role: "Backend Dev", agentType: "general-purpose", description: "API" },
        { name: "tester", role: "QA", agentType: "Bash", description: "Tests" },
      ],
      initialTasks: [
        { subject: "Task 1", description: "First" },
        { subject: "Task 2", description: "Second", assignTo: "backend" },
        { subject: "Task 3", description: "Third", assignTo: "tester" },
      ],
    });
    const result = await spawnTeam(plan);
    expect(result.membersCreated).toBe(4); // leader + 3
    expect(result.tasksCreated).toBe(3);
  });

  // ── Name validation (safeName) ──────────────────────────────────────────

  it("rejects team names with path traversal", async () => {
    await expect(
      spawnTeam(makePlan({ teamName: "../evil" }))
    ).rejects.toThrow(/Invalid name/);
  });

  it("rejects team names with slashes", async () => {
    await expect(
      spawnTeam(makePlan({ teamName: "foo/bar" }))
    ).rejects.toThrow(/Invalid name/);
  });

  it("rejects team names with dots", async () => {
    await expect(
      spawnTeam(makePlan({ teamName: "foo.bar" }))
    ).rejects.toThrow(/Invalid name/);
  });

  it("rejects team names with spaces", async () => {
    await expect(
      spawnTeam(makePlan({ teamName: "foo bar" }))
    ).rejects.toThrow(/Invalid name/);
  });

  it("accepts valid kebab-case team names", async () => {
    const plan = makePlan({ teamName: "my-valid-team-123" });
    const result = await spawnTeam(plan);
    expect(result.teamName).toBe("my-valid-team-123");
    // Cleanup
    try {
      fs.rmSync(path.join(CLAUDE_DIR, "teams", "my-valid-team-123"), { recursive: true, force: true });
      fs.rmSync(path.join(CLAUDE_DIR, "tasks", "my-valid-team-123"), { recursive: true, force: true });
    } catch { /* ok */ }
  });

  it("accepts underscores in team names", async () => {
    const plan = makePlan({ teamName: "my_team" });
    const result = await spawnTeam(plan);
    expect(result.teamName).toBe("my_team");
    // Cleanup
    try {
      fs.rmSync(path.join(CLAUDE_DIR, "teams", "my_team"), { recursive: true, force: true });
      fs.rmSync(path.join(CLAUDE_DIR, "tasks", "my_team"), { recursive: true, force: true });
    } catch { /* ok */ }
  });
});
