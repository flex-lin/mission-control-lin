import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

let tmpDir: string;

describe("Task Editing API", () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-task-edit-"));
    vi.stubEnv("HOME", tmpDir);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // Helper: dynamically import claude-files with fresh HOME
  async function getModule() {
    vi.resetModules();
    return await import("@/lib/claude-files");
  }

  // Helper: set up a team with tasks
  async function setupTeamWithTasks() {
    const mod = await getModule();
    const teamName = "test-team";
    const teamsDir = path.join(tmpDir, ".claude", "teams", teamName);
    fs.mkdirSync(teamsDir, { recursive: true });
    fs.writeFileSync(
      path.join(teamsDir, "config.json"),
      JSON.stringify({
        name: teamName,
        members: [{ name: "leader", agentId: "abc", agentType: "lead" }],
        description: "Test team",
      })
    );

    // Create initial tasks
    mod.writeTask(teamName, {
      id: "1",
      subject: "First task",
      description: "Do the first thing",
      status: "pending",
      owner: "leader",
    });
    mod.writeTask(teamName, {
      id: "2",
      subject: "Second task",
      description: "Do the second thing",
      status: "pending",
    });
    mod.writeTask(teamName, {
      id: "3",
      subject: "Third task",
      status: "in_progress",
      owner: "worker",
    });

    return { mod, teamName };
  }

  // ── Task Field Editing via writeTask ──────────────────────────────────────

  describe("editing task fields", () => {
    it("updates task subject", async () => {
      const { mod, teamName } = await setupTeamWithTasks();

      const tasks = mod.readTaskList(teamName);
      const task = tasks.find((t) => t.id === "1")!;
      task.subject = "Updated first task";
      mod.writeTask(teamName, task);

      const updated = mod.readTaskList(teamName);
      const found = updated.find((t) => t.id === "1")!;
      expect(found.subject).toBe("Updated first task");
    });

    it("updates task description", async () => {
      const { mod, teamName } = await setupTeamWithTasks();

      const tasks = mod.readTaskList(teamName);
      const task = tasks.find((t) => t.id === "1")!;
      task.description = "New description";
      mod.writeTask(teamName, task);

      const updated = mod.readTaskList(teamName);
      expect(updated.find((t) => t.id === "1")!.description).toBe("New description");
    });

    it("updates task status", async () => {
      const { mod, teamName } = await setupTeamWithTasks();

      const tasks = mod.readTaskList(teamName);
      const task = tasks.find((t) => t.id === "1")!;
      task.status = "completed";
      mod.writeTask(teamName, task);

      const updated = mod.readTaskList(teamName);
      expect(updated.find((t) => t.id === "1")!.status).toBe("completed");
    });

    it("updates task owner", async () => {
      const { mod, teamName } = await setupTeamWithTasks();

      const tasks = mod.readTaskList(teamName);
      const task = tasks.find((t) => t.id === "2")!;
      task.owner = "new-owner";
      mod.writeTask(teamName, task);

      const updated = mod.readTaskList(teamName);
      expect(updated.find((t) => t.id === "2")!.owner).toBe("new-owner");
    });

    it("preserves other fields when updating one field", async () => {
      const { mod, teamName } = await setupTeamWithTasks();

      const tasks = mod.readTaskList(teamName);
      const task = tasks.find((t) => t.id === "1")!;
      task.subject = "Changed subject";
      mod.writeTask(teamName, task);

      const updated = mod.readTaskList(teamName);
      const found = updated.find((t) => t.id === "1")!;
      expect(found.subject).toBe("Changed subject");
      expect(found.description).toBe("Do the first thing");
      expect(found.status).toBe("pending");
      expect(found.owner).toBe("leader");
    });

    it("does not affect other tasks when updating one", async () => {
      const { mod, teamName } = await setupTeamWithTasks();

      const tasks = mod.readTaskList(teamName);
      const task = tasks.find((t) => t.id === "1")!;
      task.subject = "Changed";
      mod.writeTask(teamName, task);

      const updated = mod.readTaskList(teamName);
      expect(updated.find((t) => t.id === "2")!.subject).toBe("Second task");
      expect(updated.find((t) => t.id === "3")!.subject).toBe("Third task");
    });
  });

  // ── Priority ──────────────────────────────────────────────────────────────

  describe("task priority", () => {
    it("sets priority on a task", async () => {
      const { mod, teamName } = await setupTeamWithTasks();

      const tasks = mod.readTaskList(teamName);
      const task = tasks.find((t) => t.id === "1")!;
      task.priority = "high";
      mod.writeTask(teamName, task);

      const updated = mod.readTaskList(teamName);
      expect(updated.find((t) => t.id === "1")!.priority).toBe("high");
    });

    it("supports all priority levels", async () => {
      const { mod, teamName } = await setupTeamWithTasks();
      const priorities = ["low", "medium", "high", "critical"] as const;

      for (const priority of priorities) {
        const tasks = mod.readTaskList(teamName);
        const task = tasks.find((t) => t.id === "1")!;
        task.priority = priority;
        mod.writeTask(teamName, task);

        const updated = mod.readTaskList(teamName);
        expect(updated.find((t) => t.id === "1")!.priority).toBe(priority);
      }
    });

    it("can unset priority by setting to undefined", async () => {
      const { mod, teamName } = await setupTeamWithTasks();

      // Set priority first
      const tasks = mod.readTaskList(teamName);
      const task = tasks.find((t) => t.id === "1")!;
      task.priority = "high";
      mod.writeTask(teamName, task);

      // Now remove it — JSON serialization drops undefined, so read and check
      const withPriority = mod.readTaskList(teamName).find((t) => t.id === "1")!;
      delete withPriority.priority;
      mod.writeTask(teamName, withPriority);

      const updated = mod.readTaskList(teamName);
      expect(updated.find((t) => t.id === "1")!.priority).toBeUndefined();
    });

    it("preserves priority across other field updates", async () => {
      const { mod, teamName } = await setupTeamWithTasks();

      // Set priority
      const tasks = mod.readTaskList(teamName);
      const task = tasks.find((t) => t.id === "1")!;
      task.priority = "critical";
      mod.writeTask(teamName, task);

      // Update a different field
      const withPriority = mod.readTaskList(teamName).find((t) => t.id === "1")!;
      withPriority.subject = "New subject";
      mod.writeTask(teamName, withPriority);

      const updated = mod.readTaskList(teamName);
      const found = updated.find((t) => t.id === "1")!;
      expect(found.priority).toBe("critical");
      expect(found.subject).toBe("New subject");
    });
  });

  // ── Task Ordering ─────────────────────────────────────────────────────────

  describe("task ordering", () => {
    it("sets order on a task", async () => {
      const { mod, teamName } = await setupTeamWithTasks();

      const tasks = mod.readTaskList(teamName);
      const task = tasks.find((t) => t.id === "1")!;
      task.order = 0;
      mod.writeTask(teamName, task);

      const updated = mod.readTaskList(teamName);
      expect(updated.find((t) => t.id === "1")!.order).toBe(0);
    });

    it("reorders tasks by updating order fields", async () => {
      const { mod, teamName } = await setupTeamWithTasks();

      // Assign initial order
      const tasks = mod.readTaskList(teamName);
      for (let i = 0; i < tasks.length; i++) {
        tasks[i].order = i;
        mod.writeTask(teamName, tasks[i]);
      }

      // Verify initial order
      let ordered = mod.readTaskList(teamName).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      expect(ordered[0].id).toBe("1");
      expect(ordered[1].id).toBe("2");
      expect(ordered[2].id).toBe("3");

      // Swap task 1 and task 3
      const task1 = mod.readTaskList(teamName).find((t) => t.id === "1")!;
      const task3 = mod.readTaskList(teamName).find((t) => t.id === "3")!;
      task1.order = 2;
      task3.order = 0;
      mod.writeTask(teamName, task1);
      mod.writeTask(teamName, task3);

      // Verify new order
      ordered = mod.readTaskList(teamName).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      expect(ordered[0].id).toBe("3");
      expect(ordered[1].id).toBe("2");
      expect(ordered[2].id).toBe("1");
    });

    it("handles tasks without order field (defaults to undefined)", async () => {
      const { mod, teamName } = await setupTeamWithTasks();

      const tasks = mod.readTaskList(teamName);
      // Tasks created without order should have undefined order
      for (const task of tasks) {
        expect(task.order).toBeUndefined();
      }
    });

    it("preserves order when updating other fields", async () => {
      const { mod, teamName } = await setupTeamWithTasks();

      // Set order
      const tasks = mod.readTaskList(teamName);
      const task = tasks.find((t) => t.id === "1")!;
      task.order = 5;
      mod.writeTask(teamName, task);

      // Update a different field
      const withOrder = mod.readTaskList(teamName).find((t) => t.id === "1")!;
      withOrder.status = "in_progress";
      mod.writeTask(teamName, withOrder);

      const updated = mod.readTaskList(teamName);
      expect(updated.find((t) => t.id === "1")!.order).toBe(5);
    });
  });

  // ── Combined Priority + Order ─────────────────────────────────────────────

  describe("combined priority and order", () => {
    it("sets both priority and order on a task", async () => {
      const { mod, teamName } = await setupTeamWithTasks();

      const tasks = mod.readTaskList(teamName);
      const task = tasks.find((t) => t.id === "1")!;
      task.priority = "high";
      task.order = 0;
      mod.writeTask(teamName, task);

      const updated = mod.readTaskList(teamName);
      const found = updated.find((t) => t.id === "1")!;
      expect(found.priority).toBe("high");
      expect(found.order).toBe(0);
    });

    it("can sort tasks by priority then order", async () => {
      const { mod, teamName } = await setupTeamWithTasks();

      const priorityWeight = { critical: 0, high: 1, medium: 2, low: 3 };

      // Assign priorities and orders
      const tasks = mod.readTaskList(teamName);
      const t1 = tasks.find((t) => t.id === "1")!;
      t1.priority = "low";
      t1.order = 0;
      mod.writeTask(teamName, t1);

      const t2 = tasks.find((t) => t.id === "2")!;
      t2.priority = "critical";
      t2.order = 1;
      mod.writeTask(teamName, t2);

      const t3 = tasks.find((t) => t.id === "3")!;
      t3.priority = "high";
      t3.order = 2;
      mod.writeTask(teamName, t3);

      // Sort by priority weight, then order
      const updated = mod.readTaskList(teamName);
      const sorted = updated.sort((a, b) => {
        const pa = priorityWeight[a.priority ?? "medium"];
        const pb = priorityWeight[b.priority ?? "medium"];
        if (pa !== pb) return pa - pb;
        return (a.order ?? 0) - (b.order ?? 0);
      });

      expect(sorted[0].id).toBe("2"); // critical
      expect(sorted[1].id).toBe("3"); // high
      expect(sorted[2].id).toBe("1"); // low
    });
  });
});
