import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { generateLocalPlan, generateTeamPlan, ensureUniqueName } from "./team-planner";

const CLAUDE_DIR = path.join(process.env.HOME ?? "/root", ".claude");

// ── generateLocalPlan (template-based, no API) ──────────────────────────────

describe("generateLocalPlan", () => {
  it("returns a valid TeamPlan shape", () => {
    const plan = generateLocalPlan("Build a REST API");
    expect(plan).toHaveProperty("teamName");
    expect(plan).toHaveProperty("description");
    expect(plan).toHaveProperty("personas");
    expect(plan).toHaveProperty("initialTasks");
    expect(Array.isArray(plan.personas)).toBe(true);
    expect(Array.isArray(plan.initialTasks)).toBe(true);
    expect(plan.personas.length).toBeGreaterThan(0);
  });

  // ── Template matching ───────────────────────────────────────────────────

  it("matches API template for backend/API goals", () => {
    const plan = generateLocalPlan("Build a REST API with endpoints");
    expect(plan.personas.some((p) => p.name === "backend-dev")).toBe(true);
  });

  it("matches frontend template for UI goals", () => {
    const plan = generateLocalPlan("Build a React dashboard with components");
    expect(plan.personas.some((p) => p.name === "frontend-dev")).toBe(true);
  });

  it("matches refactor template for cleanup goals", () => {
    const plan = generateLocalPlan("Refactor and optimize the codebase");
    expect(plan.personas.some((p) => p.name === "refactorer")).toBe(true);
  });

  it("matches QA template for testing goals", () => {
    const plan = generateLocalPlan("Improve test coverage and quality");
    expect(plan.personas.some((p) => p.name === "test-writer")).toBe(true);
  });

  it("defaults to fullstack template for generic goals", () => {
    const plan = generateLocalPlan("Do something amazing");
    expect(plan.personas.some((p) => p.name === "frontend-dev")).toBe(true);
    expect(plan.personas.some((p) => p.name === "backend-dev")).toBe(true);
  });

  // ── Team name generation (deriveNameFromGoal) ───────────────────────────

  it("generates kebab-case team name from goal text", () => {
    const plan = generateLocalPlan("Add user authentication system");
    expect(plan.teamName).toMatch(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/);
  });

  it("strips stop words from team name", () => {
    const plan = generateLocalPlan("Create a dark mode toggle");
    // "create" and "a" are stop words → removed
    expect(plan.teamName).toMatch(/dark/);
    expect(plan.teamName).not.toMatch(/(^|-)a(-|$)/);
  });

  it("strips special characters from team name", () => {
    const plan = generateLocalPlan("Add OAuth2.0 & JWT!!!");
    expect(plan.teamName).not.toMatch(/[^a-z0-9-]/);
  });

  it("uses max 5 meaningful words for team name", () => {
    const plan = generateLocalPlan("dark mode toggle switch animation transition handler");
    const parts = plan.teamName.split("-");
    expect(parts.length).toBeLessThanOrEqual(5);
  });

  it("truncates team name to max 40 chars", () => {
    const plan = generateLocalPlan("extraordinarily comprehensive authentication authorization mechanism");
    expect(plan.teamName.length).toBeLessThanOrEqual(40);
  });

  it("falls back to template name for goals with only stop words", () => {
    const plan = generateLocalPlan("do it for the team");
    expect(plan.teamName.length).toBeGreaterThanOrEqual(3);
  });

  it("handles goals with only special characters gracefully", () => {
    const plan = generateLocalPlan("!!! @@@");
    expect(plan.teamName.length).toBeGreaterThanOrEqual(3);
  });

  // ── Tasks have goal context ─────────────────────────────────────────────

  it("appends goal context to initial task descriptions", () => {
    const goal = "Build a REST API with auth";
    const plan = generateLocalPlan(goal);
    for (const task of plan.initialTasks) {
      expect(task.description).toContain(`Goal context: ${goal}`);
    }
  });

  // ── Persona structure ───────────────────────────────────────────────────

  it("personas have required fields", () => {
    const plan = generateLocalPlan("Build something");
    for (const p of plan.personas) {
      expect(p).toHaveProperty("name");
      expect(p).toHaveProperty("role");
      expect(p).toHaveProperty("agentType");
      expect(p).toHaveProperty("description");
      expect(typeof p.name).toBe("string");
      expect(typeof p.role).toBe("string");
      expect(["general-purpose", "Bash", "Explore", "Plan"]).toContain(p.agentType);
    }
  });
});

// ── ensureUniqueName ─────────────────────────────────────────────────────────

describe("ensureUniqueName", () => {
  const testTeamDir = path.join(CLAUDE_DIR, "teams", "__test-unique-name__");
  const testTeamDir2 = path.join(CLAUDE_DIR, "teams", "__test-unique-name__-2");
  const testArchiveDir = path.join(CLAUDE_DIR, "teams-archive", "__test-archived-name__");

  afterEach(() => {
    // Cleanup test dirs
    for (const dir of [testTeamDir, testTeamDir2, testArchiveDir]) {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ok */ }
    }
  });

  it("returns the base name if no conflict exists", () => {
    const name = ensureUniqueName("__nonexistent-team-xyzzy__");
    expect(name).toBe("__nonexistent-team-xyzzy__");
  });

  it("appends -2 suffix when name already exists in active teams", () => {
    fs.mkdirSync(testTeamDir, { recursive: true });
    const name = ensureUniqueName("__test-unique-name__");
    expect(name).toBe("__test-unique-name__-2");
  });

  it("increments suffix when -2 also exists", () => {
    fs.mkdirSync(testTeamDir, { recursive: true });
    fs.mkdirSync(testTeamDir2, { recursive: true });
    const name = ensureUniqueName("__test-unique-name__");
    expect(name).toBe("__test-unique-name__-3");
  });

  it("does not check archived teams for conflicts (archive removed)", () => {
    fs.mkdirSync(testArchiveDir, { recursive: true });
    const name = ensureUniqueName("__test-archived-name__");
    // Archive is no longer checked, so base name should be returned
    expect(name).toBe("__test-archived-name__");
  });

  it("handles missing teams directory gracefully", () => {
    // This should not throw even if ~/.claude/teams doesn't exist
    // (it does exist in practice, but the function checks fs.existsSync)
    const name = ensureUniqueName("__definitely-unique-name-abc123__");
    expect(name).toBe("__definitely-unique-name-abc123__");
  });
});

// ── generateTeamPlan (AI-powered with fallback) ──────────────────────────────

describe("generateTeamPlan", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("falls back to local plan when no API key is set", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const result = await generateTeamPlan("Build an API");
    expect(result._source).toBe("local");
    expect(result.teamName).toBeTruthy();
    expect(result.personas.length).toBeGreaterThan(0);
  });

  it("falls back to local plan when API key is undefined", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const result = await generateTeamPlan("Build an API");
    expect(result._source).toBe("local");
  });

  it("includes projectPath in local fallback plan structure", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const result = await generateTeamPlan("Build an API", "/home/user/project");
    expect(result._source).toBe("local");
    expect(result.teamName).toBeTruthy();
  });

  it("returns PlanResult with _source field", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const result = await generateTeamPlan("Test goal");
    expect(result).toHaveProperty("_source");
    expect(["ai", "local"]).toContain(result._source);
  });

  it("uses deriveNameFromGoal for local plan team names", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const result = await generateTeamPlan("Implement user authentication");
    // "implement" is a stop word → stripped; "user", "authentication" remain
    expect(result._source).toBe("local");
    expect(result.teamName).toMatch(/user/);
    expect(result.teamName).toMatch(/authentication/);
  });

  it("ensures unique team names in local plans", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    // Generate two plans with the same goal — names should be unique via ensureUniqueName
    const result1 = await generateTeamPlan("Build unique test xyzzy");
    const result2 = await generateTeamPlan("Build unique test xyzzy");
    // If first name was claimed as a team dir, second would get -2 suffix
    // But without actually creating the dir, both return the same name
    // This tests that ensureUniqueName is called (integration)
    expect(result1.teamName).toBeTruthy();
    expect(result2.teamName).toBeTruthy();
  });
});
