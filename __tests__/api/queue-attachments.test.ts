import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Tests for the file upload / attachment feature on task queue.
 *
 * POST /api/queue/upload?taskId={id} — multipart form upload
 *   - Accepts files via FormData ("files" field)
 *   - Validates type (ALLOWED_UPLOAD_TYPES), size (10MB), count (5 per task)
 *   - Writes to disk, updates QueuedTask.attachments JSON column
 *
 * DELETE /api/queue/{id} — cleans up uploaded files on task removal
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

// ── Mock fs/promises (upload writes) ───────────────────────────────────────

const mockWriteFile = vi.fn().mockResolvedValue(undefined);
const mockMkdir = vi.fn().mockResolvedValue(undefined);
const mockRm = vi.fn().mockResolvedValue(undefined);

vi.mock("fs/promises", () => ({
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
  mkdir: (...args: unknown[]) => mockMkdir(...args),
  rm: (...args: unknown[]) => mockRm(...args),
}));

vi.mock("fs", () => ({
  existsSync: () => true,
}));

vi.mock("@/lib/tmux-manager", () => ({
  listTeamSessions: vi.fn(() => []),
  killSession: vi.fn(),
}));

// ── Test Data ──────────────────────────────────────────────────────────────

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

function makeFile(name: string, type: string, sizeBytes = 100): File {
  const content = new Uint8Array(sizeBytes);
  return new File([content], name, { type });
}

function makeRequest(url: string, formData?: FormData): NextRequest {
  if (formData) {
    return new NextRequest(new URL(url, "http://localhost:31777"), {
      method: "POST",
      body: formData,
    });
  }
  return new NextRequest(new URL(url, "http://localhost:31777"));
}

// ── Helpers ────────────────────────────────────────────────────────────────

async function callUpload(url: string, formData?: FormData) {
  vi.resetModules();
  const mod = await import("@/app/api/queue/upload/route");
  const req = makeRequest(url, formData);
  const res = await mod.POST(req);
  return { status: res.status, body: await res.json() };
}

async function callDelete(id: string) {
  vi.resetModules();
  const mod = await import("@/app/api/queue/[id]/route");
  const req = new NextRequest(new URL(`/api/queue/${id}`, "http://localhost:31777"), {
    method: "DELETE",
  });
  const res = await mod.DELETE(req, { params: Promise.resolve({ id }) });
  return { status: res.status, body: await res.json() };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("POST /api/queue/upload — file upload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Successful upload ──────────────────────────────────────────────────

  describe("successful upload", () => {
    it("uploads a single valid file", async () => {
      const task = makeTask({ id: 1 });
      mockFindUnique.mockResolvedValue(task);
      mockUpdate.mockResolvedValue({ ...task, attachments: "[{}]" });

      const form = new FormData();
      form.append("files", makeFile("screenshot.png", "image/png"));

      const { status, body } = await callUpload("/api/queue/upload?taskId=1", form);

      expect(status).toBe(200);
      expect(body.data.attachments).toHaveLength(1);
      expect(body.data.attachments[0].originalName).toBe("screenshot.png");
      expect(body.data.attachments[0].mimeType).toBe("image/png");
    });

    it("uploads multiple valid files", async () => {
      const task = makeTask({ id: 2 });
      mockFindUnique.mockResolvedValue(task);
      mockUpdate.mockResolvedValue(task);

      const form = new FormData();
      form.append("files", makeFile("a.png", "image/png"));
      form.append("files", makeFile("b.pdf", "application/pdf"));
      form.append("files", makeFile("c.txt", "text/plain"));

      const { status, body } = await callUpload("/api/queue/upload?taskId=2", form);

      expect(status).toBe(200);
      expect(body.data.attachments).toHaveLength(3);
      expect(mockWriteFile).toHaveBeenCalledTimes(3);
    });

    it("creates the task upload directory", async () => {
      const task = makeTask({ id: 5 });
      mockFindUnique.mockResolvedValue(task);
      mockUpdate.mockResolvedValue(task);

      const form = new FormData();
      form.append("files", makeFile("img.jpeg", "image/jpeg"));

      await callUpload("/api/queue/upload?taskId=5", form);

      expect(mockMkdir).toHaveBeenCalledWith(
        expect.stringContaining("5"),
        { recursive: true }
      );
    });

    it("updates DB with attachment metadata JSON", async () => {
      const task = makeTask({ id: 3 });
      mockFindUnique.mockResolvedValue(task);
      mockUpdate.mockResolvedValue(task);

      const form = new FormData();
      form.append("files", makeFile("doc.pdf", "application/pdf", 500));

      await callUpload("/api/queue/upload?taskId=3", form);

      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 3 },
          data: {
            attachments: expect.stringContaining('"originalName":"doc.pdf"'),
          },
        })
      );
    });

    it("accepts all allowed MIME types", async () => {
      const allowedTypes = [
        { name: "a.png", type: "image/png" },
        { name: "b.jpg", type: "image/jpeg" },
        { name: "c.gif", type: "image/gif" },
        { name: "d.webp", type: "image/webp" },
        { name: "e.pdf", type: "application/pdf" },
      ];

      const task = makeTask({ id: 10 });

      for (const { name, type } of allowedTypes) {
        vi.clearAllMocks();
        mockFindUnique.mockResolvedValue(task);
        mockUpdate.mockResolvedValue(task);

        const form = new FormData();
        form.append("files", makeFile(name, type));

        const { status } = await callUpload("/api/queue/upload?taskId=10", form);
        expect(status).toBe(200);
      }
    });
  });

  // ── Validation: invalid file type ──────────────────────────────────────

  describe("invalid file type rejection", () => {
    it("rejects a disallowed MIME type", async () => {
      const task = makeTask({ id: 1 });
      mockFindUnique.mockResolvedValue(task);

      const form = new FormData();
      form.append("files", makeFile("malware.exe", "application/octet-stream"));

      const { status, body } = await callUpload("/api/queue/upload?taskId=1", form);

      expect(status).toBe(400);
      expect(body.code).toBe("VALIDATION_ERROR");
      expect(body.error).toContain("not allowed");
    });

    it("rejects HTML files", async () => {
      const task = makeTask({ id: 1 });
      mockFindUnique.mockResolvedValue(task);

      const form = new FormData();
      form.append("files", makeFile("page.html", "text/html"));

      const { status, body } = await callUpload("/api/queue/upload?taskId=1", form);

      expect(status).toBe(400);
      expect(body.code).toBe("VALIDATION_ERROR");
    });
  });

  // ── Validation: file too large ─────────────────────────────────────────

  describe("file size limit", () => {
    it("rejects file exceeding 10MB", async () => {
      const task = makeTask({ id: 1 });
      mockFindUnique.mockResolvedValue(task);

      const form = new FormData();
      // 11MB file
      form.append("files", makeFile("big.png", "image/png", 11 * 1024 * 1024));

      const { status, body } = await callUpload("/api/queue/upload?taskId=1", form);

      expect(status).toBe(400);
      expect(body.code).toBe("VALIDATION_ERROR");
      expect(body.error).toContain("10MB");
    });

    it("accepts file at exactly 10MB", async () => {
      const task = makeTask({ id: 1 });
      mockFindUnique.mockResolvedValue(task);
      mockUpdate.mockResolvedValue(task);

      const form = new FormData();
      form.append("files", makeFile("exact.png", "image/png", 10 * 1024 * 1024));

      const { status } = await callUpload("/api/queue/upload?taskId=1", form);

      expect(status).toBe(200);
    });
  });

  // ── Validation: max files per task ─────────────────────────────────────

  describe("max files per task", () => {
    it("rejects upload when task already has max files", async () => {
      const existingAttachments = Array.from({ length: 5 }, (_, i) => ({
        filename: `${i}.png`,
        originalName: `file${i}.png`,
        mimeType: "image/png",
        size: 100,
      }));
      const task = makeTask({ id: 1, attachments: JSON.stringify(existingAttachments) });
      mockFindUnique.mockResolvedValue(task);

      const form = new FormData();
      form.append("files", makeFile("one-more.png", "image/png"));

      const { status, body } = await callUpload("/api/queue/upload?taskId=1", form);

      expect(status).toBe(400);
      expect(body.code).toBe("VALIDATION_ERROR");
      expect(body.error).toContain("Max 5");
    });

    it("rejects when combined count exceeds limit", async () => {
      const existingAttachments = Array.from({ length: 3 }, (_, i) => ({
        filename: `${i}.png`,
        originalName: `file${i}.png`,
        mimeType: "image/png",
        size: 100,
      }));
      const task = makeTask({ id: 1, attachments: JSON.stringify(existingAttachments) });
      mockFindUnique.mockResolvedValue(task);

      const form = new FormData();
      form.append("files", makeFile("a.png", "image/png"));
      form.append("files", makeFile("b.png", "image/png"));
      form.append("files", makeFile("c.png", "image/png"));

      const { status, body } = await callUpload("/api/queue/upload?taskId=1", form);

      expect(status).toBe(400);
      expect(body.code).toBe("VALIDATION_ERROR");
    });
  });

  // ── Edge cases ─────────────────────────────────────────────────────────

  describe("edge cases", () => {
    it("returns error when taskId param is missing", async () => {
      const form = new FormData();
      form.append("files", makeFile("img.png", "image/png"));

      const { status, body } = await callUpload("/api/queue/upload", form);

      expect(status).toBe(400);
      expect(body.code).toBe("VALIDATION_ERROR");
      expect(body.error).toContain("taskId");
    });

    it("returns error for invalid (non-numeric) taskId", async () => {
      const form = new FormData();
      form.append("files", makeFile("img.png", "image/png"));

      const { status, body } = await callUpload("/api/queue/upload?taskId=abc", form);

      expect(status).toBe(400);
      expect(body.code).toBe("VALIDATION_ERROR");
    });

    it("returns 404 for non-existent task", async () => {
      mockFindUnique.mockResolvedValue(null);

      const form = new FormData();
      form.append("files", makeFile("img.png", "image/png"));

      const { status, body } = await callUpload("/api/queue/upload?taskId=999", form);

      expect(status).toBe(404);
      expect(body.code).toBe("NOT_FOUND");
    });

    it("returns error when no files are provided", async () => {
      const task = makeTask({ id: 1 });
      mockFindUnique.mockResolvedValue(task);

      const form = new FormData();

      const { status, body } = await callUpload("/api/queue/upload?taskId=1", form);

      expect(status).toBe(400);
      expect(body.code).toBe("VALIDATION_ERROR");
      expect(body.error).toContain("No files");
    });
  });
});

// ── DELETE /api/queue/{id} — file cleanup on task deletion ────────────────

describe("DELETE /api/queue/{id} — upload cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("removes upload directory when deleting a completed task", async () => {
    const task = makeTask({ id: 42, status: "completed" });
    mockFindUnique.mockResolvedValue(task);
    mockDelete.mockResolvedValue(task);

    const { status, body } = await callDelete("42");

    expect(status).toBe(200);
    expect(body.data.deleted).toBe(true);
    expect(mockRm).toHaveBeenCalledWith(
      expect.stringContaining("42"),
      { recursive: true, force: true }
    );
  });

  it("removes upload directory when deleting a failed task", async () => {
    const task = makeTask({ id: 43, status: "failed" });
    mockFindUnique.mockResolvedValue(task);
    mockDelete.mockResolvedValue(task);

    const { status } = await callDelete("43");

    expect(status).toBe(200);
    expect(mockRm).toHaveBeenCalled();
    expect(mockDelete).toHaveBeenCalledWith({ where: { id: 43 } });
  });

  it("does not delete files when cancelling a pending task", async () => {
    const task = makeTask({ id: 44, status: "pending" });
    mockFindUnique.mockResolvedValue(task);
    mockUpdate.mockResolvedValue({ ...task, status: "cancelled" });

    const { status, body } = await callDelete("44");

    expect(status).toBe(200);
    expect(body.data.cancelled).toBe(true);
    // rm should NOT be called for cancellation (only for permanent delete)
    expect(mockRm).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
  });
});
