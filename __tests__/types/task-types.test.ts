import { describe, it, expect } from "vitest";
import type { TeamTask, TaskPriority } from "@/types";

describe("TeamTask type contract", () => {
  it("supports all required fields", () => {
    const task: TeamTask = {
      id: "1",
      subject: "Test task",
      status: "pending",
    };
    expect(task.id).toBe("1");
    expect(task.subject).toBe("Test task");
    expect(task.status).toBe("pending");
  });

  it("supports priority field", () => {
    const task: TeamTask = {
      id: "1",
      subject: "Test",
      status: "pending",
      priority: "high",
    };
    expect(task.priority).toBe("high");
  });

  it("supports order field", () => {
    const task: TeamTask = {
      id: "1",
      subject: "Test",
      status: "pending",
      order: 3,
    };
    expect(task.order).toBe(3);
  });

  it("supports all TaskPriority values", () => {
    const priorities: TaskPriority[] = ["low", "medium", "high", "critical"];
    expect(priorities).toHaveLength(4);

    for (const p of priorities) {
      const task: TeamTask = {
        id: "1",
        subject: "Test",
        status: "pending",
        priority: p,
      };
      expect(task.priority).toBe(p);
    }
  });

  it("allows optional fields to be undefined", () => {
    const task: TeamTask = {
      id: "1",
      subject: "Minimal",
      status: "pending",
    };
    expect(task.priority).toBeUndefined();
    expect(task.order).toBeUndefined();
    expect(task.description).toBeUndefined();
    expect(task.owner).toBeUndefined();
    expect(task.blockedBy).toBeUndefined();
    expect(task.blocks).toBeUndefined();
    expect(task.activeForm).toBeUndefined();
    expect(task.metadata).toBeUndefined();
  });

  it("supports all status values", () => {
    const statuses: TeamTask["status"][] = ["pending", "in_progress", "completed", "deleted"];
    for (const status of statuses) {
      const task: TeamTask = { id: "1", subject: "Test", status };
      expect(task.status).toBe(status);
    }
  });
});
