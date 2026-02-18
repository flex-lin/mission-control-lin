import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";

/**
 * End-to-end tests for the Knowledge Base feature:
 *
 * 1. GET  /api/projects/[id] — numeric ID lookup (Strategy 1: direct DB by id)
 * 2. GET  /api/projects/[id] — path-encoded ID fallback (Strategies 2-4)
 * 3. DELETE /api/knowledge-base/[id] — DB entries (id > 0)
 * 4. DELETE /api/knowledge-base/-1?path= — hide filesystem-only entries
 * 5. GET  /api/knowledge-base — hidden paths filtering
 * 6. Full lifecycle: add → view detail → remove → verify gone
 * 7. Error cases (not found, invalid ID, path traversal)
 */

// ── Mock Prisma DB ───────────────────────────────────────────────────────────

const mockFindMany = vi.fn();
const mockFindUnique = vi.fn();
const mockFindFirst = vi.fn();
const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();
const mockUpsert = vi.fn();

const mockPrefFindUnique = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    indexedProject: {
      findMany: (...args: unknown[]) => mockFindMany(...args),
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
      findFirst: (...args: unknown[]) => mockFindFirst(...args),
      create: (...args: unknown[]) => mockCreate(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
      delete: (...args: unknown[]) => mockDelete(...args),
    },
    preference: {
      findUnique: (...args: unknown[]) => mockPrefFindUnique(...args),
      upsert: (...args: unknown[]) => mockUpsert(...args),
    },
  },
}));

// ── Mock claude-files ────────────────────────────────────────────────────────

const mockListProjects = vi.fn();
const mockReadProjectContext = vi.fn();

vi.mock("@/lib/claude-files", () => ({
  listProjects: (...args: unknown[]) => mockListProjects(...args),
  readProjectContext: (...args: unknown[]) => mockReadProjectContext(...args),
}));

// ── Test helpers ─────────────────────────────────────────────────────────────

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
    new URL(urlPath, "http://localhost:3777"),
    init
  );
}

async function callListGET() {
  vi.resetModules();
  const mod = await import("@/app/api/knowledge-base/route");
  const res = await mod.GET();
  return { status: res.status, body: await res.json() };
}

async function callDELETE(id: string, queryPath?: string) {
  vi.resetModules();
  const mod = await import("@/app/api/knowledge-base/[id]/route");
  const url = queryPath
    ? `/api/knowledge-base/${id}?path=${encodeURIComponent(queryPath)}`
    : `/api/knowledge-base/${id}`;
  const req = makeRequest(url, { method: "DELETE" });
  const res = await mod.DELETE(req, { params: Promise.resolve({ id }) });
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

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-kb-e2e-"));
  mockListProjects.mockReturnValue([]);
  mockPrefFindUnique.mockResolvedValue(null);
});

// ═══════════════════════════════════════════════════════════════════════════════
// 1. DELETE filesystem-only entries (id = -1, hidden paths)
// ═══════════════════════════════════════════════════════════════════════════════

describe("DELETE /api/knowledge-base/-1 (filesystem entries)", () => {
  it("hides a filesystem entry by adding to kb_hidden_paths preference", async () => {
    mockPrefFindUnique.mockResolvedValue(null); // no existing hidden paths

    const { status, body } = await callDELETE("-1", "/home/user/fsproject");

    expect(status).toBe(200);
    expect(body.data).toEqual({ deleted: true });
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: "kb_hidden_paths" },
        create: expect.objectContaining({
          key: "kb_hidden_paths",
          value: JSON.stringify(["/home/user/fsproject"]),
        }),
        update: expect.objectContaining({
          value: JSON.stringify(["/home/user/fsproject"]),
        }),
      })
    );
  });

  it("appends to existing hidden paths without duplicating", async () => {
    mockPrefFindUnique.mockResolvedValue({
      key: "kb_hidden_paths",
      value: JSON.stringify(["/already/hidden"]),
    });

    const { status } = await callDELETE("-1", "/home/user/newpath");

    expect(status).toBe(200);
    const upsertCall = mockUpsert.mock.calls[0][0];
    const hiddenList = JSON.parse(upsertCall.update.value);
    expect(hiddenList).toContain("/already/hidden");
    expect(hiddenList).toContain("/home/user/newpath");
    expect(hiddenList).toHaveLength(2);
  });

  it("does not duplicate an already-hidden path", async () => {
    const existingPath = "/home/user/already";
    mockPrefFindUnique.mockResolvedValue({
      key: "kb_hidden_paths",
      value: JSON.stringify([existingPath]),
    });

    const { status } = await callDELETE("-1", existingPath);

    expect(status).toBe(200);
    const upsertCall = mockUpsert.mock.calls[0][0];
    const hiddenList = JSON.parse(upsertCall.update.value);
    expect(hiddenList).toEqual([existingPath]);
  });

  it("returns 400 when id=-1 but no path query param", async () => {
    const { status, body } = await callDELETE("-1");

    expect(status).toBe(400);
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(body.error).toContain("path query param required");
    expect(mockUpsert).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. Hidden paths filtering in GET listing
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /api/knowledge-base — hidden paths filtering", () => {
  it("excludes filesystem entries whose paths are in kb_hidden_paths", async () => {
    mockFindMany.mockResolvedValue([]);
    mockListProjects.mockReturnValue([
      { id: "-home-user-visible", path: "/home/user/visible", name: "visible" },
      { id: "-home-user-hidden", path: "/home/user/hidden", name: "hidden" },
    ]);
    mockPrefFindUnique.mockResolvedValue({
      key: "kb_hidden_paths",
      value: JSON.stringify(["/home/user/hidden"]),
    });

    const { status, body } = await callListGET();

    expect(status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].path).toBe("/home/user/visible");
  });

  it("does not hide DB entries (only filesystem-only entries are filtered)", async () => {
    mockFindMany.mockResolvedValue([
      makeDbRecord({ id: 1, path: "/home/user/dbproject", name: "dbproject" }),
    ]);
    mockListProjects.mockReturnValue([]);
    mockPrefFindUnique.mockResolvedValue({
      key: "kb_hidden_paths",
      value: JSON.stringify(["/home/user/dbproject"]),
    });

    const { status, body } = await callListGET();

    expect(status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].path).toBe("/home/user/dbproject");
    expect(body.data[0].source).toBe("db");
  });

  it("shows all filesystem entries when no hidden paths preference exists", async () => {
    mockFindMany.mockResolvedValue([]);
    mockListProjects.mockReturnValue([
      { id: "-home-user-a", path: "/home/user/a", name: "a" },
      { id: "-home-user-b", path: "/home/user/b", name: "b" },
    ]);
    mockPrefFindUnique.mockResolvedValue(null);

    const { status, body } = await callListGET();

    expect(status).toBe(200);
    expect(body.data).toHaveLength(2);
  });

  it("handles malformed kb_hidden_paths gracefully (treats as empty)", async () => {
    mockFindMany.mockResolvedValue([]);
    mockListProjects.mockReturnValue([
      { id: "-home-user-proj", path: "/home/user/proj", name: "proj" },
    ]);
    mockPrefFindUnique.mockResolvedValue({
      key: "kb_hidden_paths",
      value: "not-valid-json",
    });

    const { status, body } = await callListGET();

    expect(status).toBe(200);
    expect(body.data).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. GET /api/projects/[id] — numeric ID lookup (Strategy 1)
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /api/projects/[id] — numeric ID", () => {
  async function callProjectGET(id: string) {
    vi.resetModules();
    const mod = await import("@/app/api/projects/[id]/route");
    const req = makeRequest(`/api/projects/${encodeURIComponent(id)}`);
    const res = await mod.GET(req, { params: Promise.resolve({ id }) });
    return { status: res.status, body: await res.json() };
  }

  it("looks up project by numeric DB id and returns detail", async () => {
    const projDir = path.join(tmpDir, "numericproj");
    fs.mkdirSync(projDir, { recursive: true });
    fs.writeFileSync(path.join(projDir, "CLAUDE.md"), "# Numeric Lookup");

    mockFindUnique.mockResolvedValue(
      makeDbRecord({ id: 42, path: projDir, name: "numericproj", tags: '["react"]' })
    );

    const { status, body } = await callProjectGET("42");

    expect(status).toBe(200);
    expect(body.data.id).toBe("42");
    expect(body.data.name).toBe("numericproj");
    expect(body.data.path).toBe(projDir);
    expect(body.data.tags).toEqual(["react"]);
    expect(body.data.claudeMd).toBe("# Numeric Lookup");
    expect(body.data.fileTree).toBeDefined();
    // Should use findUnique with numeric id — not findFirst or listProjects
    expect(mockFindUnique).toHaveBeenCalledWith({ where: { id: 42 } });
    expect(mockListProjects).not.toHaveBeenCalled();
    expect(mockFindFirst).not.toHaveBeenCalled();
  });

  it("returns file tree for a project with nested directories", async () => {
    const projDir = path.join(tmpDir, "withtree");
    fs.mkdirSync(path.join(projDir, "src", "components"), { recursive: true });
    fs.writeFileSync(path.join(projDir, "src", "index.ts"), "");
    fs.writeFileSync(path.join(projDir, "src", "components", "App.tsx"), "");

    mockFindUnique.mockResolvedValue(
      makeDbRecord({ id: 7, path: projDir, name: "withtree", tags: "[]" })
    );

    const { status, body } = await callProjectGET("7");

    expect(status).toBe(200);
    expect(body.data.fileTree).toContain("src/");
  });

  it("returns 404 when numeric id does not exist in DB", async () => {
    mockFindUnique.mockResolvedValue(null);

    const { status, body } = await callProjectGET("999");

    expect(status).toBe(404);
    expect(body.code).toBe("NOT_FOUND");
    expect(body.error).toContain("999");
  });

  it("returns empty CLAUDE.md when project dir has none", async () => {
    const projDir = path.join(tmpDir, "no-claude-md");
    fs.mkdirSync(projDir, { recursive: true });
    // No CLAUDE.md created

    mockFindUnique.mockResolvedValue(
      makeDbRecord({ id: 15, path: projDir, name: "no-claude-md", tags: "[]" })
    );

    const { status, body } = await callProjectGET("15");

    expect(status).toBe(200);
    expect(body.data.claudeMd).toBeUndefined();
  });

  it("does not treat '0' as a numeric id (must be > 0)", async () => {
    // "0" should fall through to path-based strategies, not numeric lookup
    mockListProjects.mockReturnValue([]);
    mockFindFirst.mockResolvedValue(null);

    const { status } = await callProjectGET("0");

    // findUnique should NOT be called for id=0
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  it("does not treat negative numbers as numeric id", async () => {
    mockListProjects.mockReturnValue([]);
    mockFindFirst.mockResolvedValue(null);

    await callProjectGET("-5");

    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  it("does not treat '42abc' as a numeric id", async () => {
    mockListProjects.mockReturnValue([]);
    mockFindFirst.mockResolvedValue(null);

    await callProjectGET("42abc");

    // String(parseInt("42abc")) === "42" !== "42abc", so it should NOT match
    expect(mockFindUnique).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. GET /api/projects/[id] — path-encoded ID fallback (Strategies 2-4)
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /api/projects/[id] — path-encoded ID", () => {
  async function callProjectGET(id: string) {
    vi.resetModules();
    const mod = await import("@/app/api/projects/[id]/route");
    const req = makeRequest(`/api/projects/${encodeURIComponent(id)}`);
    const res = await mod.GET(req, { params: Promise.resolve({ id }) });
    return { status: res.status, body: await res.json() };
  }

  it("returns project detail from filesystem (Strategy 2)", async () => {
    const projDir = path.join(tmpDir, "fsproj");
    fs.mkdirSync(projDir, { recursive: true });
    fs.writeFileSync(path.join(projDir, "CLAUDE.md"), "# FS Project");

    const projectId = "-home-user-fsproj";
    mockListProjects.mockReturnValue([
      { id: projectId, path: projDir, name: "fsproj" },
    ]);
    mockReadProjectContext.mockReturnValue({
      claudeMd: "# FS Project",
      memoryFiles: { "MEMORY.md": "Some memory" },
    });

    const { status, body } = await callProjectGET(projectId);

    expect(status).toBe(200);
    expect(body.data.name).toBe("fsproj");
    expect(body.data.claudeMd).toBe("# FS Project");
    expect(body.data.memoryFiles).toEqual({ "MEMORY.md": "Some memory" });
    expect(Array.isArray(body.data.fileTree)).toBe(true);
  });

  it("falls back to DB by decoded path (Strategy 3)", async () => {
    const projDir = path.join(tmpDir, "dbfallback");
    fs.mkdirSync(projDir, { recursive: true });
    fs.writeFileSync(path.join(projDir, "CLAUDE.md"), "# DB Fallback");

    mockListProjects.mockReturnValue([]);
    const encodedId = projDir.replace(/\//g, "-");
    mockFindFirst.mockResolvedValue(
      makeDbRecord({ id: 42, path: projDir, name: "dbfallback", tags: '["ts"]' })
    );

    const { status, body } = await callProjectGET(encodedId);

    expect(status).toBe(200);
    expect(body.data.name).toBe("dbfallback");
    expect(body.data.tags).toEqual(["ts"]);
    expect(body.data.claudeMd).toBe("# DB Fallback");
  });

  it("returns 404 for non-existent path-encoded project", async () => {
    mockListProjects.mockReturnValue([]);
    mockFindFirst.mockResolvedValue(null);

    const { status, body } = await callProjectGET("-nonexistent-path");

    expect(status).toBe(404);
    expect(body.code).toBe("NOT_FOUND");
  });

  it("prevents path traversal attacks", async () => {
    mockListProjects.mockReturnValue([]);

    const { status } = await callProjectGET("../../etc/passwd");

    expect(status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. Full lifecycle: add → list → delete → verify removed
// ═══════════════════════════════════════════════════════════════════════════════

describe("Knowledge Base full lifecycle", () => {
  it("add project → appears in listing → delete → disappears from listing", async () => {
    const testDir = path.join(tmpDir, "lifecycle");
    fs.mkdirSync(testDir, { recursive: true });

    // Step 1: Add a project
    mockFindUnique.mockResolvedValue(null); // no duplicate
    const newRecord = makeDbRecord({
      id: 50,
      path: testDir,
      name: "lifecycle",
      tags: '["test"]',
    });
    mockCreate.mockResolvedValue(newRecord);

    const addResult = await callPOST({
      path: testDir,
      name: "lifecycle",
      tags: ["test"],
    });

    expect(addResult.status).toBe(201);
    expect(addResult.body.data.id).toBe(50);

    // Step 2: Verify it appears in listing
    mockFindMany.mockResolvedValue([newRecord]);
    mockListProjects.mockReturnValue([]);
    mockPrefFindUnique.mockResolvedValue(null);

    const listResult = await callListGET();

    expect(listResult.status).toBe(200);
    expect(listResult.body.data).toHaveLength(1);
    expect(listResult.body.data[0].path).toBe(testDir);
    expect(listResult.body.data[0].source).toBe("db");

    // Step 3: Delete the project
    mockFindUnique.mockResolvedValue(newRecord);
    mockDelete.mockResolvedValue(newRecord);

    const deleteResult = await callDELETE("50");

    expect(deleteResult.status).toBe(200);
    expect(deleteResult.body.data).toEqual({ deleted: true });

    // Step 4: Verify it's gone from listing
    mockFindMany.mockResolvedValue([]);

    const finalList = await callListGET();

    expect(finalList.status).toBe(200);
    expect(finalList.body.data).toHaveLength(0);
  });

  it("hide filesystem project → verify hidden → still shows if added to DB", async () => {
    const fsPath = "/home/user/fs-only-project";

    // Step 1: Filesystem project visible
    mockFindMany.mockResolvedValue([]);
    mockListProjects.mockReturnValue([
      { id: "-home-user-fs-only-project", path: fsPath, name: "fs-only-project" },
    ]);
    mockPrefFindUnique.mockResolvedValue(null);

    const before = await callListGET();
    expect(before.status).toBe(200);
    expect(before.body.data).toHaveLength(1);
    expect(before.body.data[0].source).toBe("filesystem");

    // Step 2: Hide it
    mockPrefFindUnique.mockResolvedValue(null);
    const hideResult = await callDELETE("-1", fsPath);
    expect(hideResult.status).toBe(200);

    // Step 3: Verify hidden from listing
    mockPrefFindUnique.mockResolvedValue({
      key: "kb_hidden_paths",
      value: JSON.stringify([fsPath]),
    });

    const after = await callListGET();
    expect(after.status).toBe(200);
    expect(after.body.data).toHaveLength(0);

    // Step 4: If the path is added to DB, it shows as "both" (hidden only filters fs-only)
    mockFindMany.mockResolvedValue([
      makeDbRecord({ id: 99, path: fsPath, name: "fs-only-project" }),
    ]);

    const withDb = await callListGET();
    expect(withDb.status).toBe(200);
    expect(withDb.body.data).toHaveLength(1);
    expect(withDb.body.data[0].source).toBe("both");
    expect(withDb.body.data[0].id).toBe(99);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. Edge cases and error handling
// ═══════════════════════════════════════════════════════════════════════════════

describe("Knowledge Base edge cases", () => {
  it("DELETE with id=0 attempts DB deletion (not filesystem hide)", async () => {
    mockFindUnique.mockResolvedValue(null);

    const { status, body } = await callDELETE("0");

    // id=0 is not -1, so it takes the DB deletion path
    expect(status).toBe(404);
    expect(body.code).toBe("NOT_FOUND");
  });

  it("DELETE with negative id other than -1 returns 404", async () => {
    mockFindUnique.mockResolvedValue(null);

    const { status, body } = await callDELETE("-5");

    // -5 !== -1, so it goes to DB path and finds nothing
    expect(status).toBe(404);
    expect(body.code).toBe("NOT_FOUND");
  });

  it("GET listing handles DB error gracefully", async () => {
    mockFindMany.mockRejectedValue(new Error("DB connection failed"));

    const { status, body } = await callListGET();

    expect(status).toBe(500);
    expect(body.code).toBe("SERVER_ERROR");
  });

  it("DELETE with valid DB id deletes and does not touch preferences", async () => {
    const record = makeDbRecord({ id: 10 });
    mockFindUnique.mockResolvedValue(record);
    mockDelete.mockResolvedValue(record);

    const { status, body } = await callDELETE("10");

    expect(status).toBe(200);
    expect(body.data).toEqual({ deleted: true });
    expect(mockUpsert).not.toHaveBeenCalled(); // should NOT touch hidden paths
    expect(mockDelete).toHaveBeenCalledWith({ where: { id: 10 } });
  });
});
