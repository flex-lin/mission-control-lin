import { describe, it, expect } from "vitest";
import type { TeamTask } from "@/types";

// Extracted from components/agent-teams/team-detail-live.tsx
function statusBadgeVariant(status: TeamTask["status"]) {
  switch (status) {
    case "completed":
      return "success" as const;
    case "in_progress":
      return "default" as const;
    case "pending":
      return "warning" as const;
    case "deleted":
      return "outline" as const;
  }
}

// Extracted from components/agent-teams/team-health-panel.tsx
function formatRelativeTime(isoString: string | null): string {
  if (!isoString) return "never";

  const now = Date.now();
  const then = new Date(isoString).getTime();
  const diffMs = now - then;

  if (diffMs < 0) return "just now";

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return "just now";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

describe("statusBadgeVariant", () => {
  it('returns "success" for completed', () => {
    expect(statusBadgeVariant("completed")).toBe("success");
  });

  it('returns "default" for in_progress', () => {
    expect(statusBadgeVariant("in_progress")).toBe("default");
  });

  it('returns "warning" for pending', () => {
    expect(statusBadgeVariant("pending")).toBe("warning");
  });

  it('returns "outline" for deleted', () => {
    expect(statusBadgeVariant("deleted")).toBe("outline");
  });
});

describe("formatRelativeTime", () => {
  it('returns "never" for null', () => {
    expect(formatRelativeTime(null)).toBe("never");
  });

  it('returns "just now" for future timestamps', () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(formatRelativeTime(future)).toBe("just now");
  });

  it('returns "just now" for timestamps less than 60s ago', () => {
    const recent = new Date(Date.now() - 30_000).toISOString();
    expect(formatRelativeTime(recent)).toBe("just now");
  });

  it("returns minutes for timestamps between 1-59 minutes ago", () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
    expect(formatRelativeTime(fiveMinAgo)).toBe("5m ago");
  });

  it("returns hours for timestamps between 1-23 hours ago", () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 3_600_000).toISOString();
    expect(formatRelativeTime(threeHoursAgo)).toBe("3h ago");
  });

  it("returns days for timestamps 24+ hours ago", () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000).toISOString();
    expect(formatRelativeTime(twoDaysAgo)).toBe("2d ago");
  });
});

describe("task counting logic", () => {
  const tasks: TeamTask[] = [
    { id: "1", subject: "Task 1", status: "in_progress" },
    { id: "2", subject: "Task 2", status: "in_progress" },
    { id: "3", subject: "Task 3", status: "pending" },
    { id: "4", subject: "Task 4", status: "completed" },
    { id: "5", subject: "Task 5", status: "completed" },
    { id: "6", subject: "Task 6", status: "completed" },
    { id: "7", subject: "Task 7", status: "deleted" },
  ];

  it("counts active tasks correctly", () => {
    const active = tasks.filter((t) => t.status === "in_progress").length;
    expect(active).toBe(2);
  });

  it("counts pending tasks correctly", () => {
    const pending = tasks.filter((t) => t.status === "pending").length;
    expect(pending).toBe(1);
  });

  it("counts completed tasks correctly", () => {
    const completed = tasks.filter((t) => t.status === "completed").length;
    expect(completed).toBe(3);
  });
});
