import { describe, it, expect } from "vitest";
import type {
  Team,
  Teammate,
  TeamTask,
  ApiResponse,
  QueuedTask,
  Settings,
} from "@/types";

// Type-level tests to ensure the interfaces are correctly defined
// and data structures match expected shapes.

describe("type contracts", () => {
  it("Team has required fields", () => {
    const team: Team = {
      name: "test",
      members: [],
    };
    expect(team.name).toBe("test");
    expect(team.members).toEqual([]);
    expect(team.description).toBeUndefined();
    expect(team.createdAt).toBeUndefined();
  });

  it("Teammate has required fields", () => {
    const mate: Teammate = {
      name: "worker",
      agentId: "abc-123",
      agentType: "general-purpose",
    };
    expect(mate.name).toBe("worker");
    expect(mate.status).toBeUndefined();
  });

  it("TeamTask status values are valid", () => {
    const statuses: TeamTask["status"][] = [
      "pending",
      "in_progress",
      "completed",
      "deleted",
    ];
    expect(statuses).toHaveLength(4);
  });

  it("ApiResponse wraps data correctly", () => {
    const res: ApiResponse<string[]> = {
      data: ["a", "b"],
      meta: { total: 2 },
    };
    expect(res.data).toEqual(["a", "b"]);
    expect(res.error).toBeUndefined();
  });

  it("ApiResponse can represent errors", () => {
    const res: ApiResponse<never> = {
      error: "Something went wrong",
    };
    expect(res.error).toBe("Something went wrong");
    expect(res.data).toBeUndefined();
  });

  it("QueuedTask status values are valid", () => {
    const statuses: QueuedTask["status"][] = [
      "pending",
      "running",
      "completed",
      "failed",
      "cancelled",
    ];
    expect(statuses).toHaveLength(5);
  });

  it("Settings has correct optional structure", () => {
    const settings: Settings = {};
    expect(settings.theme).toBeUndefined();

    const fullSettings: Settings = {
      theme: "dark",
      refreshInterval: 5000,
      proxyConfig: {
        enabled: true,
        port: 28787,
        targetUrl: "https://api.anthropic.com",
      },
    };
    expect(fullSettings.proxyConfig?.port).toBe(28787);
  });
});
