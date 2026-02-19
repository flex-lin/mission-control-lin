import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";

/**
 * Tests for Knowledge Base CRUD API endpoints:
 *   GET    /api/knowledge-base       — list all entries (DB only)
 *   POST   /api/knowledge-base       — add a path
 *   PATCH  /api/knowledge-base/[id]  — update an entry
 *   DELETE /api/knowledge-base/[id]  — remove an entry
 *
 * The GET route returns only DB IndexedProject records — it does NOT
 * auto-populate from ~/.claude/projects/ filesystem entries.
 */

// ── Mock Prisma DB ───────────────────────────────────────────────────────────

const mockFindMany = vi.fn();
const mockFindUnique = vi.fn();
const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    indexedProject: {
      findMany: (...args: unknown[]) => mockFindMany(...args),
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
      create: (...args: unknown[]) => mockCreate(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
      delete: (...args: unknown[]) => mockDelete(...args),
    },
  },
}));

// ── Test data helpers ────────────────────────────────────────────────────────

let tmpDir: string;

function makeDbRecord(overrides: Record<string, unknown>) {
  return {
    id: 1,
    path: "/home/user/project",
    name: "project",
    tags: "[]",
    lastScanned: null,
    ...overrides,
  };
}

function makeRequest(urlPath: string, init?: RequestInit) {
  return new NextRequest(
    new URL(urlPath, "http://localhost:31777"),
    init as ConstructorParameters<typeof NextRequest>[1]
  );
}

async function callListGET() {
  vi.resetModules();
  const mod = await import("@/app/api/knowledge-base/route");
  const res = await mod.GET();
  return { status: res.status, body: await res.json() };
}

async function callPOST(body: Record<string, unknown>) {
  vi.resetModules();
  const mod = await import("@/app/api/knowledge-base/route");
  const req = makeRequest("/api/knowledge-base", {
    method: "POST",
    body: JSON.stringify(body),
  });
  const res = await mod.POST(req);
  return { status: res.status, body: await res.json() };
}

async function callPATCH(id: string, body: Record<string, unknown>) {
  vi.resetModules();
  const mod = await import("@/app/api/knowledge-base/[id]/route");
  const req = makeRequest(`/api/knowledge-base/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  const res = await mod.PATCH(req, { params: Promise.resolve({ id }) });
  return { status: res.status, body: await res.json() };
}

async function callDELETE(id: string) {
  vi.resetModules();
  const mod = await import("@/app/api/knowledge-base/[id]/route");
  const req = makeRequest(`/api/knowledge-base/${id}`, {
    method: "DELETE",
  });
  const res = await mod.DELETE(req, { params: Promise.resolve({ id }) });
  return { status: res.status, body: await res.json() };
}

// ── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-kb-test-"));
});

// ── GET /api/knowledge-base — list all entries ──────────────────────────────

describe("GET /api/knowledge-base", () => {
  it("returns empty list when no entries exist", async () => {
    mockFindMany.mockResolvedValue([]);

    const { status, body } = await callListGET();

    expect(status).toBe(200);
    expect(body.data).toEqual([]);
    expect(body.meta.count).toBe(0);
  });

  it("returns DB entries with proper structure", async () => {
    mockFindMany.mockResolvedValue([
      makeDbRecord({ id: 1, path: "/home/user/alpha", name: "alpha", tags: '["ts"]' }),
      makeDbRecord({ id: 2, path: "/home/user/beta", name: "beta", tags: "[]" }),
    ]);

    const { status, body } = await callListGET();

    expect(status).toBe(200);
    expect(body.data).toHaveLength(2);
    expect(body.data[0]).toMatchObject({
      id: 1,
      path: "/home/user/alpha",
      name: "alpha",
      tags: ["ts"],
      source: "db",
    });
    expect(body.data[1]).toMatchObject({
      id: 2,
      path: "/home/user/beta",
      name: "beta",
      tags: [],
      source: "db",
    });
  });

  it("does NOT include filesystem projects from ~/.claude/projects/", async () => {
    // DB is empty — no filesystem auto-population should occur
    mockFindMany.mockResolvedValue([]);

    const { status, body } = await callListGET();

    expect(status).toBe(200);
    expect(body.data).toHaveLength(0);
  });

  it("returns only DB entries when both DB and filesystem projects exist", async () => {
    // DB has one entry; filesystem would have others but they should NOT appear
    mockFindMany.mockResolvedValue([
      makeDbRecord({ id: 5, path: "/home/user/dbproject", name: "dbproject", tags: "[]" }),
    ]);

    const { status, body } = await callListGET();

    expect(status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({ id: 5, source: "db" });
  });

  it("all returned entries have source='db'", async () => {
    mockFindMany.mockResolvedValue([
      makeDbRecord({ id: 1, path: "/a", name: "a" }),
      makeDbRecord({ id: 2, path: "/b", name: "b" }),
    ]);

    const { status, body } = await callListGET();

    expect(status).toBe(200);
    for (const entry of body.data) {
      expect(entry.source).toBe("db");
    }
  });
});

// ── POST /api/knowledge-base — add a path ───────────────────────────────────

describe("POST /api/knowledge-base", () => {
  it("adds a valid path and returns 201 with entry data", async () => {
    // Create a real directory to pass fs.existsSync + stat checks
    const testDir = path.join(tmpDir, "myproject");
    fs.mkdirSync(testDir, { recursive: true });

    mockFindUnique.mockResolvedValue(null); // no duplicate
    mockCreate.mockResolvedValue(
      makeDbRecord({ id: 10, path: testDir, name: "myproject", tags: '["test"]' })
    );

    const { status, body } = await callPOST({
      path: testDir,
      name: "myproject",
      tags: ["test"],
    });

    expect(status).toBe(201);
    expect(body.data).toMatchObject({
      id: 10,
      path: testDir,
      name: "myproject",
      tags: ["test"],
    });
    expect(mockCreate).toHaveBeenCalledOnce();
  });

  it("derives name from folder when not provided", async () => {
    const testDir = path.join(tmpDir, "auto-named");
    fs.mkdirSync(testDir, { recursive: true });

    mockFindUnique.mockResolvedValue(null);
    mockCreate.mockResolvedValue(
      makeDbRecord({ id: 11, path: testDir, name: "auto-named", tags: "[]" })
    );

    const { status } = await callPOST({ path: testDir });

    expect(status).toBe(201);
    // Check that create was called with derived name
    const createArgs = mockCreate.mock.calls[0][0];
    expect(createArgs.data.name).toBe("auto-named");
  });

  it("returns 409 for duplicate path", async () => {
    const testDir = path.join(tmpDir, "dup");
    fs.mkdirSync(testDir, { recursive: true });

    mockFindUnique.mockResolvedValue(
      makeDbRecord({ id: 1, path: testDir })
    );

    const { status, body } = await callPOST({ path: testDir });

    expect(status).toBe(409);
    expect(body.code).toBe("DUPLICATE_PATH");
    expect(body.error).toContain("already exists");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("returns 400 for non-existent path", async () => {
    const fakePath = path.join(tmpDir, "does-not-exist");
    mockFindUnique.mockResolvedValue(null);

    const { status, body } = await callPOST({ path: fakePath });

    expect(status).toBe(400);
    expect(body.code).toBe("PATH_NOT_FOUND");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("returns 400 when path is a file (not a directory)", async () => {
    const filePath = path.join(tmpDir, "notadir.txt");
    fs.writeFileSync(filePath, "hello");
    mockFindUnique.mockResolvedValue(null);

    const { status, body } = await callPOST({ path: filePath });

    expect(status).toBe(400);
    expect(body.code).toBe("NOT_A_DIRECTORY");
  });

  it("returns 400 when path is missing", async () => {
    const { status, body } = await callPOST({});

    expect(status).toBe(400);
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(body.error).toContain("path is required");
  });

  it("returns 400 when path is empty string", async () => {
    const { status, body } = await callPOST({ path: "" });

    expect(status).toBe(400);
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("defaults tags to empty array when not provided", async () => {
    const testDir = path.join(tmpDir, "no-tags");
    fs.mkdirSync(testDir, { recursive: true });

    mockFindUnique.mockResolvedValue(null);
    mockCreate.mockResolvedValue(
      makeDbRecord({ id: 12, path: testDir, name: "no-tags", tags: "[]" })
    );

    await callPOST({ path: testDir });

    const createArgs = mockCreate.mock.calls[0][0];
    expect(createArgs.data.tags).toBe("[]");
  });
});

// ── PATCH /api/knowledge-base/[id] — update an entry ────────────────────────

describe("PATCH /api/knowledge-base/[id]", () => {
  it("updates name and returns 200 with updated entry", async () => {
    mockFindUnique.mockResolvedValue(
      makeDbRecord({ id: 1, path: "/home/user/proj", name: "proj", tags: "[]" })
    );
    mockUpdate.mockResolvedValue(
      makeDbRecord({ id: 1, path: "/home/user/proj", name: "renamed", tags: "[]" })
    );

    const { status, body } = await callPATCH("1", { name: "renamed" });

    expect(status).toBe(200);
    expect(body.data.name).toBe("renamed");
    expect(mockUpdate).toHaveBeenCalledOnce();
  });

  it("updates tags", async () => {
    mockFindUnique.mockResolvedValue(
      makeDbRecord({ id: 1, tags: "[]" })
    );
    mockUpdate.mockResolvedValue(
      makeDbRecord({ id: 1, tags: '["react","ts"]' })
    );

    const { status, body } = await callPATCH("1", { tags: ["react", "ts"] });

    expect(status).toBe(200);
    expect(body.data.tags).toEqual(["react", "ts"]);
  });

  it("updates path when new path exists and is a directory", async () => {
    const newDir = path.join(tmpDir, "newpath");
    fs.mkdirSync(newDir, { recursive: true });

    mockFindUnique
      .mockResolvedValueOnce(makeDbRecord({ id: 1, path: "/old/path" })) // existing lookup
      .mockResolvedValueOnce(null); // duplicate check
    mockUpdate.mockResolvedValue(
      makeDbRecord({ id: 1, path: newDir, name: "newpath", tags: "[]" })
    );

    const { status, body } = await callPATCH("1", { path: newDir });

    expect(status).toBe(200);
    expect(body.data.path).toBe(newDir);
  });

  it("returns 400 when updating path to non-existent directory", async () => {
    mockFindUnique.mockResolvedValue(
      makeDbRecord({ id: 1 })
    );

    const { status, body } = await callPATCH("1", {
      path: "/nonexistent/path",
    });

    expect(status).toBe(400);
    expect(body.code).toBe("PATH_NOT_FOUND");
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("returns 409 when updating path to a duplicate", async () => {
    const newDir = path.join(tmpDir, "duplicate");
    fs.mkdirSync(newDir, { recursive: true });

    mockFindUnique
      .mockResolvedValueOnce(makeDbRecord({ id: 1, path: "/original" }))
      .mockResolvedValueOnce(makeDbRecord({ id: 2, path: newDir })); // duplicate found

    const { status, body } = await callPATCH("1", { path: newDir });

    expect(status).toBe(409);
    expect(body.code).toBe("DUPLICATE_PATH");
  });

  it("returns 404 for non-existent id", async () => {
    mockFindUnique.mockResolvedValue(null);

    const { status, body } = await callPATCH("999", { name: "x" });

    expect(status).toBe(404);
    expect(body.code).toBe("NOT_FOUND");
  });

  it("returns 400 for invalid id", async () => {
    const { status, body } = await callPATCH("abc", { name: "x" });

    expect(status).toBe(400);
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(body.error).toContain("Invalid id");
  });

  it("returns 400 when no fields to update", async () => {
    mockFindUnique.mockResolvedValue(makeDbRecord({ id: 1 }));

    const { status, body } = await callPATCH("1", {});

    expect(status).toBe(400);
    expect(body.error).toContain("No fields to update");
  });

  it("returns 400 when tags is not an array", async () => {
    mockFindUnique.mockResolvedValue(makeDbRecord({ id: 1 }));

    const { status, body } = await callPATCH("1", { tags: "not-array" });

    expect(status).toBe(400);
    expect(body.error).toContain("tags must be an array");
  });

  it("allows keeping the same path (not flagged as duplicate)", async () => {
    const existingPath = path.join(tmpDir, "samepath");
    fs.mkdirSync(existingPath, { recursive: true });

    mockFindUnique.mockResolvedValue(
      makeDbRecord({ id: 1, path: existingPath })
    );
    mockUpdate.mockResolvedValue(
      makeDbRecord({ id: 1, path: existingPath, name: "updated-name", tags: "[]" })
    );

    const { status } = await callPATCH("1", { path: existingPath, name: "updated-name" });

    // Should NOT do a second findUnique for duplicate check since path is the same
    expect(status).toBe(200);
  });
});

// ── DELETE /api/knowledge-base/[id] — remove an entry ────────────────────────

describe("DELETE /api/knowledge-base/[id]", () => {
  it("deletes an existing entry and returns { deleted: true }", async () => {
    mockFindUnique.mockResolvedValue(makeDbRecord({ id: 1 }));
    mockDelete.mockResolvedValue(makeDbRecord({ id: 1 }));

    const { status, body } = await callDELETE("1");

    expect(status).toBe(200);
    expect(body.data).toEqual({ deleted: true });
    expect(mockDelete).toHaveBeenCalledWith({ where: { id: 1 } });
  });

  it("returns 404 for non-existent id", async () => {
    mockFindUnique.mockResolvedValue(null);

    const { status, body } = await callDELETE("999");

    expect(status).toBe(404);
    expect(body.code).toBe("NOT_FOUND");
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid id", async () => {
    const { status, body } = await callDELETE("notanumber");

    expect(status).toBe(400);
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 for id=0 (not a valid DB id)", async () => {
    const { status, body } = await callDELETE("0");

    expect(status).toBe(400);
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("returns 400 for negative id (filesystem hide mechanism removed)", async () => {
    const { status, body } = await callDELETE("-1");

    expect(status).toBe(400);
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(mockDelete).not.toHaveBeenCalled();
  });
});
