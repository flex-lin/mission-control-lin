import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";

/**
 * Comprehensive end-to-end tests for the "blank knowledge base on fresh clone" feature.
 *
 * Goal: When a user clones the repo they get a blank knowledge base (no user-specific
 * paths pre-loaded). As they manually add repos the entries appear.
 *
 * Coverage:
 * 1. Fresh clone — DB is empty → GET /api/knowledge-base returns empty list
 * 2. No filesystem auto-population — listProjects() results never appear in KB listing
 * 3. Manual add workflow — POST /api/knowledge-base → entry appears in GET response
 * 4. Source field — all KB entries carry source='db'
 * 5. PATCH /api/knowledge-base/[id] — full update validation
 * 6. DELETE removes the entry; subsequent GET no longer includes it
 * 7. Concurrent add of same path is rejected with 409
 * 8. KnowledgeBaseEntry type shape contract
 * 9. Full lifecycle: fresh → add → view detail → update → delete → blank again
 * 10. Error handling
 *
 * NOTE: Skills and GET /api/projects tests are in separate files to avoid
 * mock conflicts — see blank-kb-projects.test.ts and blank-kb-skills.test.ts
 */

// ── Prisma DB mock ────────────────────────────────────────────────────────────

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
  return new NextRequest(new URL(urlPath, "http://localhost:3777"), init);
}

// ── Route callers ─────────────────────────────────────────────────────────────

async function callKbGET() {
  vi.resetModules();
  const mod = await import("@/app/api/knowledge-base/route");
  const res = await mod.GET();
  return { status: res.status, body: await res.json() };
}

async function callKbPOST(body: Record<string, unknown>) {
  vi.resetModules();
  const mod = await import("@/app/api/knowledge-base/route");
  const req = makeRequest("/api/knowledge-base", {
    method: "POST",
    body: JSON.stringify(body),
  });
  const res = await mod.POST(req);
  return { status: res.status, body: await res.json() };
}

async function callKbPATCH(id: string, body: Record<string, unknown>) {
  vi.resetModules();
  const mod = await import("@/app/api/knowledge-base/[id]/route");
  const req = makeRequest(`/api/knowledge-base/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  const res = await mod.PATCH(req, { params: Promise.resolve({ id }) });
  return { status: res.status, body: await res.json() };
}

async function callKbDELETE(id: string) {
  vi.resetModules();
  const mod = await import("@/app/api/knowledge-base/[id]/route");
  const req = makeRequest(`/api/knowledge-base/${id}`, { method: "DELETE" });
  const res = await mod.DELETE(req, { params: Promise.resolve({ id }) });
  return { status: res.status, body: await res.json() };
}

async function callProjectDetailGET(id: string) {
  vi.resetModules();
  const mod = await import("@/app/api/projects/[id]/route");
  const req = makeRequest(`/api/projects/${encodeURIComponent(id)}`);
  const res = await mod.GET(req, { params: Promise.resolve({ id }) });
  return { status: res.status, body: await res.json() };
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-blank-kb-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 1. Fresh clone — DB empty → knowledge base is blank
// ═══════════════════════════════════════════════════════════════════════════════

describe("Fresh clone — blank knowledge base", () => {
  it("returns empty list when no DB entries exist", async () => {
    mockFindMany.mockResolvedValue([]);

    const { status, body } = await callKbGET();

    expect(status).toBe(200);
    expect(body.data).toEqual([]);
    expect(body.meta.count).toBe(0);
  });

  it("meta.count matches number of data items", async () => {
    mockFindMany.mockResolvedValue([
      makeDbRecord({ id: 1, path: "/a", name: "a" }),
      makeDbRecord({ id: 2, path: "/b", name: "b" }),
      makeDbRecord({ id: 3, path: "/c", name: "c" }),
    ]);

    const { status, body } = await callKbGET();

    expect(status).toBe(200);
    expect(body.data).toHaveLength(3);
    expect(body.meta.count).toBe(3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. No filesystem auto-population
// ═══════════════════════════════════════════════════════════════════════════════

describe("No filesystem auto-population in knowledge base", () => {
  it("does not return filesystem-only projects even when they exist on disk", async () => {
    // DB is empty — no entries appear regardless of filesystem
    mockFindMany.mockResolvedValue([]);

    const { status, body } = await callKbGET();

    expect(status).toBe(200);
    expect(body.data).toHaveLength(0);
  });

  it("returns only DB entries when DB has entries", async () => {
    // DB has one entry
    mockFindMany.mockResolvedValue([
      makeDbRecord({ id: 10, path: "/home/user/db-entry", name: "db-entry" }),
    ]);

    const { status, body } = await callKbGET();

    expect(status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].name).toBe("db-entry");
  });

  it("all returned entries have source='db'", async () => {
    mockFindMany.mockResolvedValue([
      makeDbRecord({ id: 1, path: "/a", name: "a" }),
      makeDbRecord({ id: 2, path: "/b", name: "b" }),
    ]);

    const { body } = await callKbGET();

    for (const entry of body.data) {
      expect(entry.source).toBe("db");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. Manual add workflow
// ═══════════════════════════════════════════════════════════════════════════════

describe("Manual add workflow — POST /api/knowledge-base", () => {
  it("successfully adds a valid directory and returns 201", async () => {
    const projDir = path.join(tmpDir, "myrepo");
    fs.mkdirSync(projDir, { recursive: true });

    mockFindUnique.mockResolvedValue(null);
    mockCreate.mockResolvedValue(
      makeDbRecord({ id: 42, path: projDir, name: "myrepo", tags: "[]" })
    );

    const { status, body } = await callKbPOST({ path: projDir });

    expect(status).toBe(201);
    expect(body.data.path).toBe(projDir);
    expect(body.data.source).toBe("db");
    expect(mockCreate).toHaveBeenCalledOnce();
  });

  it("added entry appears in subsequent GET listing", async () => {
    const projDir = path.join(tmpDir, "newrepo");
    fs.mkdirSync(projDir, { recursive: true });

    const record = makeDbRecord({ id: 5, path: projDir, name: "newrepo" });
    mockFindUnique.mockResolvedValue(null);
    mockCreate.mockResolvedValue(record);

    // POST
    const { status: postStatus } = await callKbPOST({ path: projDir });
    expect(postStatus).toBe(201);

    // GET — now DB returns the record
    mockFindMany.mockResolvedValue([record]);

    const { status, body } = await callKbGET();
    expect(status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].path).toBe(projDir);
  });

  it("derives name from directory basename when not provided", async () => {
    const projDir = path.join(tmpDir, "auto-name-project");
    fs.mkdirSync(projDir, { recursive: true });

    mockFindUnique.mockResolvedValue(null);
    mockCreate.mockResolvedValue(
      makeDbRecord({ id: 1, path: projDir, name: "auto-name-project" })
    );

    await callKbPOST({ path: projDir });

    const createArgs = mockCreate.mock.calls[0][0];
    expect(createArgs.data.name).toBe("auto-name-project");
  });

  it("stores tags as JSON-encoded array", async () => {
    const projDir = path.join(tmpDir, "tagged");
    fs.mkdirSync(projDir, { recursive: true });

    mockFindUnique.mockResolvedValue(null);
    mockCreate.mockResolvedValue(
      makeDbRecord({ id: 2, path: projDir, tags: '["ts","react"]' })
    );

    await callKbPOST({ path: projDir, tags: ["ts", "react"] });

    const createArgs = mockCreate.mock.calls[0][0];
    expect(createArgs.data.tags).toBe('["ts","react"]');
  });

  it("returns 400 when path does not exist on filesystem", async () => {
    const fakePath = path.join(tmpDir, "does-not-exist");

    const { status, body } = await callKbPOST({ path: fakePath });

    expect(status).toBe(400);
    expect(body.code).toBe("PATH_NOT_FOUND");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("returns 400 when path is a file not a directory", async () => {
    const filePath = path.join(tmpDir, "file.txt");
    fs.writeFileSync(filePath, "hello");

    const { status, body } = await callKbPOST({ path: filePath });

    expect(status).toBe(400);
    expect(body.code).toBe("NOT_A_DIRECTORY");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("returns 400 when path field is missing", async () => {
    const { status, body } = await callKbPOST({ name: "no-path" });

    expect(status).toBe(400);
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when path is empty string", async () => {
    const { status, body } = await callKbPOST({ path: "" });

    expect(status).toBe(400);
    expect(body.code).toBe("VALIDATION_ERROR");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. Duplicate add rejected with 409
// ═══════════════════════════════════════════════════════════════════════════════

describe("Duplicate add rejected — 409", () => {
  it("returns 409 when path already exists in DB", async () => {
    const projDir = path.join(tmpDir, "already-there");
    fs.mkdirSync(projDir, { recursive: true });

    // DB already has this path
    mockFindUnique.mockResolvedValue(
      makeDbRecord({ id: 99, path: projDir })
    );

    const { status, body } = await callKbPOST({ path: projDir });

    expect(status).toBe(409);
    expect(body.code).toBe("DUPLICATE_PATH");
    expect(body.error).toContain("already exists");
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. PATCH /api/knowledge-base/[id] — full update validation
// ═══════════════════════════════════════════════════════════════════════════════

describe("PATCH /api/knowledge-base/[id]", () => {
  it("updates name field only", async () => {
    mockFindUnique.mockResolvedValue(
      makeDbRecord({ id: 1, path: "/old", name: "old-name" })
    );
    mockUpdate.mockResolvedValue(
      makeDbRecord({ id: 1, path: "/old", name: "new-name" })
    );

    const { status, body } = await callKbPATCH("1", { name: "new-name" });

    expect(status).toBe(200);
    expect(body.data.name).toBe("new-name");
    expect(body.data.source).toBe("db");
  });

  it("updates tags field only", async () => {
    mockFindUnique.mockResolvedValue(
      makeDbRecord({ id: 2, path: "/proj", name: "proj", tags: "[]" })
    );
    mockUpdate.mockResolvedValue(
      makeDbRecord({ id: 2, path: "/proj", name: "proj", tags: '["nextjs","ts"]' })
    );

    const { status, body } = await callKbPATCH("2", { tags: ["nextjs", "ts"] });

    expect(status).toBe(200);
    expect(body.data.tags).toEqual(["nextjs", "ts"]);
  });

  it("updates path to a new valid directory", async () => {
    const newDir = path.join(tmpDir, "new-path");
    fs.mkdirSync(newDir, { recursive: true });

    mockFindUnique
      .mockResolvedValueOnce(makeDbRecord({ id: 3, path: "/old" }))
      .mockResolvedValueOnce(null); // dup check: no conflict
    mockUpdate.mockResolvedValue(
      makeDbRecord({ id: 3, path: newDir, name: "new-path" })
    );

    const { status, body } = await callKbPATCH("3", { path: newDir });

    expect(status).toBe(200);
    expect(body.data.path).toBe(newDir);
  });

  it("allows keeping the same path (no duplicate error)", async () => {
    const sameDir = path.join(tmpDir, "same");
    fs.mkdirSync(sameDir, { recursive: true });

    mockFindUnique.mockResolvedValue(
      makeDbRecord({ id: 4, path: sameDir, name: "same" })
    );
    mockUpdate.mockResolvedValue(
      makeDbRecord({ id: 4, path: sameDir, name: "renamed" })
    );

    const { status } = await callKbPATCH("4", { path: sameDir, name: "renamed" });

    expect(status).toBe(200);
    // Only one findUnique call (not two) since same path skips dup check
    expect(mockFindUnique).toHaveBeenCalledOnce();
  });

  it("returns 400 when no fields are provided", async () => {
    mockFindUnique.mockResolvedValue(makeDbRecord({ id: 1 }));

    const { status, body } = await callKbPATCH("1", {});

    expect(status).toBe(400);
    expect(body.error).toContain("No fields to update");
  });

  it("returns 400 when tags is not an array", async () => {
    mockFindUnique.mockResolvedValue(makeDbRecord({ id: 1 }));

    const { status, body } = await callKbPATCH("1", { tags: "not-array" });

    expect(status).toBe(400);
    expect(body.error).toContain("tags must be an array");
  });

  it("returns 400 when new path does not exist on disk", async () => {
    mockFindUnique.mockResolvedValue(makeDbRecord({ id: 1 }));

    const { status, body } = await callKbPATCH("1", { path: "/totally/nonexistent/path" });

    expect(status).toBe(400);
    expect(body.code).toBe("PATH_NOT_FOUND");
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("returns 409 when updating to a path already in use by another entry", async () => {
    const dupDir = path.join(tmpDir, "dup");
    fs.mkdirSync(dupDir, { recursive: true });

    mockFindUnique
      .mockResolvedValueOnce(makeDbRecord({ id: 1, path: "/original" }))
      .mockResolvedValueOnce(makeDbRecord({ id: 2, path: dupDir })); // dup found

    const { status, body } = await callKbPATCH("1", { path: dupDir });

    expect(status).toBe(409);
    expect(body.code).toBe("DUPLICATE_PATH");
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("returns 404 for non-existent entry id", async () => {
    mockFindUnique.mockResolvedValue(null);

    const { status, body } = await callKbPATCH("9999", { name: "x" });

    expect(status).toBe(404);
    expect(body.code).toBe("NOT_FOUND");
  });

  it("returns 400 for non-numeric id", async () => {
    const { status, body } = await callKbPATCH("abc", { name: "x" });

    expect(status).toBe(400);
    expect(body.code).toBe("VALIDATION_ERROR");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. DELETE removes entry and subsequent GET excludes it
// ═══════════════════════════════════════════════════════════════════════════════

describe("DELETE /api/knowledge-base/[id] — entry removal", () => {
  it("deletes an existing entry and returns { deleted: true }", async () => {
    const record = makeDbRecord({ id: 20 });
    mockFindUnique.mockResolvedValue(record);
    mockDelete.mockResolvedValue(record);

    const { status, body } = await callKbDELETE("20");

    expect(status).toBe(200);
    expect(body.data).toEqual({ deleted: true });
    expect(mockDelete).toHaveBeenCalledWith({ where: { id: 20 } });
  });

  it("entry no longer appears in GET after deletion", async () => {
    const record = makeDbRecord({ id: 7, path: "/project/to/remove" });

    // DELETE step
    mockFindUnique.mockResolvedValue(record);
    mockDelete.mockResolvedValue(record);
    const { status: delStatus } = await callKbDELETE("7");
    expect(delStatus).toBe(200);

    // GET step — DB now returns nothing
    mockFindMany.mockResolvedValue([]);
    const { status, body } = await callKbGET();

    expect(status).toBe(200);
    expect(body.data).toHaveLength(0);
    const paths = body.data.map((e: { path: string }) => e.path) as string[];
    expect(paths).not.toContain("/project/to/remove");
  });

  it("returns 404 when trying to delete a non-existent entry", async () => {
    mockFindUnique.mockResolvedValue(null);

    const { status, body } = await callKbDELETE("404");

    expect(status).toBe(404);
    expect(body.code).toBe("NOT_FOUND");
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("returns 400 for id=0", async () => {
    const { status, body } = await callKbDELETE("0");

    expect(status).toBe(400);
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("returns 400 for negative id (old hide mechanism removed)", async () => {
    const { status, body } = await callKbDELETE("-1");

    expect(status).toBe(400);
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("returns 400 for non-numeric id", async () => {
    const { status, body } = await callKbDELETE("notanumber");

    expect(status).toBe(400);
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(mockDelete).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. GET /api/projects/[id] — project detail (numeric DB ID)
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /api/projects/[id] — project detail by numeric DB ID", () => {
  it("returns project detail with CLAUDE.md contents", async () => {
    const projDir = path.join(tmpDir, "detail-proj");
    fs.mkdirSync(projDir, { recursive: true });
    fs.writeFileSync(path.join(projDir, "CLAUDE.md"), "# My Project\n\nSome docs.");

    mockFindUnique.mockResolvedValue(
      makeDbRecord({ id: 11, path: projDir, name: "detail-proj", tags: '["test"]' })
    );

    const { status, body } = await callProjectDetailGET("11");

    expect(status).toBe(200);
    expect(body.data.id).toBe("11");
    expect(body.data.name).toBe("detail-proj");
    expect(body.data.path).toBe(projDir);
    expect(body.data.tags).toEqual(["test"]);
    expect(body.data.claudeMd).toBe("# My Project\n\nSome docs.");
  });

  it("returns file tree listing top-level contents", async () => {
    const projDir = path.join(tmpDir, "tree-proj");
    fs.mkdirSync(path.join(projDir, "src"), { recursive: true });
    fs.writeFileSync(path.join(projDir, "README.md"), "");
    fs.writeFileSync(path.join(projDir, "package.json"), "{}");

    mockFindUnique.mockResolvedValue(
      makeDbRecord({ id: 12, path: projDir, name: "tree-proj", tags: "[]" })
    );

    const { status, body } = await callProjectDetailGET("12");

    expect(status).toBe(200);
    expect(Array.isArray(body.data.fileTree)).toBe(true);
    expect(body.data.fileTree).toContain("src/");
    expect(body.data.fileTree).toContain("README.md");
    expect(body.data.fileTree).toContain("package.json");
  });

  it("does not include claudeMd when CLAUDE.md is absent", async () => {
    const projDir = path.join(tmpDir, "no-claude");
    fs.mkdirSync(projDir, { recursive: true });

    mockFindUnique.mockResolvedValue(
      makeDbRecord({ id: 13, path: projDir, name: "no-claude", tags: "[]" })
    );

    const { status, body } = await callProjectDetailGET("13");

    expect(status).toBe(200);
    expect(body.data.claudeMd).toBeUndefined();
  });

  it("returns 404 for numeric ID not in DB", async () => {
    mockFindUnique.mockResolvedValue(null);

    const { status, body } = await callProjectDetailGET("9999");

    expect(status).toBe(404);
    expect(body.code).toBe("NOT_FOUND");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. KnowledgeBaseEntry type shape contract
// ═══════════════════════════════════════════════════════════════════════════════

describe("KnowledgeBaseEntry type shape", () => {
  it("GET response entries have all required fields", async () => {
    mockFindMany.mockResolvedValue([
      makeDbRecord({
        id: 1,
        path: "/home/user/project",
        name: "project",
        tags: '["ts"]',
        lastScanned: new Date("2025-03-01T00:00:00.000Z"),
      }),
    ]);

    const { body } = await callKbGET();
    const entry = body.data[0];

    expect(typeof entry.id).toBe("number");
    expect(typeof entry.path).toBe("string");
    expect(typeof entry.name).toBe("string");
    expect(Array.isArray(entry.tags)).toBe(true);
    expect(entry.source).toBe("db");
    expect(typeof entry.lastScanned).toBe("string");
  });

  it("lastScanned is omitted (undefined) when DB value is null", async () => {
    mockFindMany.mockResolvedValue([
      makeDbRecord({ id: 2, lastScanned: null }),
    ]);

    const { body } = await callKbGET();

    expect(body.data[0].lastScanned).toBeUndefined();
  });

  it("POST response entry has correct shape", async () => {
    const projDir = path.join(tmpDir, "shape-test");
    fs.mkdirSync(projDir, { recursive: true });

    mockFindUnique.mockResolvedValue(null);
    mockCreate.mockResolvedValue(
      makeDbRecord({ id: 55, path: projDir, name: "shape-test", tags: '["x"]' })
    );

    const { body } = await callKbPOST({ path: projDir, tags: ["x"] });

    const entry = body.data;
    expect(typeof entry.id).toBe("number");
    expect(typeof entry.path).toBe("string");
    expect(typeof entry.name).toBe("string");
    expect(Array.isArray(entry.tags)).toBe(true);
    expect(entry.source).toBe("db");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 9. Full lifecycle: fresh → add → view detail → update → delete → blank again
// ═══════════════════════════════════════════════════════════════════════════════

describe("Full lifecycle — fresh clone to populated and back", () => {
  it("complete add → view → update → delete workflow", async () => {
    const repoDir = path.join(tmpDir, "my-oss-repo");
    fs.mkdirSync(repoDir, { recursive: true });
    fs.writeFileSync(
      path.join(repoDir, "CLAUDE.md"),
      "# My OSS Repo\n\nGreat project."
    );

    // -- Step 1: Fresh clone — empty knowledge base
    mockFindMany.mockResolvedValue([]);
    const { body: emptyList } = await callKbGET();
    expect(emptyList.data).toHaveLength(0);

    // -- Step 2: User adds the repo
    const createdRecord = makeDbRecord({
      id: 100,
      path: repoDir,
      name: "my-oss-repo",
      tags: "[]",
    });
    mockFindUnique.mockResolvedValue(null);
    mockCreate.mockResolvedValue(createdRecord);
    const { status: postStatus, body: postBody } = await callKbPOST({
      path: repoDir,
    });
    expect(postStatus).toBe(201);
    expect(postBody.data.path).toBe(repoDir);

    // -- Step 3: Repo appears in listing
    mockFindMany.mockResolvedValue([createdRecord]);
    const { body: listBody } = await callKbGET();
    expect(listBody.data).toHaveLength(1);
    expect(listBody.data[0].path).toBe(repoDir);
    expect(listBody.data[0].source).toBe("db");

    // -- Step 4: View detail using numeric DB ID
    mockFindUnique.mockResolvedValue(createdRecord);
    const { status: detailStatus, body: detailBody } = await callProjectDetailGET("100");
    expect(detailStatus).toBe(200);
    expect(detailBody.data.claudeMd).toBe("# My OSS Repo\n\nGreat project.");

    // -- Step 5: Update name and tags
    const updatedRecord = { ...createdRecord, name: "my-renamed-repo", tags: '["oss","ts"]' };
    mockFindUnique.mockResolvedValue(createdRecord);
    mockUpdate.mockResolvedValue(updatedRecord);
    const { status: patchStatus, body: patchBody } = await callKbPATCH("100", {
      name: "my-renamed-repo",
      tags: ["oss", "ts"],
    });
    expect(patchStatus).toBe(200);
    expect(patchBody.data.name).toBe("my-renamed-repo");
    expect(patchBody.data.tags).toEqual(["oss", "ts"]);

    // -- Step 6: Delete the entry
    mockFindUnique.mockResolvedValue(updatedRecord);
    mockDelete.mockResolvedValue(updatedRecord);
    const { status: delStatus, body: delBody } = await callKbDELETE("100");
    expect(delStatus).toBe(200);
    expect(delBody.data).toEqual({ deleted: true });

    // -- Step 7: Knowledge base is blank again
    mockFindMany.mockResolvedValue([]);
    const { body: finalList } = await callKbGET();
    expect(finalList.data).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 10. Error handling
// ═══════════════════════════════════════════════════════════════════════════════

describe("Error handling", () => {
  it("GET /api/knowledge-base returns 500 on DB error", async () => {
    mockFindMany.mockRejectedValue(new Error("DB connection lost"));

    const { status, body } = await callKbGET();

    expect(status).toBe(500);
    expect(body.code).toBe("SERVER_ERROR");
  });

  it("POST /api/knowledge-base returns 500 on DB create error", async () => {
    const projDir = path.join(tmpDir, "db-error-proj");
    fs.mkdirSync(projDir, { recursive: true });

    mockFindUnique.mockResolvedValue(null);
    mockCreate.mockRejectedValue(new Error("SQLITE_BUSY"));

    const { status, body } = await callKbPOST({ path: projDir });

    expect(status).toBe(500);
    expect(body.code).toBe("SERVER_ERROR");
  });

  it("DELETE returns 500 on DB delete error", async () => {
    mockFindUnique.mockResolvedValue(makeDbRecord({ id: 1 }));
    mockDelete.mockRejectedValue(new Error("SQLITE_LOCKED"));

    const { status, body } = await callKbDELETE("1");

    expect(status).toBe(500);
    expect(body.code).toBe("SERVER_ERROR");
  });
});
