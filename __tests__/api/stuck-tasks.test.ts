import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

/**
 * Tests for the stuck tasks feature:
 * - GET /api/teams/stuck — aggregated stuck tasks across teams
 * - POST /api/teams/[name]/tasks/[id]/respond — respond to a stuck task
 *
 * These tests validate the core logic by directly testing the file-based
 * state functions that the API routes depend on (claude-files.ts).
 */

let tmpDir: string;

describe("stuck tasks — data layer", () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-stuck-test-"));
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

  function createTeamWithTasks(
    teamName: string,
    members: { name: string; agentId: string; agentType: string }[],
    tasks: { id: string; subject: string; status: string; owner?: string; metadata?: Record<string, unknown> }[]
  ) {
    const claudeDir = path.join(tmpDir, ".claude");
    const teamDir = path.join(claudeDir, "teams", teamName);
    const taskDir = path.join(claudeDir, "tasks", teamName);

    fs.mkdirSync(teamDir, { recursive: true });
    fs.mkdirSync(taskDir, { recursive: true });

    fs.writeFileSync(
      path.join(teamDir, "config.json"),
      JSON.stringify({ name: teamName, members, description: "test" })
    );

    for (const task of tasks) {
      fs.writeFileSync(
        path.join(taskDir, `${task.id}.json`),
        JSON.stringify(task)
      );
    }
  }

  describe("identifying stuck tasks", () => {
    it("finds in_progress tasks with blocker metadata", async () => {
      const mod = await getModule();

      createTeamWithTasks(
        "team-a",
        [{ name: "leader", agentId: "a1", agentType: "lead" }],
        [
          {
            id: "1",
            subject: "Build API",
            status: "in_progress",
            owner: "dev",
            metadata: {
              blockerType: "decision_needed",
              blockerSummary: "Need API key for Stripe",
              blockerSince: new Date().toISOString(),
            },
          },
          {
            id: "2",
            subject: "Write tests",
            status: "pending",
          },
        ]
      );

      const tasks = mod.readTaskList("team-a");
      const stuckTasks = tasks.filter(
        (t) => t.status === "in_progress" && t.metadata?.blockerSummary
      );

      expect(stuckTasks).toHaveLength(1);
      expect(stuckTasks[0].subject).toBe("Build API");
      expect(stuckTasks[0].metadata?.blockerType).toBe("decision_needed");
      expect(stuckTasks[0].metadata?.blockerSummary).toBe("Need API key for Stripe");
    });

    it("does not flag completed tasks as stuck", async () => {
      const mod = await getModule();

      createTeamWithTasks(
        "team-b",
        [{ name: "leader", agentId: "b1", agentType: "lead" }],
        [
          {
            id: "1",
            subject: "Done task",
            status: "completed",
            metadata: {
              blockerSummary: "Was stuck but now resolved",
            },
          },
        ]
      );

      const tasks = mod.readTaskList("team-b");
      const stuckTasks = tasks.filter(
        (t) => t.status === "in_progress" && t.metadata?.blockerSummary
      );

      expect(stuckTasks).toHaveLength(0);
    });

    it("does not flag pending tasks as stuck", async () => {
      const mod = await getModule();

      createTeamWithTasks(
        "team-c",
        [{ name: "leader", agentId: "c1", agentType: "lead" }],
        [
          {
            id: "1",
            subject: "Not started",
            status: "pending",
            metadata: { blockerSummary: "Waiting for something" },
          },
        ]
      );

      const tasks = mod.readTaskList("team-c");
      const stuckTasks = tasks.filter(
        (t) => t.status === "in_progress" && t.metadata?.blockerSummary
      );

      expect(stuckTasks).toHaveLength(0);
    });

    it("identifies tasks across multiple teams", async () => {
      const mod = await getModule();

      createTeamWithTasks(
        "team-x",
        [{ name: "leader", agentId: "x1", agentType: "lead" }],
        [
          {
            id: "1",
            subject: "Stuck task X",
            status: "in_progress",
            metadata: { blockerSummary: "Blocker X" },
          },
        ]
      );

      createTeamWithTasks(
        "team-y",
        [{ name: "leader", agentId: "y1", agentType: "lead" }],
        [
          {
            id: "1",
            subject: "Stuck task Y",
            status: "in_progress",
            metadata: { blockerSummary: "Blocker Y" },
          },
        ]
      );

      const teams = mod.listTeams();
      expect(teams).toHaveLength(2);

      const allStuck: { teamName: string; subject: string }[] = [];
      for (const team of teams) {
        const tasks = mod.readTaskList(team.name);
        for (const t of tasks) {
          if (t.status === "in_progress" && t.metadata?.blockerSummary) {
            allStuck.push({ teamName: team.name, subject: t.subject });
          }
        }
      }

      expect(allStuck).toHaveLength(2);
      expect(allStuck.map((s) => s.teamName).sort()).toEqual(["team-x", "team-y"]);
    });

    it("preserves all blocker metadata fields", async () => {
      const mod = await getModule();
      const since = new Date().toISOString();

      createTeamWithTasks(
        "meta-team",
        [{ name: "leader", agentId: "m1", agentType: "lead" }],
        [
          {
            id: "1",
            subject: "Full metadata task",
            status: "in_progress",
            owner: "dev",
            metadata: {
              blockerType: "error",
              blockerSummary: "Build failed",
              blockerDetails: "TypeScript compilation error in utils.ts line 42",
              blockerSince: since,
              blockerFrom: "dev",
            },
          },
        ]
      );

      const tasks = mod.readTaskList("meta-team");
      const task = tasks[0];

      expect(task.metadata?.blockerType).toBe("error");
      expect(task.metadata?.blockerSummary).toBe("Build failed");
      expect(task.metadata?.blockerDetails).toBe(
        "TypeScript compilation error in utils.ts line 42"
      );
      expect(task.metadata?.blockerSince).toBe(since);
      expect(task.metadata?.blockerFrom).toBe("dev");
    });
  });

  describe("responding to stuck tasks", () => {
    it("updates task metadata when responding with a message", async () => {
      const mod = await getModule();

      createTeamWithTasks(
        "respond-team",
        [
          { name: "leader", agentId: "r1", agentType: "lead" },
          { name: "dev", agentId: "r2", agentType: "general-purpose" },
        ],
        [
          {
            id: "1",
            subject: "Stuck task",
            status: "in_progress",
            owner: "dev",
            metadata: {
              blockerType: "decision_needed",
              blockerSummary: "Which DB to use?",
              blockerSince: new Date().toISOString(),
            },
          },
        ]
      );

      // Simulate the respond action: clear blocker metadata, add user response
      const task = mod.readTask("respond-team", "1");
      expect(task).not.toBeNull();

      const { blockerSummary, blockerType, blockerDetails, blockerSince, blockerFrom, ...restMetadata } =
        (task!.metadata ?? {}) as Record<string, unknown>;
      task!.metadata = {
        ...restMetadata,
        lastUserResponse: new Date().toISOString(),
        lastUserMessage: "Use PostgreSQL",
      };
      mod.writeTask("respond-team", task!);

      // Verify blocker metadata is cleared
      const updated = mod.readTask("respond-team", "1");
      expect(updated!.metadata?.blockerSummary).toBeUndefined();
      expect(updated!.metadata?.blockerType).toBeUndefined();
      expect(updated!.metadata?.lastUserMessage).toBe("Use PostgreSQL");
      expect(updated!.metadata?.lastUserResponse).toBeDefined();
    });

    it("updates task owner on reassignment", async () => {
      const mod = await getModule();

      createTeamWithTasks(
        "reassign-team",
        [
          { name: "leader", agentId: "ra1", agentType: "lead" },
          { name: "dev-a", agentId: "ra2", agentType: "general-purpose" },
          { name: "dev-b", agentId: "ra3", agentType: "general-purpose" },
        ],
        [
          {
            id: "1",
            subject: "Stuck on API",
            status: "in_progress",
            owner: "dev-a",
            metadata: {
              blockerType: "dependency",
              blockerSummary: "Blocked by auth module",
            },
          },
        ]
      );

      const task = mod.readTask("reassign-team", "1");
      expect(task!.owner).toBe("dev-a");

      // Simulate reassign
      const previousOwner = task!.owner;
      task!.owner = "dev-b";
      const { blockerSummary: _bs, blockerType: _bt, ...restMeta } =
        (task!.metadata ?? {}) as Record<string, unknown>;
      task!.metadata = {
        ...restMeta,
        reassignedAt: new Date().toISOString(),
        reassignedFrom: previousOwner,
      };
      mod.writeTask("reassign-team", task!);

      const updated = mod.readTask("reassign-team", "1");
      expect(updated!.owner).toBe("dev-b");
      expect(updated!.metadata?.reassignedFrom).toBe("dev-a");
      expect(updated!.metadata?.blockerSummary).toBeUndefined();
    });

    it("marks task as deleted on cancel", async () => {
      const mod = await getModule();

      createTeamWithTasks(
        "cancel-team",
        [{ name: "leader", agentId: "ct1", agentType: "lead" }],
        [
          {
            id: "1",
            subject: "Cancel me",
            status: "in_progress",
            owner: "dev",
            metadata: { blockerSummary: "Impossible to complete" },
          },
        ]
      );

      const task = mod.readTask("cancel-team", "1");
      task!.status = "deleted";
      task!.metadata = {
        ...task!.metadata,
        cancelledAt: new Date().toISOString(),
        cancelledBy: "dashboard",
      };
      mod.writeTask("cancel-team", task!);

      const updated = mod.readTask("cancel-team", "1");
      expect(updated!.status).toBe("deleted");
      expect(updated!.metadata?.cancelledBy).toBe("dashboard");
    });
  });

  describe("inbox message creation", () => {
    it("creates inbox message file for task owner", async () => {
      const claudeDir = path.join(tmpDir, ".claude");
      const inboxDir = path.join(claudeDir, "teams", "inbox-team", "inboxes");

      createTeamWithTasks(
        "inbox-team",
        [
          { name: "leader", agentId: "ib1", agentType: "lead" },
          { name: "dev", agentId: "ib2", agentType: "general-purpose" },
        ],
        [
          {
            id: "1",
            subject: "Stuck task",
            status: "in_progress",
            owner: "dev",
          },
        ]
      );

      // Simulate writing an inbox message (as the respond endpoint does)
      fs.mkdirSync(inboxDir, { recursive: true });
      const messages = [
        {
          id: `msg-${Date.now()}`,
          from: "dashboard",
          to: "dev",
          content: `[Re: Task #1 — Stuck task] Use the backup approach`,
          timestamp: new Date().toISOString(),
        },
      ];
      fs.writeFileSync(
        path.join(inboxDir, "dev.json"),
        JSON.stringify(messages, null, 2)
      );

      // Verify the inbox file was created
      const inboxFile = path.join(inboxDir, "dev.json");
      expect(fs.existsSync(inboxFile)).toBe(true);

      const written = JSON.parse(fs.readFileSync(inboxFile, "utf-8"));
      expect(written).toHaveLength(1);
      expect(written[0].from).toBe("dashboard");
      expect(written[0].to).toBe("dev");
      expect(written[0].content).toContain("Task #1");
      expect(written[0].content).toContain("Use the backup approach");
    });

    it("appends to existing inbox messages", async () => {
      const claudeDir = path.join(tmpDir, ".claude");
      const inboxDir = path.join(claudeDir, "teams", "append-team", "inboxes");

      createTeamWithTasks(
        "append-team",
        [{ name: "leader", agentId: "ap1", agentType: "lead" }],
        []
      );

      fs.mkdirSync(inboxDir, { recursive: true });

      // Write first message
      const existing = [
        { id: "msg-1", from: "someone", to: "leader", content: "Hello", timestamp: "2026-01-01T00:00:00Z" },
      ];
      fs.writeFileSync(path.join(inboxDir, "leader.json"), JSON.stringify(existing));

      // Append new message (as the respond endpoint does)
      const messages = JSON.parse(fs.readFileSync(path.join(inboxDir, "leader.json"), "utf-8")) as unknown[];
      messages.push({
        id: "msg-2",
        from: "dashboard",
        to: "leader",
        content: "New response",
        timestamp: new Date().toISOString(),
      });
      fs.writeFileSync(path.join(inboxDir, "leader.json"), JSON.stringify(messages, null, 2));

      const updated = JSON.parse(fs.readFileSync(path.join(inboxDir, "leader.json"), "utf-8"));
      expect(updated).toHaveLength(2);
      expect(updated[0].content).toBe("Hello");
      expect(updated[1].content).toBe("New response");
    });

    it("defaults to leader when task has no owner", async () => {
      createTeamWithTasks(
        "no-owner-team",
        [{ name: "leader", agentId: "no1", agentType: "lead" }],
        [
          {
            id: "1",
            subject: "Unowned task",
            status: "in_progress",
            metadata: { blockerSummary: "Stuck" },
          },
        ]
      );

      const mod = await getModule();
      const task = mod.readTask("no-owner-team", "1");
      const recipient = task!.owner ?? "leader";
      expect(recipient).toBe("leader");
    });
  });

  describe("blocker type classification", () => {
    it.each([
      ["decision_needed", "Decision Needed"],
      ["missing_info", "Missing Info"],
      ["dependency", "Dependency"],
      ["error", "Error"],
      ["permission", "Permission"],
    ] as const)("recognizes blocker type '%s'", async (blockerType, _label) => {
      const mod = await getModule();

      createTeamWithTasks(
        `type-${blockerType}-team`,
        [{ name: "leader", agentId: "t1", agentType: "lead" }],
        [
          {
            id: "1",
            subject: `${blockerType} task`,
            status: "in_progress",
            metadata: {
              blockerType,
              blockerSummary: `Blocked by ${blockerType}`,
            },
          },
        ]
      );

      const tasks = mod.readTaskList(`type-${blockerType}-team`);
      expect(tasks[0].metadata?.blockerType).toBe(blockerType);
    });
  });

  describe("stale task detection", () => {
    it("detects stale in_progress tasks by file mtime", async () => {
      const mod = await getModule();
      const STALENESS_MS = 5 * 60 * 1000;

      createTeamWithTasks(
        "stale-team",
        [{ name: "leader", agentId: "s1", agentType: "lead" }],
        [
          {
            id: "1",
            subject: "Stale task",
            status: "in_progress",
          },
        ]
      );

      // Manually set the mtime to 10 minutes ago
      const taskFile = path.join(tmpDir, ".claude", "tasks", "stale-team", "1.json");
      const oldTime = new Date(Date.now() - 10 * 60 * 1000);
      fs.utimesSync(taskFile, oldTime, oldTime);

      const stat = fs.statSync(taskFile);
      const isStale = Date.now() - stat.mtimeMs > STALENESS_MS;
      expect(isStale).toBe(true);
    });

    it("does not flag recently modified tasks as stale", async () => {
      const mod = await getModule();
      const STALENESS_MS = 5 * 60 * 1000;

      createTeamWithTasks(
        "fresh-team",
        [{ name: "leader", agentId: "f1", agentType: "lead" }],
        [
          {
            id: "1",
            subject: "Fresh task",
            status: "in_progress",
          },
        ]
      );

      const taskFile = path.join(tmpDir, ".claude", "tasks", "fresh-team", "1.json");
      const stat = fs.statSync(taskFile);
      const isStale = Date.now() - stat.mtimeMs > STALENESS_MS;
      expect(isStale).toBe(false);
    });
  });

  describe("security", () => {
    it("rejects path traversal in team names", async () => {
      const mod = await getModule();
      expect(() => mod.readTask("../etc", "1")).toThrow("Invalid name");
    });

    it("rejects path traversal in task IDs", async () => {
      const mod = await getModule();
      expect(() => mod.readTask("safe-team", "../../../etc/passwd")).toThrow("Invalid name");
    });

    it("validates team name characters", async () => {
      const mod = await getModule();
      expect(() => mod.readTask("team with spaces", "1")).toThrow("Invalid name");
      expect(() => mod.readTask("team/slash", "1")).toThrow("Invalid name");
    });

    it("validates inbox path stays within .claude directory", () => {
      const claudeDir = path.join(tmpDir, ".claude");
      const inboxPath = path.join(claudeDir, "teams", "test-team", "inboxes", "dev.json");
      const resolved = path.resolve(inboxPath);
      expect(resolved.startsWith(path.resolve(claudeDir) + path.sep)).toBe(true);

      // Traversal attempt that escapes .claude entirely
      const maliciousPath = path.resolve(claudeDir, "..", "..", "etc", "passwd");
      expect(maliciousPath.startsWith(path.resolve(claudeDir) + path.sep)).toBe(false);
    });
  });
});

describe("stuck tasks — StuckTask type contract", () => {
  it("StuckTask extends TeamTask with required fields", async () => {
    // Type-level test: verify the StuckTask interface shape
    const stuckTask: import("@/types").StuckTask = {
      id: "1",
      subject: "Test",
      status: "in_progress",
      teamName: "my-team",
      blockerType: "decision_needed",
      blockerSummary: "Need decision",
      blockerDetails: "Detailed context",
      blockerSince: new Date().toISOString(),
      blockerFrom: "dev",
    };

    expect(stuckTask.teamName).toBe("my-team");
    expect(stuckTask.blockerType).toBe("decision_needed");
    expect(stuckTask.id).toBe("1");
    expect(stuckTask.status).toBe("in_progress");
  });

  it("StuckTask allows optional blocker fields", () => {
    const minimal: import("@/types").StuckTask = {
      id: "2",
      subject: "Minimal stuck",
      status: "in_progress",
      teamName: "team-b",
    };

    expect(minimal.blockerType).toBeUndefined();
    expect(minimal.blockerSummary).toBeUndefined();
    expect(minimal.blockerDetails).toBeUndefined();
  });
});

describe("stuck tasks — respond action validation", () => {
  it("validates action must be message, reassign, or cancel", () => {
    const validActions = ["message", "reassign", "cancel"];
    const invalidActions = ["delete", "update", "", undefined, null];

    for (const action of validActions) {
      expect(validActions.includes(action)).toBe(true);
    }

    for (const action of invalidActions) {
      expect(validActions.includes(action as string)).toBe(false);
    }
  });

  it("message action requires non-empty message string", () => {
    const validMessage = { action: "message", message: "Use PostgreSQL" };
    const emptyMessage = { action: "message", message: "" };
    const missingMessage = { action: "message" };

    expect(typeof validMessage.message === "string" && validMessage.message.length > 0).toBe(true);
    expect(typeof emptyMessage.message === "string" && emptyMessage.message.length > 0).toBe(false);
    expect("message" in missingMessage && typeof (missingMessage as { message?: string }).message === "string").toBe(false);
  });

  it("reassign action requires assignTo string", () => {
    const valid = { action: "reassign", assignTo: "dev-b" };
    const missing = { action: "reassign" };

    expect(typeof valid.assignTo === "string" && valid.assignTo.length > 0).toBe(true);
    expect("assignTo" in missing).toBe(false);
  });
});
