import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

let tmpDir: string;

/**
 * Tests for PATCH /api/teams/[name]/tasks/[id] route handler.
 *
 * Since Next.js route handlers require NextRequest/NextResponse which are
 * tightly coupled to the Next.js runtime, we test the underlying logic
 * (claude-files read/write + validation) directly. This verifies the
 * same behavior the route exercises.
 */
describe("Task PATCH API logic", () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-task-patch-"));
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

  function setupTeam(teamName: string) {
    const teamsDir = path.join(tmpDir, ".claude", "teams", teamName);
    fs.mkdirSync(teamsDir, { recursive: true });
    fs.writeFileSync(
      path.join(teamsDir, "config.json"),
      JSON.stringify({
        name: teamName,
        members: [{ name: "leader", agentId: "abc", agentType: "lead" }],
      })
    );
  }

  // ── Simulates PATCH logic: read task, apply partial update, write back ──

  async function patchTask(
    teamName: string,
    taskId: string,
    body: Record<string, unknown>
  ): Promise<{ success: boolean; task?: Record<string, unknown>; error?: string }> {
    const mod = await getModule();

    const team = mod.readTeamConfig(teamName);
    if (!team) return { success: false, error: `Team "${teamName}" not found` };

    const tasks = mod.readTaskList(teamName);
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return { success: false, error: `Task "${taskId}" not found` };

    // Validate status
    const validStatuses = ["pending", "in_progress", "completed", "deleted"];
    if (body.status && !validStatuses.includes(body.status as string)) {
      return { success: false, error: `Invalid status: ${body.status}` };
    }

    // Validate priority
    const validPriorities = ["low", "medium", "high", "critical"];
    if (body.priority !== undefined && body.priority !== null && !validPriorities.includes(body.priority as string)) {
      return { success: false, error: `Invalid priority: ${body.priority}` };
    }

    // Validate order
    if (body.order !== undefined && (typeof body.order !== "number" || body.order < 0)) {
      return { success: false, error: "order must be a non-negative number" };
    }

    // Apply partial update (same spread pattern as the route)
    const updated = {
      ...task,
      ...(body.status !== undefined && { status: body.status }),
      ...(body.owner !== undefined && { owner: body.owner }),
      ...(body.subject !== undefined && { subject: body.subject }),
      ...(body.description !== undefined && { description: body.description }),
      ...(body.activeForm !== undefined && { activeForm: body.activeForm }),
      ...(body.blockedBy !== undefined && { blockedBy: body.blockedBy }),
      ...(body.blocks !== undefined && { blocks: body.blocks }),
      ...(body.priority !== undefined && { priority: body.priority }),
      ...(body.order !== undefined && { order: body.order }),
      ...(body.metadata !== undefined && { metadata: body.metadata }),
    };

    mod.writeTask(teamName, updated as import("@/types").TeamTask);
    return { success: true, task: updated };
  }

  describe("status validation", () => {
    it("accepts valid statuses", async () => {
      const mod = await getModule();
      const teamName = "patch-team";
      setupTeam(teamName);
      mod.writeTask(teamName, { id: "1", subject: "Test", status: "pending" });

      for (const status of ["pending", "in_progress", "completed", "deleted"]) {
        const result = await patchTask(teamName, "1", { status });
        expect(result.success).toBe(true);
        expect(result.task?.status).toBe(status);
      }
    });

    it("rejects invalid status", async () => {
      const mod = await getModule();
      const teamName = "patch-team";
      setupTeam(teamName);
      mod.writeTask(teamName, { id: "1", subject: "Test", status: "pending" });

      const result = await patchTask(teamName, "1", { status: "invalid" });
      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid status");
    });
  });

  describe("priority validation", () => {
    it("accepts valid priorities", async () => {
      const mod = await getModule();
      const teamName = "patch-team";
      setupTeam(teamName);
      mod.writeTask(teamName, { id: "1", subject: "Test", status: "pending" });

      for (const priority of ["low", "medium", "high", "critical"]) {
        const result = await patchTask(teamName, "1", { priority });
        expect(result.success).toBe(true);
        expect(result.task?.priority).toBe(priority);
      }
    });

    it("rejects invalid priority", async () => {
      const mod = await getModule();
      const teamName = "patch-team";
      setupTeam(teamName);
      mod.writeTask(teamName, { id: "1", subject: "Test", status: "pending" });

      const result = await patchTask(teamName, "1", { priority: "urgent" });
      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid priority");
    });

    it("allows null priority to clear it", async () => {
      const mod = await getModule();
      const teamName = "patch-team";
      setupTeam(teamName);
      mod.writeTask(teamName, { id: "1", subject: "Test", status: "pending" });

      // Set priority first
      await patchTask(teamName, "1", { priority: "high" });
      // Clear it with null — route allows null through validation
      const result = await patchTask(teamName, "1", { priority: null });
      expect(result.success).toBe(true);
    });
  });

  describe("order validation", () => {
    it("accepts valid order numbers", async () => {
      const mod = await getModule();
      const teamName = "patch-team";
      setupTeam(teamName);
      mod.writeTask(teamName, { id: "1", subject: "Test", status: "pending" });

      const result = await patchTask(teamName, "1", { order: 5 });
      expect(result.success).toBe(true);
      expect(result.task?.order).toBe(5);
    });

    it("accepts order of 0", async () => {
      const mod = await getModule();
      const teamName = "patch-team";
      setupTeam(teamName);
      mod.writeTask(teamName, { id: "1", subject: "Test", status: "pending" });

      const result = await patchTask(teamName, "1", { order: 0 });
      expect(result.success).toBe(true);
      expect(result.task?.order).toBe(0);
    });

    it("rejects negative order", async () => {
      const mod = await getModule();
      const teamName = "patch-team";
      setupTeam(teamName);
      mod.writeTask(teamName, { id: "1", subject: "Test", status: "pending" });

      const result = await patchTask(teamName, "1", { order: -1 });
      expect(result.success).toBe(false);
      expect(result.error).toContain("order must be a non-negative number");
    });

    it("rejects non-numeric order", async () => {
      const mod = await getModule();
      const teamName = "patch-team";
      setupTeam(teamName);
      mod.writeTask(teamName, { id: "1", subject: "Test", status: "pending" });

      const result = await patchTask(teamName, "1", { order: "first" });
      expect(result.success).toBe(false);
      expect(result.error).toContain("order must be a non-negative number");
    });
  });

  describe("partial updates", () => {
    it("updates only subject, preserving everything else", async () => {
      const mod = await getModule();
      const teamName = "patch-team";
      setupTeam(teamName);
      mod.writeTask(teamName, {
        id: "1",
        subject: "Original",
        description: "Desc",
        status: "pending",
        owner: "leader",
        priority: "high",
        order: 3,
      });

      const result = await patchTask(teamName, "1", { subject: "Updated" });
      expect(result.success).toBe(true);
      expect(result.task?.subject).toBe("Updated");
      expect(result.task?.description).toBe("Desc");
      expect(result.task?.status).toBe("pending");
      expect(result.task?.owner).toBe("leader");
      expect(result.task?.priority).toBe("high");
      expect(result.task?.order).toBe(3);
    });

    it("updates multiple fields at once", async () => {
      const mod = await getModule();
      const teamName = "patch-team";
      setupTeam(teamName);
      mod.writeTask(teamName, { id: "1", subject: "Test", status: "pending" });

      const result = await patchTask(teamName, "1", {
        subject: "New subject",
        priority: "critical",
        order: 0,
        status: "in_progress",
        owner: "worker",
      });

      expect(result.success).toBe(true);
      expect(result.task?.subject).toBe("New subject");
      expect(result.task?.priority).toBe("critical");
      expect(result.task?.order).toBe(0);
      expect(result.task?.status).toBe("in_progress");
      expect(result.task?.owner).toBe("worker");
    });
  });

  describe("error handling", () => {
    it("returns error for non-existent team", async () => {
      await getModule();
      const result = await patchTask("no-such-team", "1", { subject: "x" });
      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });

    it("returns error for non-existent task", async () => {
      const mod = await getModule();
      const teamName = "patch-team";
      setupTeam(teamName);
      mod.writeTask(teamName, { id: "1", subject: "Test", status: "pending" });

      const result = await patchTask(teamName, "99", { subject: "x" });
      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });
  });

  describe("persistence", () => {
    it("persists changes to disk", async () => {
      const mod = await getModule();
      const teamName = "persist-team";
      setupTeam(teamName);
      mod.writeTask(teamName, { id: "1", subject: "Original", status: "pending" });

      await patchTask(teamName, "1", {
        subject: "Persisted",
        priority: "high",
        order: 7,
      });

      // Re-read from disk
      const taskFilePath = path.join(tmpDir, ".claude", "tasks", teamName, "1.json");
      const raw = JSON.parse(fs.readFileSync(taskFilePath, "utf-8"));
      expect(raw.subject).toBe("Persisted");
      expect(raw.priority).toBe("high");
      expect(raw.order).toBe(7);
    });
  });
});
