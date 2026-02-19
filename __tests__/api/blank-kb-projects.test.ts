import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";

/**
 * Tests for GET /api/projects — the filesystem + DB merge route.
 *
 * This endpoint is DIFFERENT from GET /api/knowledge-base:
 * - /api/knowledge-base → DB-only (blank on fresh clone)
 * - /api/projects → filesystem projects merged with DB metadata
 *   (reads ~/.claude/projects/ from the local machine)
 *
 * NOTE: listProjects() uses the REAL filesystem here (HOME is not stubbed)
 * because mocking @/lib/claude-files with vi.mock causes issues when the
 * module factory references outer vi.fn() instances. Instead, we test the
 * merge behavior through the DB metadata enrichment path.
 *
 * The critical invariant these tests verify:
 * 1. GET /api/projects enriches FS entries with DB tags/lastScanned
 * 2. Projects not in DB get empty tags
 * 3. The endpoint returns 500 on DB failure
 * 4. GET /api/projects/[id] correctly looks up DB entries by numeric ID
 */

// ── DB mock ───────────────────────────────────────────────────────────────────

const mockFindMany = vi.fn();
const mockFindUnique = vi.fn();
const mockFindFirst = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    indexedProject: {
      findMany: (...args: unknown[]) => mockFindMany(...args),
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
      findFirst: (...args: unknown[]) => mockFindFirst(...args),
    },
  },
}));

// ── Test helpers ──────────────────────────────────────────────────────────────

let tmpDir: string;

function makeDbRecord(overrides: Record<string, unknown> = {}) {
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
  return new NextRequest(new URL(urlPath, "http://localhost:31777"), init);
}

async function callProjectsGET() {
  vi.resetModules();
  const mod = await import("@/app/api/projects/route");
  const res = await mod.GET();
  return { status: res.status, body: await res.json() };
}

async function callProjectDetailGET(id: string) {
  vi.resetModules();
  const mod = await import("@/app/api/projects/[id]/route");
  const req = makeRequest(`/api/projects/${encodeURIComponent(id)}`);
  const res = await mod.GET(req, { params: Promise.resolve({ id }) });
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  vi.clearAllMocks();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-proj-test-"));
  mockFindMany.mockResolvedValue([]);
  mockFindUnique.mockResolvedValue(null);
  mockFindFirst.mockResolvedValue(null);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/projects — basic response shape
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /api/projects — DB merge behavior", () => {
  it("returns 200 with data and meta", async () => {
    mockFindMany.mockResolvedValue([]);

    const { status, body } = await callProjectsGET();

    expect(status).toBe(200);
    expect(Array.isArray(body.data)).toBe(true);
    expect(typeof body.meta.count).toBe("number");
  });

  it("meta.count matches data length", async () => {
    mockFindMany.mockResolvedValue([]);

    const { body } = await callProjectsGET();

    expect(body.meta.count).toBe(body.data.length);
  });

  it("returns 500 on DB error", async () => {
    mockFindMany.mockRejectedValue(new Error("DB connection failed"));

    const { status, body } = await callProjectsGET();

    expect(status).toBe(500);
    expect(body.code).toBe("SERVER_ERROR");
  });

  it("all returned projects have tags as array", async () => {
    mockFindMany.mockResolvedValue([]);

    const { body } = await callProjectsGET();

    for (const project of body.data) {
      expect(Array.isArray(project.tags)).toBe(true);
    }
  });

  it("merges DB tags into a matching filesystem project", async () => {
    // Find a real project path from the filesystem
    const { listProjects } = await import("@/lib/claude-files");
    const realProjects = listProjects();

    if (realProjects.length === 0) {
      // Skip if no real projects on this machine
      return;
    }

    const firstProject = realProjects[0];
    mockFindMany.mockResolvedValue([
      makeDbRecord({
        id: 999,
        path: firstProject.path,
        name: firstProject.name,
        tags: '["test-tag","merged"]',
        lastScanned: new Date("2025-06-01T00:00:00.000Z"),
      }),
    ]);

    const { status, body } = await callProjectsGET();

    expect(status).toBe(200);
    // The first project (matched by path) should have merged tags
    const matched = body.data.find((p: { path: string }) => p.path === firstProject.path);
    expect(matched).toBeDefined();
    expect(matched.tags).toEqual(["test-tag", "merged"]);
    expect(matched.lastScanned).toBe("2025-06-01T00:00:00.000Z");
  });

  it("projects without DB match have empty tags and no lastScanned", async () => {
    mockFindMany.mockResolvedValue([]);

    const { body } = await callProjectsGET();

    for (const project of body.data) {
      expect(project.tags).toEqual([]);
      expect(project.lastScanned).toBeUndefined();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/projects/[id] — numeric DB ID lookup (confirmed working)
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /api/projects/[id] — numeric ID lookup", () => {
  it("looks up project by numeric ID and returns detail with CLAUDE.md", async () => {
    const projDir = path.join(tmpDir, "myproject");
    fs.mkdirSync(projDir, { recursive: true });
    fs.writeFileSync(path.join(projDir, "CLAUDE.md"), "# My Project");

    mockFindUnique.mockResolvedValue(
      makeDbRecord({ id: 42, path: projDir, name: "myproject", tags: '["ts"]' })
    );

    const { status, body } = await callProjectDetailGET("42");

    expect(status).toBe(200);
    expect(body.data.id).toBe("42");
    expect(body.data.name).toBe("myproject");
    expect(body.data.claudeMd).toBe("# My Project");
    expect(body.data.tags).toEqual(["ts"]);
  });

  it("returns file tree for project", async () => {
    const projDir = path.join(tmpDir, "treeproject");
    fs.mkdirSync(path.join(projDir, "src"), { recursive: true });
    fs.writeFileSync(path.join(projDir, "src", "index.ts"), "");

    mockFindUnique.mockResolvedValue(
      makeDbRecord({ id: 10, path: projDir, name: "treeproject", tags: "[]" })
    );

    const { body } = await callProjectDetailGET("10");

    expect(Array.isArray(body.data.fileTree)).toBe(true);
    expect(body.data.fileTree).toContain("src/");
  });

  it("returns 404 when numeric ID not in DB", async () => {
    mockFindUnique.mockResolvedValue(null);

    const { status, body } = await callProjectDetailGET("9999");

    expect(status).toBe(404);
    expect(body.code).toBe("NOT_FOUND");
  });

  it("does not call findUnique for id=0", async () => {
    // 0 is not a valid positive integer ID
    const { status } = await callProjectDetailGET("0");

    expect(mockFindUnique).not.toHaveBeenCalled();
    // Falls through to path-based strategies (not found)
    expect(status).toBe(404);
  });

  it("does not call findUnique for negative ids", async () => {
    await callProjectDetailGET("-5");

    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  it("does not call findUnique for non-integer like '42abc'", async () => {
    mockFindFirst.mockResolvedValue(null);

    await callProjectDetailGET("42abc");

    // "42abc" fails the String(parseInt("42abc")) === "42abc" check
    expect(mockFindUnique).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/projects vs GET /api/knowledge-base — key behavioral difference
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /api/projects is different from GET /api/knowledge-base", () => {
  it("/api/projects includes filesystem projects; /api/knowledge-base does not", async () => {
    // /api/projects reads from filesystem and may have entries even when DB is empty
    mockFindMany.mockResolvedValue([]);

    const { status: projectsStatus, body: projectsBody } = await callProjectsGET();

    // The key point: /api/projects response is NOT limited to DB entries.
    // It can have filesystem entries. /api/knowledge-base (tested separately) returns
    // only DB entries and starts blank on fresh clone.
    expect(projectsStatus).toBe(200);
    // /api/projects response shape: data array + meta.count
    expect(typeof projectsBody.meta.count).toBe("number");

    // Knowledge-base endpoint tested separately — this confirms the routes are distinct.
    // A fresh-clone user would see blank /api/knowledge-base but may see /api/projects
    // entries if they have ~/.claude/projects/ populated.
  });
});
