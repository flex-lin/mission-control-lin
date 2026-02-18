import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import {
  readTeamConfig,
  readTaskList,
  writeTask,
  getTeamLastActivity,
  listTeams,
} from "../lib/claude-files";

const CLAUDE_DIR = path.join(process.env.HOME ?? "/root", ".claude");
const TEST_TEAM = "__test-team-claude-files__";

function cleanupTestTeam() {
  const teamDir = path.join(CLAUDE_DIR, "teams", TEST_TEAM);
  const taskDir = path.join(CLAUDE_DIR, "tasks", TEST_TEAM);
  fs.rmSync(teamDir, { recursive: true, force: true });
  fs.rmSync(taskDir, { recursive: true, force: true });
}

beforeEach(() => {
  cleanupTestTeam();
});

afterEach(() => {
  cleanupTestTeam();
});

describe("readTeamConfig", () => {
  it("returns null for non-existent team", () => {
    const result = readTeamConfig(TEST_TEAM);
    expect(result).toBeNull();
  });

  it("reads a valid team config with all members", () => {
    const teamDir = path.join(CLAUDE_DIR, "teams", TEST_TEAM);
    fs.mkdirSync(teamDir, { recursive: true });
    const config = {
      name: TEST_TEAM,
      description: "Test team",
      members: [
        { name: "leader", agentId: `${TEST_TEAM}-leader-0`, agentType: "general-purpose", status: "active" },
        { name: "analyst", agentId: `${TEST_TEAM}-analyst-0`, agentType: "Explore", status: "idle" },
        { name: "coder", agentId: `${TEST_TEAM}-coder-1`, agentType: "general-purpose", status: "idle" },
      ],
      createdAt: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(teamDir, "config.json"), JSON.stringify(config), "utf-8");

    const result = readTeamConfig(TEST_TEAM);
    expect(result).not.toBeNull();
    expect(result!.name).toBe(TEST_TEAM);
    expect(result!.members).toHaveLength(3);
    expect(result!.members[0].name).toBe("leader");
    expect(result!.members[1].name).toBe("analyst");
    expect(result!.members[2].name).toBe("coder");
  });

  it("returns members with correct status values", () => {
    const teamDir = path.join(CLAUDE_DIR, "teams", TEST_TEAM);
    fs.mkdirSync(teamDir, { recursive: true });
    const config = {
      name: TEST_TEAM,
      members: [
        { name: "leader", agentId: "id-0", agentType: "general-purpose", status: "active" },
        { name: "worker", agentId: "id-1", agentType: "general-purpose", status: "idle" },
      ],
    };
    fs.writeFileSync(path.join(teamDir, "config.json"), JSON.stringify(config), "utf-8");

    const result = readTeamConfig(TEST_TEAM);
    expect(result!.members[0].status).toBe("active");
    expect(result!.members[1].status).toBe("idle");
  });

  it("rejects team names with path traversal characters", () => {
    expect(() => readTeamConfig("../etc")).toThrow();
    expect(() => readTeamConfig("foo/bar")).toThrow();
    expect(() => readTeamConfig("foo..bar")).toThrow();
  });
});

describe("readTaskList", () => {
  it("returns empty array for non-existent team tasks", () => {
    const result = readTaskList(TEST_TEAM);
    expect(result).toEqual([]);
  });

  it("reads tasks from disk", () => {
    const taskDir = path.join(CLAUDE_DIR, "tasks", TEST_TEAM);
    fs.mkdirSync(taskDir, { recursive: true });

    const task1 = { id: "1", subject: "Analyze code", status: "pending", owner: "analyst" };
    const task2 = { id: "2", subject: "Implement fix", status: "in_progress", owner: "coder" };
    const task3 = { id: "3", subject: "Run tests", status: "completed", owner: "tester" };

    fs.writeFileSync(path.join(taskDir, "1.json"), JSON.stringify(task1), "utf-8");
    fs.writeFileSync(path.join(taskDir, "2.json"), JSON.stringify(task2), "utf-8");
    fs.writeFileSync(path.join(taskDir, "3.json"), JSON.stringify(task3), "utf-8");

    const result = readTaskList(TEST_TEAM);
    expect(result).toHaveLength(3);

    const subjects = result.map((t) => t.subject).sort();
    expect(subjects).toEqual(["Analyze code", "Implement fix", "Run tests"]);
  });

  it("skips non-JSON files", () => {
    const taskDir = path.join(CLAUDE_DIR, "tasks", TEST_TEAM);
    fs.mkdirSync(taskDir, { recursive: true });

    fs.writeFileSync(path.join(taskDir, "1.json"), JSON.stringify({ id: "1", subject: "Task", status: "pending" }), "utf-8");
    fs.writeFileSync(path.join(taskDir, "README.md"), "not a task", "utf-8");

    const result = readTaskList(TEST_TEAM);
    expect(result).toHaveLength(1);
  });
});

describe("writeTask", () => {
  it("writes a task file to disk", () => {
    const taskDir = path.join(CLAUDE_DIR, "tasks", TEST_TEAM);
    fs.mkdirSync(taskDir, { recursive: true });

    const task = { id: "42", subject: "Test task", status: "pending" as const };
    writeTask(TEST_TEAM, task);

    const filePath = path.join(taskDir, "42.json");
    expect(fs.existsSync(filePath)).toBe(true);

    const written = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    expect(written.id).toBe("42");
    expect(written.subject).toBe("Test task");
  });
});

describe("getTeamLastActivity", () => {
  it("returns null for non-existent team", () => {
    const result = getTeamLastActivity(TEST_TEAM);
    expect(result).toBeNull();
  });

  it("returns an ISO timestamp when tasks exist", () => {
    const taskDir = path.join(CLAUDE_DIR, "tasks", TEST_TEAM);
    fs.mkdirSync(taskDir, { recursive: true });
    fs.writeFileSync(path.join(taskDir, "1.json"), JSON.stringify({ id: "1", subject: "t", status: "pending" }), "utf-8");

    const result = getTeamLastActivity(TEST_TEAM);
    expect(result).not.toBeNull();
    // Should be a valid ISO date string
    expect(new Date(result!).getTime()).not.toBeNaN();
  });

  it("returns the most recent mtime", async () => {
    const taskDir = path.join(CLAUDE_DIR, "tasks", TEST_TEAM);
    fs.mkdirSync(taskDir, { recursive: true });

    fs.writeFileSync(path.join(taskDir, "1.json"), JSON.stringify({ id: "1", subject: "old", status: "pending" }), "utf-8");

    // Wait briefly to ensure different mtime
    await new Promise((r) => setTimeout(r, 50));

    fs.writeFileSync(path.join(taskDir, "2.json"), JSON.stringify({ id: "2", subject: "new", status: "pending" }), "utf-8");

    const result = getTeamLastActivity(TEST_TEAM);
    const file2Stat = fs.statSync(path.join(taskDir, "2.json"));
    // The result should match the newer file's mtime
    expect(new Date(result!).getTime()).toBeCloseTo(file2Stat.mtimeMs, -2);
  });
});

describe("listTeams", () => {
  it("includes the test team in the list", () => {
    const teamDir = path.join(CLAUDE_DIR, "teams", TEST_TEAM);
    fs.mkdirSync(teamDir, { recursive: true });
    const config = {
      name: TEST_TEAM,
      members: [{ name: "leader", agentId: "id-0", agentType: "general-purpose" }],
    };
    fs.writeFileSync(path.join(teamDir, "config.json"), JSON.stringify(config), "utf-8");

    const teams = listTeams();
    const found = teams.find((t) => t.name === TEST_TEAM);
    expect(found).toBeDefined();
    expect(found!.members).toHaveLength(1);
  });
});
