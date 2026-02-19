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
 * 3. DELETE /api/knowledge-base/[id] — DB entries only
 * 4. Full lifecycle: add → view detail → remove → verify gone
 * 5. Error cases (not found, invalid ID, path traversal)
 *
 * The knowledge base API (GET /api/knowledge-base) now returns ONLY DB entries.
 * Filesystem auto-population from ~/.claude/projects/ has been removed so that
 * a fresh clone starts with a blank knowledge base.
 */

// ── Mock Prisma DB ───────────────────────────────────────────────────────────

const mockFindMany = vi.fn();
const mockFindUnique = vi.fn();
const mockFindFirst = vi.fn();
const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();

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
    init as ConstructorParameters<typeof NextRequest>[1]
  );
}

async function callListGET() {
  vi.resetModules();
  const mod = await import("@/app/api/knowledge-base/route");
  const res = await mod.GET();
  return { status: res.status, body: await res.json() };
}

async function callDELETE(id: string) {
  vi.resetModules();
  const mod = await import("@/app/api/knowledge-base/[id]/route");
  const url = `/api/knowledge-base/${id}`;
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
});

// ═══════════════════════════════════════════════════════════════════════════════
// 1. GET /api/knowledge-base — DB-only listing
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /api/knowledge-base — DB-only listing", () => {
  it("returns empty list when DB is empty (no filesystem auto-population)", async () => {
    mockFindMany.mockResolvedValue([]);

    const { status, body } = await callListGET();

    expect(status).toBe(200);
    expect(body.data).toHaveLength(0);
    expect(body.meta.count).toBe(0);
  });

  it("returns DB entries with source='db'", async () => {
    mockFindMany.mockResolvedValue([
      makeDbRecord({ id: 1, path: "/home/user/proj", name: "proj" }),
    ]);

    const { status, body } = await callListGET();

    expect(status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].source).toBe("db");
    expect(body.data[0].id).toBe(1);
  });

  it("handles DB error gracefully", async () => {
    mockFindMany.mockRejectedValue(new Error("DB connection failed"));

    const { status, body } = await callListGET();

    expect(status).toBe(500);
    expect(body.code).toBe("SERVER_ERROR");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. DELETE /api/knowledge-base/[id] — DB entries only
// ═══════════════════════════════════════════════════════════════════════════════

describe("DELETE /api/knowledge-base/[id]", () => {
  it("deletes a DB entry and returns { deleted: true }", async () => {
    const record = makeDbRecord({ id: 10 });
    mockFindUnique.mockResolvedValue(record);
    mockDelete.mockResolvedValue(record);

    const { status, body } = await callDELETE("10");

    expect(status).toBe(200);
    expect(body.data).toEqual({ deleted: true });
    expect(mockDelete).toHaveBeenCalledWith({ where: { id: 10 } });
  });

  it("returns 404 for non-existent DB id", async () => {
    mockFindUnique.mockResolvedValue(null);

    const { status, body } = await callDELETE("999");

    expect(status).toBe(404);
    expect(body.code).toBe("NOT_FOUND");
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("returns 400 for id=0 (invalid)", async () => {
    const { status, body } = await callDELETE("0");

    expect(status).toBe(400);
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("returns 400 for id=-1 (filesystem hide mechanism removed)", async () => {
    const { status, body } = await callDELETE("-1");

    expect(status).toBe(400);
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(mockDelete).not.toHaveBeenCalled();
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
// 5. Full lifecycle: add → list → delete → verify removed
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

  it("fresh clone scenario: DB is empty → knowledge base is blank", async () => {
    // On a fresh clone the DB has no entries — listing should be empty
    mockFindMany.mockResolvedValue([]);

    const { status, body } = await callListGET();

    expect(status).toBe(200);
    expect(body.data).toHaveLength(0);
  });
});
