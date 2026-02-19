import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * End-to-end tests: Task rerun after failed/cancelled preserves attachments.
 *
 * When a queued task fails or is cancelled and is retried via POST /api/queue/{id},
 * the attachments field must NOT be cleared — files on disk and metadata in the DB
 * should survive the retry cycle.
 *
 * Coverage:
 * 1. POST /api/queue/{id} (retry) preserves attachments for failed tasks
 * 2. POST /api/queue/{id} (retry) preserves attachments for cancelled tasks
 * 3. POST /api/queue/{id} (retry) preserves attachments for stuck running tasks
 * 4. POST /api/queue/{id} (retry) resets other fields but NOT attachments
 * 5. DELETE /api/queue/{id} on pending/running (cancel) does NOT delete files
 * 6. DELETE /api/queue/{id} on completed/failed (permanent delete) DOES delete files
 * 7. Upload still works after retry (attachment accumulation)
 * 8. Full lifecycle: create → upload → fail → retry → upload more → complete
 */

// ── Mock Prisma DB ─────────────────────────────────────────────────────────

const mockFindUnique = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();
const mockCreate = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    queuedTask: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
      delete: (...args: unknown[]) => mockDelete(...args),
      create: (...args: unknown[]) => mockCreate(...args),
    },
  },
}));

// ── Mock fs ────────────────────────────────────────────────────────────────

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
  listTeamSessionsAsync: vi.fn(async () => []),
  killSessionAsync: vi.fn(async () => {}),
}));

// ── Test Data ──────────────────────────────────────────────────────────────

const SAMPLE_ATTACHMENTS = [
  {
    filename: "1700000000000-screenshot.png",
    originalName: "screenshot.png",
    mimeType: "image/png",
    size: 50000,
  },
  {
    filename: "1700000001000-design.pdf",
    originalName: "design.pdf",
    mimeType: "application/pdf",
    size: 120000,
  },
];

function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    goal: "Implement feature X",
    projectPath: "/home/user/project",
    status: "pending",
    teamName: null,
    priority: 0,
    result: null,
    attachments: "[]",
    teamMembers: "[]",
    createdAt: new Date("2026-01-15").toISOString(),
    startedAt: null,
    completedAt: null,
    ...overrides,
  };
}

function makeFile(name: string, type: string, sizeBytes = 100): File {
  const content = new Uint8Array(sizeBytes);
  return new File([content], name, { type });
}

// ── Helpers ────────────────────────────────────────────────────────────────

async function callRetry(id: string) {
  vi.resetModules();
  const mod = await import("@/app/api/queue/[id]/route");
  const req = new NextRequest(
    new URL(`/api/queue/${id}`, "http://localhost:31777"),
    { method: "POST" }
  );
  const res = await mod.POST(req, { params: Promise.resolve({ id }) });
  return { status: res.status, body: await res.json() };
}

async function callDelete(id: string) {
  vi.resetModules();
  const mod = await import("@/app/api/queue/[id]/route");
  const req = new NextRequest(
    new URL(`/api/queue/${id}`, "http://localhost:31777"),
    { method: "DELETE" }
  );
  const res = await mod.DELETE(req, { params: Promise.resolve({ id }) });
  return { status: res.status, body: await res.json() };
}

async function callUpload(taskId: string, formData: FormData) {
  vi.resetModules();
  const mod = await import("@/app/api/queue/upload/route");
  const req = new NextRequest(
    new URL(`/api/queue/upload?taskId=${taskId}`, "http://localhost:31777"),
    { method: "POST", body: formData }
  );
  const res = await mod.POST(req);
  return { status: res.status, body: await res.json() };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("Task Rerun Preserves Attachments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. Retry preserves attachments for FAILED tasks
  // ═══════════════════════════════════════════════════════════════════════════

  describe("retry failed task", () => {
    it("preserves attachments when retrying a failed task", async () => {
      const task = makeTask({
        id: 10,
        status: "failed",
        result: "Build error: type mismatch",
        teamName: "q-10-feature",
        attachments: JSON.stringify(SAMPLE_ATTACHMENTS),
        startedAt: new Date("2026-01-15T10:00:00Z").toISOString(),
        completedAt: new Date("2026-01-15T10:30:00Z").toISOString(),
      });
      mockFindUnique.mockResolvedValue(task);

      const updatedTask = {
        ...task,
        status: "pending",
        teamName: null,
        result: null,
        startedAt: null,
        completedAt: null,
        // attachments remain unchanged
      };
      mockUpdate.mockResolvedValue(updatedTask);

      const { status, body } = await callRetry("10");

      expect(status).toBe(200);

      // Verify the update call did NOT include attachments in data
      const updateCall = mockUpdate.mock.calls[0][0];
      expect(updateCall.data).not.toHaveProperty("attachments");

      // Verify other fields were reset
      expect(updateCall.data.status).toBe("pending");
      expect(updateCall.data.teamName).toBeNull();
      expect(updateCall.data.result).toBeNull();
      expect(updateCall.data.startedAt).toBeNull();
      expect(updateCall.data.completedAt).toBeNull();
    });

    it("does not delete attachment files from disk on retry", async () => {
      const task = makeTask({
        id: 11,
        status: "failed",
        attachments: JSON.stringify(SAMPLE_ATTACHMENTS),
      });
      mockFindUnique.mockResolvedValue(task);
      mockUpdate.mockResolvedValue({ ...task, status: "pending" });

      await callRetry("11");

      // rm should NOT be called during retry
      expect(mockRm).not.toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. Retry preserves attachments for CANCELLED tasks
  // ═══════════════════════════════════════════════════════════════════════════

  describe("retry cancelled task", () => {
    it("preserves attachments when retrying a cancelled task", async () => {
      const task = makeTask({
        id: 20,
        status: "cancelled",
        attachments: JSON.stringify(SAMPLE_ATTACHMENTS),
        completedAt: new Date("2026-01-15T11:00:00Z").toISOString(),
      });
      mockFindUnique.mockResolvedValue(task);
      mockUpdate.mockResolvedValue({
        ...task,
        status: "pending",
        teamName: null,
        result: null,
        startedAt: null,
        completedAt: null,
      });

      const { status } = await callRetry("20");
      expect(status).toBe(200);

      const updateCall = mockUpdate.mock.calls[0][0];
      expect(updateCall.data).not.toHaveProperty("attachments");
      expect(updateCall.data.status).toBe("pending");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. Retry preserves attachments for STUCK RUNNING tasks
  // ═══════════════════════════════════════════════════════════════════════════

  describe("retry stuck running task", () => {
    it("preserves attachments when retrying a stuck running task", async () => {
      const task = makeTask({
        id: 30,
        status: "running",
        teamName: "q-30-stuck",
        attachments: JSON.stringify(SAMPLE_ATTACHMENTS),
        startedAt: new Date("2026-01-15T08:00:00Z").toISOString(),
      });
      mockFindUnique.mockResolvedValue(task);
      mockUpdate.mockResolvedValue({
        ...task,
        status: "pending",
        teamName: null,
        result: null,
        startedAt: null,
        completedAt: null,
      });

      const { status } = await callRetry("30");
      expect(status).toBe(200);

      const updateCall = mockUpdate.mock.calls[0][0];
      expect(updateCall.data).not.toHaveProperty("attachments");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. Retry resets correct fields only
  // ═══════════════════════════════════════════════════════════════════════════

  describe("field reset correctness", () => {
    it("resets status, teamName, result, startedAt, completedAt but nothing else", async () => {
      const task = makeTask({
        id: 40,
        status: "failed",
        goal: "Deploy to production",
        projectPath: "/home/user/deploy",
        teamName: "q-40-deploy",
        priority: 2,
        result: "Timeout after 5 minutes",
        attachments: JSON.stringify(SAMPLE_ATTACHMENTS),
        teamMembers: JSON.stringify([{ name: "dev", role: "Developer" }]),
        startedAt: new Date("2026-01-15T12:00:00Z").toISOString(),
        completedAt: new Date("2026-01-15T12:05:00Z").toISOString(),
      });
      mockFindUnique.mockResolvedValue(task);
      mockUpdate.mockResolvedValue({ ...task, status: "pending" });

      await callRetry("40");

      const updateData = mockUpdate.mock.calls[0][0].data;

      // These fields MUST be reset
      expect(updateData.status).toBe("pending");
      expect(updateData.teamName).toBeNull();
      expect(updateData.result).toBeNull();
      expect(updateData.startedAt).toBeNull();
      expect(updateData.completedAt).toBeNull();

      // These fields MUST NOT be touched (preserved implicitly)
      expect(updateData).not.toHaveProperty("goal");
      expect(updateData).not.toHaveProperty("projectPath");
      expect(updateData).not.toHaveProperty("priority");
      expect(updateData).not.toHaveProperty("attachments");
      expect(updateData).not.toHaveProperty("teamMembers");
      expect(updateData).not.toHaveProperty("createdAt");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. Retry rejects invalid states
  // ═══════════════════════════════════════════════════════════════════════════

  describe("retry state validation", () => {
    it("rejects retry of a pending task", async () => {
      const task = makeTask({ id: 50, status: "pending" });
      mockFindUnique.mockResolvedValue(task);

      const { status, body } = await callRetry("50");
      expect(status).toBe(400);
      expect(body.code).toBe("INVALID_STATE");
    });

    it("rejects retry of a completed task", async () => {
      const task = makeTask({ id: 51, status: "completed" });
      mockFindUnique.mockResolvedValue(task);

      const { status, body } = await callRetry("51");
      expect(status).toBe(400);
      expect(body.code).toBe("INVALID_STATE");
    });

    it("returns 404 for non-existent task", async () => {
      mockFindUnique.mockResolvedValue(null);

      const { status } = await callRetry("999");
      expect(status).toBe(404);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 6. Cancel (DELETE pending/running) does NOT delete files
  // ═══════════════════════════════════════════════════════════════════════════

  describe("cancel preserves files for future retry", () => {
    it("cancelling a pending task does not delete upload directory", async () => {
      const task = makeTask({
        id: 60,
        status: "pending",
        attachments: JSON.stringify(SAMPLE_ATTACHMENTS),
      });
      mockFindUnique.mockResolvedValue(task);
      mockUpdate.mockResolvedValue({ ...task, status: "cancelled" });

      const { status, body } = await callDelete("60");

      expect(status).toBe(200);
      expect(body.data.cancelled).toBe(true);
      expect(mockRm).not.toHaveBeenCalled();
      expect(mockDelete).not.toHaveBeenCalled();
    });

    it("cancelling a running task does not delete upload directory", async () => {
      const task = makeTask({
        id: 61,
        status: "running",
        teamName: "q-61-running",
        attachments: JSON.stringify(SAMPLE_ATTACHMENTS),
      });
      mockFindUnique.mockResolvedValue(task);
      mockUpdate.mockResolvedValue({ ...task, status: "cancelled" });

      const { status, body } = await callDelete("61");

      expect(status).toBe(200);
      expect(body.data.cancelled).toBe(true);
      expect(mockRm).not.toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 7. Permanent delete DOES clean up files
  // ═══════════════════════════════════════════════════════════════════════════

  describe("permanent delete cleans up files", () => {
    it("deleting a completed task removes upload directory", async () => {
      const task = makeTask({
        id: 70,
        status: "completed",
        attachments: JSON.stringify(SAMPLE_ATTACHMENTS),
      });
      mockFindUnique.mockResolvedValue(task);
      mockDelete.mockResolvedValue(task);

      const { status, body } = await callDelete("70");

      expect(status).toBe(200);
      expect(body.data.deleted).toBe(true);
      expect(mockRm).toHaveBeenCalledWith(
        expect.stringContaining("70"),
        { recursive: true, force: true }
      );
      expect(mockDelete).toHaveBeenCalledWith({ where: { id: 70 } });
    });

    it("deleting a failed task removes upload directory", async () => {
      const task = makeTask({ id: 71, status: "failed" });
      mockFindUnique.mockResolvedValue(task);
      mockDelete.mockResolvedValue(task);

      await callDelete("71");

      expect(mockRm).toHaveBeenCalled();
      expect(mockDelete).toHaveBeenCalled();
    });

    it("deleting a cancelled task removes upload directory", async () => {
      const task = makeTask({ id: 72, status: "cancelled" });
      mockFindUnique.mockResolvedValue(task);
      mockDelete.mockResolvedValue(task);

      await callDelete("72");

      expect(mockRm).toHaveBeenCalled();
      expect(mockDelete).toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 8. Upload works after retry (attachment accumulation)
  // ═══════════════════════════════════════════════════════════════════════════

  describe("upload after retry", () => {
    it("can upload new files to a retried task that already has attachments", async () => {
      // Task was failed with 2 attachments, then retried (status=pending, attachments kept)
      const task = makeTask({
        id: 80,
        status: "pending",
        attachments: JSON.stringify(SAMPLE_ATTACHMENTS),
      });
      mockFindUnique.mockResolvedValue(task);

      const combined = [
        ...SAMPLE_ATTACHMENTS,
        {
          filename: expect.any(String),
          originalName: "new-screenshot.png",
          mimeType: "image/png",
          size: 100,
        },
      ];
      mockUpdate.mockResolvedValue({
        ...task,
        attachments: JSON.stringify(combined),
      });

      const form = new FormData();
      form.append("files", makeFile("new-screenshot.png", "image/png"));

      const { status, body } = await callUpload("80", form);

      expect(status).toBe(200);
      // The update should include both old and new attachments
      const updateCall = mockUpdate.mock.calls[0][0];
      const savedAttachments = JSON.parse(updateCall.data.attachments);
      expect(savedAttachments).toHaveLength(3);
      // First two are the original attachments
      expect(savedAttachments[0].originalName).toBe("screenshot.png");
      expect(savedAttachments[1].originalName).toBe("design.pdf");
      // Third is the new one
      expect(savedAttachments[2].originalName).toBe("new-screenshot.png");
    });

    it("respects max file limit including pre-existing attachments from before retry", async () => {
      // Task has 4 attachments from before the retry
      const fourAttachments = Array.from({ length: 4 }, (_, i) => ({
        filename: `${1700000000000 + i}-file${i}.png`,
        originalName: `file${i}.png`,
        mimeType: "image/png",
        size: 1000,
      }));
      const task = makeTask({
        id: 81,
        status: "pending",
        attachments: JSON.stringify(fourAttachments),
      });
      mockFindUnique.mockResolvedValue(task);

      // Try to upload 2 more (would exceed limit of 5)
      const form = new FormData();
      form.append("files", makeFile("extra1.png", "image/png"));
      form.append("files", makeFile("extra2.png", "image/png"));

      const { status, body } = await callUpload("81", form);

      expect(status).toBe(400);
      expect(body.code).toBe("VALIDATION_ERROR");
      expect(body.error).toContain("Max 5");
    });

    it("allows uploading up to the remaining slot count", async () => {
      // Task has 3 attachments, can add 2 more
      const threeAttachments = Array.from({ length: 3 }, (_, i) => ({
        filename: `${1700000000000 + i}-file${i}.png`,
        originalName: `file${i}.png`,
        mimeType: "image/png",
        size: 1000,
      }));
      const task = makeTask({
        id: 82,
        status: "pending",
        attachments: JSON.stringify(threeAttachments),
      });
      mockFindUnique.mockResolvedValue(task);
      mockUpdate.mockResolvedValue(task);

      const form = new FormData();
      form.append("files", makeFile("extra1.png", "image/png"));
      form.append("files", makeFile("extra2.png", "image/png"));

      const { status } = await callUpload("82", form);
      expect(status).toBe(200);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 9. Full lifecycle: create → upload → fail → retry → verify attachments
  // ═══════════════════════════════════════════════════════════════════════════

  describe("full lifecycle", () => {
    it("attachments survive the complete create → upload → fail → retry cycle", async () => {
      // Step 1: Task exists with attachments, in failed state
      const failedTask = makeTask({
        id: 90,
        status: "failed",
        teamName: "q-90-feature",
        result: "Tests failed: 3 errors",
        attachments: JSON.stringify(SAMPLE_ATTACHMENTS),
        startedAt: new Date("2026-01-15T10:00:00Z").toISOString(),
        completedAt: new Date("2026-01-15T10:45:00Z").toISOString(),
      });

      // Step 2: Retry the task
      mockFindUnique.mockResolvedValue(failedTask);
      const retriedTask = {
        ...failedTask,
        status: "pending",
        teamName: null,
        result: null,
        startedAt: null,
        completedAt: null,
        // attachments field preserved
      };
      mockUpdate.mockResolvedValue(retriedTask);

      const retryResult = await callRetry("90");
      expect(retryResult.status).toBe(200);

      // Verify the DB update preserved attachments
      const retryUpdateData = mockUpdate.mock.calls[0][0].data;
      expect(retryUpdateData).not.toHaveProperty("attachments");
      expect(retryUpdateData.status).toBe("pending");
      expect(retryUpdateData.teamName).toBeNull();

      // Step 3: Verify the retried task still has its attachments
      // (simulated by checking the returned object)
      const returnedTask = retryResult.body.data;
      expect(returnedTask.attachments).toBe(JSON.stringify(SAMPLE_ATTACHMENTS));
    });

    it("task with no attachments can be retried cleanly", async () => {
      const failedTask = makeTask({
        id: 91,
        status: "failed",
        teamName: "q-91-empty",
        result: "Compilation error",
        attachments: "[]",
      });
      mockFindUnique.mockResolvedValue(failedTask);
      mockUpdate.mockResolvedValue({
        ...failedTask,
        status: "pending",
        teamName: null,
        result: null,
      });

      const { status } = await callRetry("91");
      expect(status).toBe(200);

      const updateData = mockUpdate.mock.calls[0][0].data;
      expect(updateData).not.toHaveProperty("attachments");
    });
  });
});
