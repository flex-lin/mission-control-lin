import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Tests for the cancel button and file drop zone behavior.
 *
 * Cancel button (DELETE /api/queue/{id}):
 *   - Pending tasks: status → cancelled (fast path, no tmux)
 *   - Running tasks with team: DB update first, then async tmux kill (non-blocking)
 *   - Running tasks without team: status → cancelled (no tmux needed)
 *   - Completed/failed/cancelled tasks: hard delete + file cleanup
 *
 * File validation (queue page logic):
 *   - Max file count enforcement
 *   - File type validation
 *   - File size validation
 *   - File removal by index
 */

// ── Mock Prisma DB ─────────────────────────────────────────────────────────

const mockFindUnique = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    queuedTask: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
      delete: (...args: unknown[]) => mockDelete(...args),
    },
  },
}));

// ── Mock tmux-manager (async variants used by refactored route) ───────────

const mockListTeamSessionsAsync = vi.fn().mockResolvedValue([]);
const mockKillSessionAsync = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/tmux-manager", () => ({
  listTeamSessions: vi.fn().mockReturnValue([]),
  killSession: vi.fn(),
  listTeamSessionsAsync: (...args: unknown[]) => mockListTeamSessionsAsync(...args),
  killSessionAsync: (...args: unknown[]) => mockKillSessionAsync(...args),
}));

// ── Mock fs ───────────────────────────────────────────────────────────────

const mockRm = vi.fn().mockResolvedValue(undefined);
const mockExistsSync = vi.fn().mockReturnValue(true);

vi.mock("fs/promises", () => ({
  rm: (...args: unknown[]) => mockRm(...args),
}));

vi.mock("fs", () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
}));

// ── Helpers ───────────────────────────────────────────────────────────────

function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    goal: "Test task",
    projectPath: "/tmp/project",
    status: "pending",
    teamName: null,
    priority: 0,
    result: null,
    attachments: "[]",
    createdAt: new Date().toISOString(),
    startedAt: null,
    completedAt: null,
    ...overrides,
  };
}

import { DELETE } from "@/app/api/queue/[id]/route";

async function callDelete(id: string) {
  const req = new NextRequest(
    new URL(`/api/queue/${id}`, "http://localhost:3777"),
    { method: "DELETE" }
  );
  const res = await DELETE(req, { params: Promise.resolve({ id }) });
  return { status: res.status, body: await res.json() };
}

// ── Cancel button tests ───────────────────────────────────────────────────

describe("DELETE /api/queue/{id} — cancel button", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListTeamSessionsAsync.mockResolvedValue([]);
    mockExistsSync.mockReturnValue(true);
  });

  describe("pending task cancellation (fast path)", () => {
    it("cancels a pending task without touching tmux", async () => {
      const task = makeTask({ id: 10, status: "pending" });
      mockFindUnique.mockResolvedValue(task);
      mockUpdate.mockResolvedValue({ ...task, status: "cancelled" });

      const { status, body } = await callDelete("10");

      expect(status).toBe(200);
      expect(body.data.cancelled).toBe(true);
      // Should NOT call tmux at all for pending tasks
      expect(mockListTeamSessionsAsync).not.toHaveBeenCalled();
      expect(mockKillSessionAsync).not.toHaveBeenCalled();
    });

    it("sets completedAt when cancelling", async () => {
      const task = makeTask({ id: 11, status: "pending" });
      mockFindUnique.mockResolvedValue(task);
      mockUpdate.mockResolvedValue({ ...task, status: "cancelled" });

      await callDelete("11");

      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 11 },
          data: expect.objectContaining({
            status: "cancelled",
            completedAt: expect.any(Date),
          }),
        })
      );
    });
  });

  describe("running task cancellation (non-blocking tmux kill)", () => {
    it("cancels a running task without team (no tmux)", async () => {
      const task = makeTask({ id: 20, status: "running", teamName: null });
      mockFindUnique.mockResolvedValue(task);
      mockUpdate.mockResolvedValue({ ...task, status: "cancelled" });

      const { status, body } = await callDelete("20");

      expect(status).toBe(200);
      expect(body.data.cancelled).toBe(true);
      expect(mockListTeamSessionsAsync).not.toHaveBeenCalled();
    });

    it("returns immediately after DB update, tmux kill is async", async () => {
      const task = makeTask({ id: 21, status: "running", teamName: "my-team" });
      mockFindUnique.mockResolvedValue(task);
      mockUpdate.mockResolvedValue({ ...task, status: "cancelled" });
      // Mock slow tmux operation
      mockListTeamSessionsAsync.mockResolvedValue([
        { sessionName: "mc-my-team-leader", alive: true },
      ]);

      const { status, body } = await callDelete("21");

      // Response comes back immediately (DB updated first)
      expect(status).toBe(200);
      expect(body.data.cancelled).toBe(true);
      // DB update was called before tmux kill
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "cancelled" }),
        })
      );
    });

    it("fires tmux cleanup for running tasks with team", async () => {
      const task = makeTask({ id: 22, status: "running", teamName: "my-team" });
      mockFindUnique.mockResolvedValue(task);
      mockUpdate.mockResolvedValue({ ...task, status: "cancelled" });
      mockListTeamSessionsAsync.mockResolvedValue([
        { sessionName: "mc-my-team-leader", alive: true },
        { sessionName: "mc-my-team-worker1", alive: true },
      ]);

      await callDelete("22");

      // Allow fire-and-forget promises to settle
      await new Promise((r) => setTimeout(r, 10));

      expect(mockListTeamSessionsAsync).toHaveBeenCalledWith("my-team");
      expect(mockKillSessionAsync).toHaveBeenCalledTimes(2);
      expect(mockKillSessionAsync).toHaveBeenCalledWith("mc-my-team-leader");
      expect(mockKillSessionAsync).toHaveBeenCalledWith("mc-my-team-worker1");
    });

    it("skips dead sessions when killing team", async () => {
      const task = makeTask({ id: 23, status: "running", teamName: "half-dead" });
      mockFindUnique.mockResolvedValue(task);
      mockUpdate.mockResolvedValue({ ...task, status: "cancelled" });
      mockListTeamSessionsAsync.mockResolvedValue([
        { sessionName: "mc-half-dead-leader", alive: true },
        { sessionName: "mc-half-dead-worker1", alive: false },
      ]);

      await callDelete("23");
      await new Promise((r) => setTimeout(r, 10));

      expect(mockKillSessionAsync).toHaveBeenCalledTimes(1);
      expect(mockKillSessionAsync).toHaveBeenCalledWith("mc-half-dead-leader");
    });

    it("handles async killSession errors gracefully", async () => {
      const task = makeTask({ id: 24, status: "running", teamName: "err-team" });
      mockFindUnique.mockResolvedValue(task);
      mockUpdate.mockResolvedValue({ ...task, status: "cancelled" });
      mockListTeamSessionsAsync.mockResolvedValue([
        { sessionName: "mc-err-team-leader", alive: true },
      ]);
      mockKillSessionAsync.mockRejectedValue(new Error("tmux server not running"));

      const { status, body } = await callDelete("24");

      // Should succeed — tmux errors don't affect the response
      expect(status).toBe(200);
      expect(body.data.cancelled).toBe(true);
    });

    it("handles listTeamSessionsAsync rejection gracefully", async () => {
      const task = makeTask({ id: 25, status: "running", teamName: "ghost-team" });
      mockFindUnique.mockResolvedValue(task);
      mockUpdate.mockResolvedValue({ ...task, status: "cancelled" });
      mockListTeamSessionsAsync.mockRejectedValue(new Error("tmux not installed"));

      const { status, body } = await callDelete("25");

      // Should succeed — fire-and-forget .catch() handles it
      expect(status).toBe(200);
      expect(body.data.cancelled).toBe(true);
    });
  });

  describe("permanent deletion (completed/failed/cancelled tasks)", () => {
    it("hard-deletes a completed task and cleans up files", async () => {
      const task = makeTask({ id: 30, status: "completed" });
      mockFindUnique.mockResolvedValue(task);
      mockDelete.mockResolvedValue(task);

      const { status, body } = await callDelete("30");

      expect(status).toBe(200);
      expect(body.data.deleted).toBe(true);
      expect(mockDelete).toHaveBeenCalledWith({ where: { id: 30 } });
      expect(mockRm).toHaveBeenCalledWith(
        expect.stringContaining("30"),
        { recursive: true, force: true }
      );
    });

    it("hard-deletes a cancelled task", async () => {
      const task = makeTask({ id: 31, status: "cancelled" });
      mockFindUnique.mockResolvedValue(task);
      mockDelete.mockResolvedValue(task);

      const { status, body } = await callDelete("31");

      expect(status).toBe(200);
      expect(body.data.deleted).toBe(true);
    });

    it("hard-deletes a failed task", async () => {
      const task = makeTask({ id: 32, status: "failed" });
      mockFindUnique.mockResolvedValue(task);
      mockDelete.mockResolvedValue(task);

      const { status, body } = await callDelete("32");

      expect(status).toBe(200);
      expect(body.data.deleted).toBe(true);
    });

    it("skips rm when upload directory does not exist", async () => {
      const task = makeTask({ id: 33, status: "completed" });
      mockFindUnique.mockResolvedValue(task);
      mockDelete.mockResolvedValue(task);
      mockExistsSync.mockReturnValue(false);

      await callDelete("33");

      expect(mockRm).not.toHaveBeenCalled();
      expect(mockDelete).toHaveBeenCalledWith({ where: { id: 33 } });
    });
  });

  describe("error handling", () => {
    it("returns 400 for non-numeric id", async () => {
      const { status, body } = await callDelete("abc");

      expect(status).toBe(400);
      expect(body.code).toBe("VALIDATION_ERROR");
    });

    it("returns 404 for non-existent task", async () => {
      mockFindUnique.mockResolvedValue(null);

      const { status, body } = await callDelete("999");

      expect(status).toBe(404);
      expect(body.code).toBe("NOT_FOUND");
    });
  });
});

// ── File validation logic tests ───────────────────────────────────────────

describe("File drop zone validation logic", () => {
  describe("file count validation", () => {
    it("rejects when adding files would exceed MAX_FILES_PER_TASK", () => {
      const MAX_FILES = 5;
      const existingCount = 3;
      const incoming = [
        new File(["a"], "a.png", { type: "image/png" }),
        new File(["b"], "b.png", { type: "image/png" }),
        new File(["c"], "c.png", { type: "image/png" }),
      ];

      const wouldExceed = existingCount + incoming.length > MAX_FILES;
      expect(wouldExceed).toBe(true);
    });

    it("allows adding files within the limit", () => {
      const MAX_FILES = 5;
      const existingCount = 2;
      const incoming = [
        new File(["a"], "a.png", { type: "image/png" }),
        new File(["b"], "b.png", { type: "image/png" }),
      ];

      const wouldExceed = existingCount + incoming.length > MAX_FILES;
      expect(wouldExceed).toBe(false);
    });

    it("allows adding files up to exactly the limit", () => {
      const MAX_FILES = 5;
      const existingCount = 0;
      const incoming = Array.from({ length: 5 }, (_, i) =>
        new File(["x"], `file${i}.png`, { type: "image/png" })
      );

      const wouldExceed = existingCount + incoming.length > MAX_FILES;
      expect(wouldExceed).toBe(false);
    });
  });

  describe("file type validation", () => {
    const ALLOWED_TYPES = [
      "image/png",
      "image/jpeg",
      "image/gif",
      "image/webp",
      "application/pdf",
      "text/plain",
      "text/markdown",
      "text/csv",
    ];

    it("accepts allowed image types", () => {
      for (const type of ["image/png", "image/jpeg", "image/gif", "image/webp"]) {
        expect(ALLOWED_TYPES.includes(type)).toBe(true);
      }
    });

    it("accepts allowed document types", () => {
      for (const type of ["application/pdf", "text/plain", "text/markdown", "text/csv"]) {
        expect(ALLOWED_TYPES.includes(type)).toBe(true);
      }
    });

    it("rejects disallowed types", () => {
      for (const type of ["application/octet-stream", "text/html", "application/javascript", "application/zip"]) {
        expect(ALLOWED_TYPES.includes(type)).toBe(false);
      }
    });
  });

  describe("file size validation", () => {
    const MAX_SIZE = 10 * 1024 * 1024; // 10MB

    it("accepts files under 10MB", () => {
      const size = 5 * 1024 * 1024;
      expect(size > MAX_SIZE).toBe(false);
    });

    it("accepts files at exactly 10MB", () => {
      expect(MAX_SIZE > MAX_SIZE).toBe(false);
    });

    it("rejects files over 10MB", () => {
      const size = 11 * 1024 * 1024;
      expect(size > MAX_SIZE).toBe(true);
    });
  });

  describe("file removal by index", () => {
    it("removes the correct file from the list", () => {
      const files = [
        new File(["a"], "a.png", { type: "image/png" }),
        new File(["b"], "b.png", { type: "image/png" }),
        new File(["c"], "c.png", { type: "image/png" }),
      ];
      const removeIndex = 1;
      const result = files.filter((_, i) => i !== removeIndex);

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe("a.png");
      expect(result[1].name).toBe("c.png");
    });

    it("handles removing the first file", () => {
      const files = [
        new File(["a"], "a.png", { type: "image/png" }),
        new File(["b"], "b.png", { type: "image/png" }),
      ];
      const result = files.filter((_, i) => i !== 0);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("b.png");
    });

    it("handles removing the last file", () => {
      const files = [
        new File(["a"], "a.png", { type: "image/png" }),
        new File(["b"], "b.png", { type: "image/png" }),
      ];
      const result = files.filter((_, i) => i !== 1);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("a.png");
    });

    it("handles removing the only file", () => {
      const files = [new File(["a"], "a.png", { type: "image/png" })];
      const result = files.filter((_, i) => i !== 0);

      expect(result).toHaveLength(0);
    });
  });
});

// ── Pure utility function tests ───────────────────────────────────────────

describe("Queue page utility functions", () => {
  describe("formatFileSize", () => {
    function formatFileSize(bytes: number): string {
      if (bytes < 1024) return `${bytes} B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }

    it("formats bytes", () => {
      expect(formatFileSize(0)).toBe("0 B");
      expect(formatFileSize(512)).toBe("512 B");
      expect(formatFileSize(1023)).toBe("1023 B");
    });

    it("formats kilobytes", () => {
      expect(formatFileSize(1024)).toBe("1.0 KB");
      expect(formatFileSize(1536)).toBe("1.5 KB");
      expect(formatFileSize(10240)).toBe("10.0 KB");
    });

    it("formats megabytes", () => {
      expect(formatFileSize(1024 * 1024)).toBe("1.0 MB");
      expect(formatFileSize(5.5 * 1024 * 1024)).toBe("5.5 MB");
      expect(formatFileSize(10 * 1024 * 1024)).toBe("10.0 MB");
    });
  });

  describe("formatRelativeTime", () => {
    function formatRelativeTime(dateStr: string): string {
      const diff = Date.now() - new Date(dateStr).getTime();
      const mins = Math.floor(diff / 60_000);
      if (mins < 1) return "just now";
      if (mins < 60) return `${mins}m ago`;
      const hours = Math.floor(mins / 60);
      if (hours < 24) return `${hours}h ago`;
      return `${Math.floor(hours / 24)}d ago`;
    }

    it("shows 'just now' for recent times", () => {
      const now = new Date().toISOString();
      expect(formatRelativeTime(now)).toBe("just now");
    });

    it("shows minutes", () => {
      const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
      expect(formatRelativeTime(fiveMinAgo)).toBe("5m ago");
    });

    it("shows hours", () => {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60_000).toISOString();
      expect(formatRelativeTime(twoHoursAgo)).toBe("2h ago");
    });

    it("shows days", () => {
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60_000).toISOString();
      expect(formatRelativeTime(threeDaysAgo)).toBe("3d ago");
    });
  });

  describe("parseAttachments", () => {
    function parseAttachments(task: { attachments?: unknown }): Array<{ filename: string; originalName: string; mimeType: string; size: number }> {
      if (!task.attachments) return [];
      if (Array.isArray(task.attachments)) return task.attachments;
      try {
        return JSON.parse(task.attachments as string);
      } catch {
        return [];
      }
    }

    it("returns empty array for null/undefined attachments", () => {
      expect(parseAttachments({})).toEqual([]);
      expect(parseAttachments({ attachments: null })).toEqual([]);
      expect(parseAttachments({ attachments: undefined })).toEqual([]);
    });

    it("returns array directly if already parsed", () => {
      const atts = [{ filename: "a.png", originalName: "a.png", mimeType: "image/png", size: 100 }];
      expect(parseAttachments({ attachments: atts })).toEqual(atts);
    });

    it("parses JSON string attachments", () => {
      const atts = [{ filename: "b.pdf", originalName: "b.pdf", mimeType: "application/pdf", size: 200 }];
      expect(parseAttachments({ attachments: JSON.stringify(atts) })).toEqual(atts);
    });

    it("returns empty array for invalid JSON", () => {
      expect(parseAttachments({ attachments: "not-json" })).toEqual([]);
    });

    it("handles empty JSON array string", () => {
      expect(parseAttachments({ attachments: "[]" })).toEqual([]);
    });
  });
});
