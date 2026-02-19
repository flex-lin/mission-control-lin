import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * End-to-end tests for the optional team member configuration feature.
 *
 * Covers:
 * 1. GET  /api/roles                — list all roles (presets + custom) from DB
 * 2. POST /api/roles                — create a custom role (uses db.teamMemberRole)
 * 3. GET  /api/roles/[id]           — get a single role by numeric ID
 * 4. PUT  /api/roles/[id]           — update a custom role (blocks presets)
 * 5. DELETE /api/roles/[id]         — delete a custom role (blocks presets)
 * 6. POST /api/queue with teamMembers — submit a task with team member roles
 * 7. GET  /api/queue/[id]           — retrieve a task and verify teamMembers persisted
 * 8. Full lifecycle: create role → submit task → retrieve task
 * 9. Validation edge cases
 */

// ── Mock DB ───────────────────────────────────────────────────────────────────

const mockRoleFindMany = vi.fn();
const mockRoleFindUnique = vi.fn();
const mockRoleFindFirst = vi.fn();
const mockRoleCreate = vi.fn();
const mockRoleUpdate = vi.fn();
const mockRoleDelete = vi.fn();
const mockRoleUpsert = vi.fn();
const mockQueuedTaskCreate = vi.fn();
const mockQueuedTaskFindUnique = vi.fn();
const mockQueuedTaskFindMany = vi.fn();
const mockQueuedTaskGroupBy = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    teamMemberRole: {
      findMany: (...args: unknown[]) => mockRoleFindMany(...args),
      findUnique: (...args: unknown[]) => mockRoleFindUnique(...args),
      findFirst: (...args: unknown[]) => mockRoleFindFirst(...args),
      create: (...args: unknown[]) => mockRoleCreate(...args),
      update: (...args: unknown[]) => mockRoleUpdate(...args),
      delete: (...args: unknown[]) => mockRoleDelete(...args),
      upsert: (...args: unknown[]) => mockRoleUpsert(...args),
    },
    queuedTask: {
      create: (...args: unknown[]) => mockQueuedTaskCreate(...args),
      findUnique: (...args: unknown[]) => mockQueuedTaskFindUnique(...args),
      findMany: (...args: unknown[]) => mockQueuedTaskFindMany(...args),
      groupBy: (...args: unknown[]) => mockQueuedTaskGroupBy(...args),
    },
  },
}));

// ── DB Fixtures ───────────────────────────────────────────────────────────────

function makePresetRole(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    name: "architect",
    role: "System Architect",
    agentType: "general-purpose",
    description: "Designs system architecture",
    isPreset: true,
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
    ...overrides,
  };
}

function makeCustomRole(overrides: Record<string, unknown> = {}) {
  return {
    id: 100,
    name: "custom-analyst",
    role: "Data Analyst",
    agentType: "general-purpose",
    description: "Analyzes data and produces insights",
    isPreset: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeQueuedTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    goal: "Build a data pipeline",
    projectPath: "/tmp/project",
    status: "pending",
    teamName: null,
    priority: 0,
    result: null,
    attachments: "[]",
    teamMembers: "[]",
    createdAt: new Date().toISOString(),
    startedAt: null,
    completedAt: null,
    ...overrides,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRequest(url: string, init?: RequestInit): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:3777"), init);
}

// ── Setup / Teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();

  // Safe defaults — no presets seeded (findFirst returns null → seeds)
  mockRoleFindFirst.mockResolvedValue(null);
  mockRoleUpsert.mockResolvedValue({});
  mockRoleFindMany.mockResolvedValue([]);
  mockRoleFindUnique.mockResolvedValue(null);
  mockQueuedTaskGroupBy.mockResolvedValue([]);
  mockQueuedTaskFindMany.mockResolvedValue([]);
});

// =============================================================================
// 1. GET /api/roles — list all roles
// =============================================================================

describe("GET /api/roles — listing roles", () => {
  it("returns roles from the database", async () => {
    const roles = [
      makePresetRole({ id: 1, name: "architect" }),
      makePresetRole({ id: 2, name: "frontend-dev" }),
      makeCustomRole({ id: 100, name: "my-custom" }),
    ];
    mockRoleFindFirst.mockResolvedValue(roles[0]); // presets already seeded
    mockRoleFindMany.mockResolvedValue(roles);

    vi.resetModules();
    const { GET } = await import("@/app/api/roles/route");
    const req = makeRequest("http://localhost:3777/api/roles");
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toBeInstanceOf(Array);
    expect(body.data).toHaveLength(3);
  });

  it("seeds preset roles on first call when no presets exist", async () => {
    // findFirst returns null → seeds
    mockRoleFindFirst.mockResolvedValue(null);
    mockRoleUpsert.mockResolvedValue({});
    mockRoleFindMany.mockResolvedValue([makePresetRole()]);

    vi.resetModules();
    const { GET } = await import("@/app/api/roles/route");
    const req = makeRequest("http://localhost:3777/api/roles");
    const res = await GET(req);

    expect(res.status).toBe(200);
    // Should have called upsert for each preset role
    expect(mockRoleUpsert).toHaveBeenCalled();
  });

  it("does not seed again if presets already exist", async () => {
    // findFirst returns a preset → skips seeding
    mockRoleFindFirst.mockResolvedValue(makePresetRole());
    mockRoleFindMany.mockResolvedValue([makePresetRole()]);

    vi.resetModules();
    const { GET } = await import("@/app/api/roles/route");
    const req = makeRequest("http://localhost:3777/api/roles");
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(mockRoleUpsert).not.toHaveBeenCalled();
  });

  it("filters by preset=true when specified", async () => {
    const presets = [
      makePresetRole({ id: 1 }),
      makePresetRole({ id: 2, name: "frontend-dev" }),
    ];
    mockRoleFindFirst.mockResolvedValue(presets[0]);
    mockRoleFindMany.mockResolvedValue(presets);

    vi.resetModules();
    const { GET } = await import("@/app/api/roles/route");
    const req = makeRequest("http://localhost:3777/api/roles?preset=true");
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    // Verify the where clause passed to findMany
    expect(mockRoleFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { isPreset: true },
      })
    );
  });

  it("filters by preset=false to show only custom roles", async () => {
    const customRoles = [makeCustomRole({ id: 100 }), makeCustomRole({ id: 101, name: "devops-custom" })];
    mockRoleFindFirst.mockResolvedValue(makePresetRole());
    mockRoleFindMany.mockResolvedValue(customRoles);

    vi.resetModules();
    const { GET } = await import("@/app/api/roles/route");
    const req = makeRequest("http://localhost:3777/api/roles?preset=false");
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(mockRoleFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { isPreset: false },
      })
    );
  });

  it("returns all roles when no filter is provided", async () => {
    const roles = [makePresetRole(), makeCustomRole()];
    mockRoleFindFirst.mockResolvedValue(makePresetRole());
    mockRoleFindMany.mockResolvedValue(roles);

    vi.resetModules();
    const { GET } = await import("@/app/api/roles/route");
    const req = makeRequest("http://localhost:3777/api/roles");
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(mockRoleFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} })
    );
  });

  it("returns empty array when no roles match the filter", async () => {
    mockRoleFindFirst.mockResolvedValue(makePresetRole());
    mockRoleFindMany.mockResolvedValue([]);

    vi.resetModules();
    const { GET } = await import("@/app/api/roles/route");
    const req = makeRequest("http://localhost:3777/api/roles?preset=false");
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toEqual([]);
  });
});

// =============================================================================
// 2. POST /api/roles — create a custom role
// =============================================================================

describe("POST /api/roles — create a custom role", () => {
  it("creates a new custom role with all required fields", async () => {
    mockRoleFindUnique.mockResolvedValue(null); // no name conflict
    mockRoleCreate.mockResolvedValue(makeCustomRole({
      id: 101,
      name: "new-analyst",
      role: "Data Analyst",
      agentType: "general-purpose",
      description: "Analyzes data",
    }));

    vi.resetModules();
    const { POST } = await import("@/app/api/roles/route");

    const req = makeRequest("http://localhost:3777/api/roles", {
      method: "POST",
      body: JSON.stringify({
        name: "new-analyst",
        role: "Data Analyst",
        agentType: "general-purpose",
        description: "Analyzes data",
      }),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.data.name).toBe("new-analyst");
    expect(body.data.role).toBe("Data Analyst");
    expect(body.data.isPreset).toBe(false);
  });

  it("returns 400 when name is missing", async () => {
    vi.resetModules();
    const { POST } = await import("@/app/api/roles/route");

    const req = makeRequest("http://localhost:3777/api/roles", {
      method: "POST",
      body: JSON.stringify({ role: "Some Role", agentType: "general-purpose", description: "desc" }),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(body.error).toContain("name");
  });

  it("returns 400 when role title is missing", async () => {
    vi.resetModules();
    const { POST } = await import("@/app/api/roles/route");

    const req = makeRequest("http://localhost:3777/api/roles", {
      method: "POST",
      body: JSON.stringify({ name: "some-name", agentType: "general-purpose", description: "desc" }),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(body.error).toContain("role");
  });

  it("returns 400 when agentType is missing", async () => {
    vi.resetModules();
    const { POST } = await import("@/app/api/roles/route");

    const req = makeRequest("http://localhost:3777/api/roles", {
      method: "POST",
      body: JSON.stringify({ name: "some-name", role: "Some Role", description: "desc" }),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(body.error).toContain("agentType");
  });

  it("returns 400 when description is missing", async () => {
    vi.resetModules();
    const { POST } = await import("@/app/api/roles/route");

    const req = makeRequest("http://localhost:3777/api/roles", {
      method: "POST",
      body: JSON.stringify({ name: "some-name", role: "Some Role", agentType: "general-purpose" }),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(body.error).toContain("description");
  });

  it("returns 400 when agentType is not a valid value", async () => {
    vi.resetModules();
    const { POST } = await import("@/app/api/roles/route");

    const req = makeRequest("http://localhost:3777/api/roles", {
      method: "POST",
      body: JSON.stringify({
        name: "test-role",
        role: "Test Role",
        agentType: "invalid-type",
        description: "A test role",
      }),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(body.error).toContain("agentType");
  });

  it("accepts all valid agentType values", async () => {
    const validTypes = ["general-purpose", "Bash", "Explore", "Plan"];

    for (const agentType of validTypes) {
      vi.clearAllMocks();
      mockRoleFindUnique.mockResolvedValue(null);
      mockRoleCreate.mockResolvedValue(makeCustomRole({ id: Math.random(), name: `role-${agentType}`, agentType }));

      vi.resetModules();
      const { POST } = await import("@/app/api/roles/route");

      const req = makeRequest("http://localhost:3777/api/roles", {
        method: "POST",
        body: JSON.stringify({
          name: `role-${agentType}`,
          role: "Test Role",
          agentType,
          description: "A test description",
        }),
      });

      const res = await POST(req);
      expect(res.status).toBe(201);
    }
  });

  it("returns 409 when name already exists in DB", async () => {
    // findUnique returns existing → conflict
    mockRoleFindUnique.mockResolvedValue(makePresetRole({ name: "architect" }));

    vi.resetModules();
    const { POST } = await import("@/app/api/roles/route");

    const req = makeRequest("http://localhost:3777/api/roles", {
      method: "POST",
      body: JSON.stringify({
        name: "architect",
        role: "Custom Architect",
        agentType: "general-purpose",
        description: "A custom architect",
      }),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.code).toBe("CONFLICT");
  });

  it("trims whitespace from all string fields", async () => {
    mockRoleFindUnique.mockResolvedValue(null);
    mockRoleCreate.mockImplementation((args: { data: Record<string, string> }) =>
      Promise.resolve({ id: 99, ...args.data, isPreset: false, createdAt: new Date(), updatedAt: new Date() })
    );

    vi.resetModules();
    const { POST } = await import("@/app/api/roles/route");

    const req = makeRequest("http://localhost:3777/api/roles", {
      method: "POST",
      body: JSON.stringify({
        name: "  trimmed-role  ",
        role: "  Trimmed Role Title  ",
        agentType: "  general-purpose  ",
        description: "  Some description  ",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);

    // Verify create was called with trimmed values
    expect(mockRoleCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: "trimmed-role",
          role: "Trimmed Role Title",
          agentType: "general-purpose",
          description: "Some description",
        }),
      })
    );
  });

  it("creates role with isPreset: false", async () => {
    mockRoleFindUnique.mockResolvedValue(null);
    mockRoleCreate.mockResolvedValue(makeCustomRole({ isPreset: false }));

    vi.resetModules();
    const { POST } = await import("@/app/api/roles/route");

    const req = makeRequest("http://localhost:3777/api/roles", {
      method: "POST",
      body: JSON.stringify({
        name: "my-role",
        role: "My Role",
        agentType: "Bash",
        description: "A custom role",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);

    expect(mockRoleCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ isPreset: false }),
      })
    );
  });
});

// =============================================================================
// 3. GET /api/roles/[id] — get single role by numeric ID
// =============================================================================

describe("GET /api/roles/[id] — get single role", () => {
  it("returns a role by numeric ID", async () => {
    const role = makePresetRole({ id: 5, name: "architect" });
    mockRoleFindUnique.mockResolvedValue(role);

    vi.resetModules();
    const { GET } = await import("@/app/api/roles/[id]/route");

    const req = makeRequest("http://localhost:3777/api/roles/5");
    const res = await GET(req, { params: Promise.resolve({ id: "5" }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.id).toBe(5);
    expect(body.data.name).toBe("architect");
  });

  it("returns 400 for non-numeric ID", async () => {
    vi.resetModules();
    const { GET } = await import("@/app/api/roles/[id]/route");

    const req = makeRequest("http://localhost:3777/api/roles/not-a-number");
    const res = await GET(req, { params: Promise.resolve({ id: "not-a-number" }) });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(body.error).toContain("Invalid role ID");
  });

  it("returns 400 for string role IDs like 'preset-architect'", async () => {
    vi.resetModules();
    const { GET } = await import("@/app/api/roles/[id]/route");

    const req = makeRequest("http://localhost:3777/api/roles/preset-architect");
    const res = await GET(req, { params: Promise.resolve({ id: "preset-architect" }) });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("returns 404 when role does not exist", async () => {
    mockRoleFindUnique.mockResolvedValue(null);

    vi.resetModules();
    const { GET } = await import("@/app/api/roles/[id]/route");

    const req = makeRequest("http://localhost:3777/api/roles/9999");
    const res = await GET(req, { params: Promise.resolve({ id: "9999" }) });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.code).toBe("NOT_FOUND");
  });
});

// =============================================================================
// 4. PUT /api/roles/[id] — update a custom role
// =============================================================================

describe("PUT /api/roles/[id] — update a custom role", () => {
  it("updates an existing custom role's fields", async () => {
    const existingRole = makeCustomRole({ id: 100, name: "original-name" });
    const updatedRole = { ...existingRole, role: "Updated Title", description: "Updated desc" };

    mockRoleFindUnique.mockResolvedValue(existingRole);
    mockRoleUpdate.mockResolvedValue(updatedRole);

    vi.resetModules();
    const { PUT } = await import("@/app/api/roles/[id]/route");

    const req = makeRequest("http://localhost:3777/api/roles/100", {
      method: "PUT",
      body: JSON.stringify({ role: "Updated Title", description: "Updated desc" }),
    });

    const res = await PUT(req, { params: Promise.resolve({ id: "100" }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.role).toBe("Updated Title");
    expect(body.data.description).toBe("Updated desc");
  });

  it("returns 400 for non-numeric ID", async () => {
    vi.resetModules();
    const { PUT } = await import("@/app/api/roles/[id]/route");

    const req = makeRequest("http://localhost:3777/api/roles/abc", {
      method: "PUT",
      body: JSON.stringify({ role: "Title" }),
    });

    const res = await PUT(req, { params: Promise.resolve({ id: "abc" }) });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("returns 404 when role does not exist", async () => {
    mockRoleFindUnique.mockResolvedValue(null);

    vi.resetModules();
    const { PUT } = await import("@/app/api/roles/[id]/route");

    const req = makeRequest("http://localhost:3777/api/roles/9999", {
      method: "PUT",
      body: JSON.stringify({ role: "New Title" }),
    });

    const res = await PUT(req, { params: Promise.resolve({ id: "9999" }) });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.code).toBe("NOT_FOUND");
  });

  it("returns 403 when trying to edit a preset role", async () => {
    const presetRole = makePresetRole({ id: 1, isPreset: true });
    mockRoleFindUnique.mockResolvedValue(presetRole);

    vi.resetModules();
    const { PUT } = await import("@/app/api/roles/[id]/route");

    const req = makeRequest("http://localhost:3777/api/roles/1", {
      method: "PUT",
      body: JSON.stringify({ role: "Trying to change" }),
    });

    const res = await PUT(req, { params: Promise.resolve({ id: "1" }) });
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.code).toBe("FORBIDDEN");
  });

  it("returns 409 when renaming to an existing name", async () => {
    const existingRole = makeCustomRole({ id: 100, name: "current-name" });
    mockRoleFindUnique
      .mockResolvedValueOnce(existingRole) // first call: fetch the role to update
      .mockResolvedValueOnce(makePresetRole({ name: "architect" })); // second call: check name conflict

    vi.resetModules();
    const { PUT } = await import("@/app/api/roles/[id]/route");

    const req = makeRequest("http://localhost:3777/api/roles/100", {
      method: "PUT",
      body: JSON.stringify({ name: "architect" }), // name already exists
    });

    const res = await PUT(req, { params: Promise.resolve({ id: "100" }) });
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.code).toBe("CONFLICT");
  });

  it("returns 400 for invalid agentType in update", async () => {
    const existingRole = makeCustomRole({ id: 100 });
    mockRoleFindUnique.mockResolvedValue(existingRole);

    vi.resetModules();
    const { PUT } = await import("@/app/api/roles/[id]/route");

    const req = makeRequest("http://localhost:3777/api/roles/100", {
      method: "PUT",
      body: JSON.stringify({ agentType: "not-valid" }),
    });

    const res = await PUT(req, { params: Promise.resolve({ id: "100" }) });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("allows same name update without conflict (name unchanged)", async () => {
    const existingRole = makeCustomRole({ id: 100, name: "my-role" });
    const updatedRole = { ...existingRole, description: "Updated description" };

    mockRoleFindUnique.mockResolvedValue(existingRole);
    mockRoleUpdate.mockResolvedValue(updatedRole);

    vi.resetModules();
    const { PUT } = await import("@/app/api/roles/[id]/route");

    const req = makeRequest("http://localhost:3777/api/roles/100", {
      method: "PUT",
      body: JSON.stringify({ name: "my-role", description: "Updated description" }),
    });

    // name is same as existing → should not check conflict
    const res = await PUT(req, { params: Promise.resolve({ id: "100" }) });
    expect(res.status).toBe(200);
  });

  it("calls db.teamMemberRole.update with correct data", async () => {
    const existingRole = makeCustomRole({ id: 100 });
    const updatedRole = { ...existingRole, role: "New Title" };

    mockRoleFindUnique.mockResolvedValue(existingRole);
    mockRoleUpdate.mockResolvedValue(updatedRole);

    vi.resetModules();
    const { PUT } = await import("@/app/api/roles/[id]/route");

    const req = makeRequest("http://localhost:3777/api/roles/100", {
      method: "PUT",
      body: JSON.stringify({ role: "New Title" }),
    });

    await PUT(req, { params: Promise.resolve({ id: "100" }) });

    expect(mockRoleUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 100 },
        data: expect.objectContaining({ role: "New Title" }),
      })
    );
  });
});

// =============================================================================
// 5. DELETE /api/roles/[id] — delete a custom role
// =============================================================================

describe("DELETE /api/roles/[id] — delete a custom role", () => {
  it("deletes an existing custom role", async () => {
    const customRole = makeCustomRole({ id: 200 });
    mockRoleFindUnique.mockResolvedValue(customRole);
    mockRoleDelete.mockResolvedValue(customRole);

    vi.resetModules();
    const { DELETE } = await import("@/app/api/roles/[id]/route");

    const req = makeRequest("http://localhost:3777/api/roles/200", { method: "DELETE" });
    const res = await DELETE(req, { params: Promise.resolve({ id: "200" }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.deleted).toBe(true);
  });

  it("calls db.teamMemberRole.delete with the correct numeric id", async () => {
    const customRole = makeCustomRole({ id: 200 });
    mockRoleFindUnique.mockResolvedValue(customRole);
    mockRoleDelete.mockResolvedValue(customRole);

    vi.resetModules();
    const { DELETE } = await import("@/app/api/roles/[id]/route");

    const req = makeRequest("http://localhost:3777/api/roles/200", { method: "DELETE" });
    await DELETE(req, { params: Promise.resolve({ id: "200" }) });

    expect(mockRoleDelete).toHaveBeenCalledWith({ where: { id: 200 } });
  });

  it("returns 400 for non-numeric ID", async () => {
    vi.resetModules();
    const { DELETE } = await import("@/app/api/roles/[id]/route");

    const req = makeRequest("http://localhost:3777/api/roles/custom-abc", { method: "DELETE" });
    const res = await DELETE(req, { params: Promise.resolve({ id: "custom-abc" }) });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(body.error).toContain("Invalid role ID");
  });

  it("returns 404 when role does not exist", async () => {
    mockRoleFindUnique.mockResolvedValue(null);

    vi.resetModules();
    const { DELETE } = await import("@/app/api/roles/[id]/route");

    const req = makeRequest("http://localhost:3777/api/roles/9999", { method: "DELETE" });
    const res = await DELETE(req, { params: Promise.resolve({ id: "9999" }) });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.code).toBe("NOT_FOUND");
  });

  it("returns 403 when trying to delete a preset role", async () => {
    const presetRole = makePresetRole({ id: 1, isPreset: true });
    mockRoleFindUnique.mockResolvedValue(presetRole);

    vi.resetModules();
    const { DELETE } = await import("@/app/api/roles/[id]/route");

    const req = makeRequest("http://localhost:3777/api/roles/1", { method: "DELETE" });
    const res = await DELETE(req, { params: Promise.resolve({ id: "1" }) });
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.code).toBe("FORBIDDEN");
  });

  it("does not call delete on a non-existent role", async () => {
    mockRoleFindUnique.mockResolvedValue(null);

    vi.resetModules();
    const { DELETE } = await import("@/app/api/roles/[id]/route");

    const req = makeRequest("http://localhost:3777/api/roles/999", { method: "DELETE" });
    await DELETE(req, { params: Promise.resolve({ id: "999" }) });

    expect(mockRoleDelete).not.toHaveBeenCalled();
  });
});

// =============================================================================
// 6. POST /api/queue — submit task with optional team members
// =============================================================================

describe("POST /api/queue — submit task with optional team members", () => {
  it("creates a task without teamMembers (empty default)", async () => {
    const createdTask = makeQueuedTask({ id: 10 });
    mockQueuedTaskCreate.mockResolvedValue(createdTask);

    vi.resetModules();
    const { POST } = await import("@/app/api/queue/route");

    const req = makeRequest("http://localhost:3777/api/queue", {
      method: "POST",
      body: JSON.stringify({
        goal: "Build a REST API",
        projectPath: "/tmp/project",
      }),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.data).toBeDefined();
    expect(body.data.id).toBe(10);
  });

  it("creates a task with selected team member roles", async () => {
    const teamMembers = [
      makePresetRole({ id: 1, name: "architect" }),
      makePresetRole({ id: 3, name: "backend-dev" }),
    ];
    const createdTask = makeQueuedTask({
      id: 11,
      teamMembers: JSON.stringify(teamMembers),
    });
    mockQueuedTaskCreate.mockResolvedValue(createdTask);

    vi.resetModules();
    const { POST } = await import("@/app/api/queue/route");

    const req = makeRequest("http://localhost:3777/api/queue", {
      method: "POST",
      body: JSON.stringify({
        goal: "Build a REST API",
        teamMembers,
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);
    expect(mockQueuedTaskCreate).toHaveBeenCalled();
  });

  it("returns 400 when goal is missing", async () => {
    vi.resetModules();
    const { POST } = await import("@/app/api/queue/route");

    const req = makeRequest("http://localhost:3777/api/queue", {
      method: "POST",
      body: JSON.stringify({ projectPath: "/tmp", teamMembers: [] }),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when goal is whitespace only", async () => {
    vi.resetModules();
    const { POST } = await import("@/app/api/queue/route");

    const req = makeRequest("http://localhost:3777/api/queue", {
      method: "POST",
      body: JSON.stringify({ goal: "   ", teamMembers: [] }),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("creates a task with a mix of preset and custom roles", async () => {
    const teamMembers = [
      makePresetRole({ id: 4, name: "tester" }),
      makeCustomRole({ id: 100, name: "domain-expert" }),
    ];
    const createdTask = makeQueuedTask({
      id: 12,
      teamMembers: JSON.stringify(teamMembers),
    });
    mockQueuedTaskCreate.mockResolvedValue(createdTask);

    vi.resetModules();
    const { POST } = await import("@/app/api/queue/route");

    const req = makeRequest("http://localhost:3777/api/queue", {
      method: "POST",
      body: JSON.stringify({
        goal: "Build with domain expertise",
        teamMembers,
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);
  });
});

// =============================================================================
// 7. GET /api/queue/[id] — retrieve task with teamMembers
// =============================================================================

describe("GET /api/queue/[id] — retrieve task with teamMembers", () => {
  it("returns task with teamMembers field", async () => {
    const teamMembers = [makePresetRole({ id: 4, name: "tester" })];
    const task = makeQueuedTask({
      id: 20,
      goal: "Test the application",
      teamMembers: JSON.stringify(teamMembers),
    });
    mockQueuedTaskFindUnique.mockResolvedValue(task);

    vi.resetModules();
    const { GET } = await import("@/app/api/queue/[id]/route");

    const req = makeRequest("http://localhost:3777/api/queue/20");
    const res = await GET(req, { params: Promise.resolve({ id: "20" }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.id).toBe(20);
    expect(body.data.teamMembers).toBeDefined();
  });

  it("returns task with empty teamMembers when none selected", async () => {
    const task = makeQueuedTask({ id: 21, teamMembers: "[]" });
    mockQueuedTaskFindUnique.mockResolvedValue(task);

    vi.resetModules();
    const { GET } = await import("@/app/api/queue/[id]/route");

    const req = makeRequest("http://localhost:3777/api/queue/21");
    const res = await GET(req, { params: Promise.resolve({ id: "21" }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.teamMembers).toBe("[]");
  });

  it("returns 404 for non-existent task", async () => {
    mockQueuedTaskFindUnique.mockResolvedValue(null);

    vi.resetModules();
    const { GET } = await import("@/app/api/queue/[id]/route");

    const req = makeRequest("http://localhost:3777/api/queue/9999");
    const res = await GET(req, { params: Promise.resolve({ id: "9999" }) });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.code).toBe("NOT_FOUND");
  });

  it("returns 400 for invalid non-numeric task id", async () => {
    vi.resetModules();
    const { GET } = await import("@/app/api/queue/[id]/route");

    const req = makeRequest("http://localhost:3777/api/queue/not-a-number");
    const res = await GET(req, { params: Promise.resolve({ id: "not-a-number" }) });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("preserves the teamMembers JSON string exactly as stored", async () => {
    const storedJson = JSON.stringify([
      { id: 1, name: "architect", role: "Architect", agentType: "general-purpose", description: "...", isPreset: true },
    ]);
    const task = makeQueuedTask({ id: 30, teamMembers: storedJson });
    mockQueuedTaskFindUnique.mockResolvedValue(task);

    vi.resetModules();
    const { GET } = await import("@/app/api/queue/[id]/route");

    const req = makeRequest("http://localhost:3777/api/queue/30");
    const res = await GET(req, { params: Promise.resolve({ id: "30" }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.teamMembers).toBe(storedJson);
  });
});

// =============================================================================
// 8. Full lifecycle: create role → submit task → retrieve task
// =============================================================================

describe("Full lifecycle: create role → submit task → verify team members", () => {
  it("creates a custom role, uses it in a task, verifies retrieval", async () => {
    // Step 1: Create a new custom role
    const newRoleData = {
      name: "lifecycle-specialist",
      role: "Lifecycle Specialist",
      agentType: "Explore" as const,
      description: "Handles lifecycle management tasks",
      isPreset: false,
    };
    const createdRoleFromDB = {
      id: 150,
      ...newRoleData,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockRoleFindUnique.mockResolvedValue(null); // no name conflict
    mockRoleCreate.mockResolvedValue(createdRoleFromDB);

    vi.resetModules();
    const { POST: createRole } = await import("@/app/api/roles/route");

    const createReq = makeRequest("http://localhost:3777/api/roles", {
      method: "POST",
      body: JSON.stringify(newRoleData),
    });

    const createRes = await createRole(createReq);
    expect(createRes.status).toBe(201);
    const createBody = await createRes.json();
    expect(createBody.data.id).toBe(150);
    expect(createBody.data.name).toBe("lifecycle-specialist");

    // Step 2: Submit a task with the created role
    vi.clearAllMocks();
    const selectedRoles = [createdRoleFromDB];
    const createdTask = makeQueuedTask({
      id: 200,
      goal: "Run lifecycle management",
      teamMembers: JSON.stringify(selectedRoles),
    });
    mockQueuedTaskCreate.mockResolvedValue(createdTask);
    mockQueuedTaskGroupBy.mockResolvedValue([]);

    vi.resetModules();
    const { POST: createTask } = await import("@/app/api/queue/route");

    const taskReq = makeRequest("http://localhost:3777/api/queue", {
      method: "POST",
      body: JSON.stringify({
        goal: "Run lifecycle management",
        teamMembers: selectedRoles,
      }),
    });

    const taskRes = await createTask(taskReq);
    expect(taskRes.status).toBe(201);
    const taskBody = await taskRes.json();
    expect(taskBody.data.id).toBe(200);

    // Step 3: Retrieve the task and verify teamMembers preserved
    vi.clearAllMocks();
    mockQueuedTaskFindUnique.mockResolvedValue(createdTask);

    vi.resetModules();
    const { GET: getTask } = await import("@/app/api/queue/[id]/route");

    const getReq = makeRequest("http://localhost:3777/api/queue/200");
    const getRes = await getTask(getReq, { params: Promise.resolve({ id: "200" }) });
    const getBody = await getRes.json();

    expect(getRes.status).toBe(200);
    expect(getBody.data.id).toBe(200);
    const parsedMembers = JSON.parse(getBody.data.teamMembers as string) as Array<{ name: string }>;
    expect(parsedMembers).toHaveLength(1);
    expect(parsedMembers[0].name).toBe("lifecycle-specialist");
  });
});

// =============================================================================
// 9. Validation edge cases
// =============================================================================

describe("Validation edge cases", () => {
  it("GET /api/roles/[id] accepts zero as a valid numeric ID (returns 404 since no such role)", async () => {
    mockRoleFindUnique.mockResolvedValue(null);

    vi.resetModules();
    const { GET } = await import("@/app/api/roles/[id]/route");

    const req = makeRequest("http://localhost:3777/api/roles/0");
    const res = await GET(req, { params: Promise.resolve({ id: "0" }) });
    const body = await res.json();

    // 0 is a valid integer, so should not give 400 — returns 404 since no role with id=0
    expect(res.status).toBe(404);
    expect(body.code).toBe("NOT_FOUND");
  });

  it("POST /api/roles rejects empty name string", async () => {
    vi.resetModules();
    const { POST } = await import("@/app/api/roles/route");

    const req = makeRequest("http://localhost:3777/api/roles", {
      method: "POST",
      body: JSON.stringify({ name: "  ", role: "Role", agentType: "general-purpose", description: "desc" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("VALIDATION_ERROR");
  });

  it("POST /api/roles rejects empty role title string", async () => {
    vi.resetModules();
    const { POST } = await import("@/app/api/roles/route");

    const req = makeRequest("http://localhost:3777/api/roles", {
      method: "POST",
      body: JSON.stringify({ name: "valid-name", role: "  ", agentType: "general-purpose", description: "desc" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("VALIDATION_ERROR");
  });

  it("POST /api/roles rejects empty description string", async () => {
    vi.resetModules();
    const { POST } = await import("@/app/api/roles/route");

    const req = makeRequest("http://localhost:3777/api/roles", {
      method: "POST",
      body: JSON.stringify({ name: "valid-name", role: "Valid Role", agentType: "general-purpose", description: "  " }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("VALIDATION_ERROR");
  });

  it("DELETE /api/roles/[id] returns 403 not 404 for preset roles", async () => {
    const presetRole = makePresetRole({ id: 2, isPreset: true });
    mockRoleFindUnique.mockResolvedValue(presetRole);

    vi.resetModules();
    const { DELETE } = await import("@/app/api/roles/[id]/route");

    const req = makeRequest("http://localhost:3777/api/roles/2", { method: "DELETE" });
    const res = await DELETE(req, { params: Promise.resolve({ id: "2" }) });
    const body = await res.json();

    // Preset roles return 403 FORBIDDEN, not 404 NOT_FOUND
    expect(res.status).toBe(403);
    expect(body.code).toBe("FORBIDDEN");
  });

  it("PUT /api/roles/[id] returns 403 not 404 for preset roles", async () => {
    const presetRole = makePresetRole({ id: 2, isPreset: true });
    mockRoleFindUnique.mockResolvedValue(presetRole);

    vi.resetModules();
    const { PUT } = await import("@/app/api/roles/[id]/route");

    const req = makeRequest("http://localhost:3777/api/roles/2", {
      method: "PUT",
      body: JSON.stringify({ role: "Change preset" }),
    });
    const res = await PUT(req, { params: Promise.resolve({ id: "2" }) });
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.code).toBe("FORBIDDEN");
  });
});
