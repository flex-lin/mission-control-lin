import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import {
  toKebabCase,
  deriveNameFromGoal,
  ensureUniqueName,
  generateLocalPlan,
  generateTeamPlan,
} from "@/lib/team-planner";

const CLAUDE_DIR = path.join(process.env.HOME ?? "/root", ".claude");

// ── toKebabCase ──────────────────────────────────────────────────────────────

describe("toKebabCase", () => {
  it("converts spaces to dashes", () => {
    expect(toKebabCase("hello world")).toBe("hello-world");
  });

  it("lowercases all characters", () => {
    expect(toKebabCase("Hello World")).toBe("hello-world");
  });

  it("strips non-alphanumeric characters (except dashes)", () => {
    expect(toKebabCase("hello! @world#")).toBe("hello-world");
  });

  it("collapses multiple dashes", () => {
    expect(toKebabCase("hello---world")).toBe("hello-world");
  });

  it("trims leading and trailing dashes", () => {
    expect(toKebabCase("--hello-world--")).toBe("hello-world");
  });

  it("truncates to 40 characters", () => {
    const long = "this is a very long string that exceeds forty characters limit";
    expect(toKebabCase(long).length).toBeLessThanOrEqual(40);
  });

  it("handles empty string", () => {
    expect(toKebabCase("")).toBe("");
  });

  it("handles string with only special characters", () => {
    expect(toKebabCase("!@#$%^&*")).toBe("");
  });
});

// ── deriveNameFromGoal ───────────────────────────────────────────────────────

describe("deriveNameFromGoal", () => {
  it("strips common stop words", () => {
    const result = deriveNameFromGoal("Create a REST API for user management");
    expect(result).not.toContain("create");
    expect(result).not.toContain("for");
    expect(result).toContain("rest");
    expect(result).toContain("api");
    expect(result).toContain("user");
    expect(result).toContain("management");
  });

  it("returns kebab-case output", () => {
    const result = deriveNameFromGoal("Build inventory tracking system");
    expect(result).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it("keeps at most 5 meaningful words", () => {
    const result = deriveNameFromGoal(
      "Build advanced real-time collaborative document editing system"
    );
    const parts = result.split("-");
    expect(parts.length).toBeLessThanOrEqual(5);
  });

  it("returns empty string when all words are stop words", () => {
    expect(deriveNameFromGoal("I would like to create a")).toBe("");
  });

  it("filters single-character words", () => {
    const result = deriveNameFromGoal("Add a b c feature");
    expect(result).not.toContain("-a-");
    expect(result).not.toContain("-b-");
    expect(result).not.toContain("-c-");
  });

  it("strips special characters from goal text", () => {
    const result = deriveNameFromGoal("Fix login page's CSS bugs!");
    expect(result).toContain("fix");
    expect(result).toContain("login");
    expect(result).not.toContain("!");
    expect(result).not.toContain("'");
  });

  it("truncates to 40 characters max", () => {
    const long =
      "Refactor extremely complicated enterprise microservices architecture deployment pipeline";
    expect(deriveNameFromGoal(long).length).toBeLessThanOrEqual(40);
  });

  it("handles typical goals from CLAUDE.md examples", () => {
    expect(deriveNameFromGoal("Add user authentication")).toContain("user");
    expect(deriveNameFromGoal("Add user authentication")).toContain(
      "authentication"
    );

    const dbResult = deriveNameFromGoal(
      "Refactor database queries for performance"
    );
    expect(dbResult).toContain("refactor");
    expect(dbResult).toContain("database");
    expect(dbResult).toContain("queries");
    expect(dbResult).toContain("performance");
  });
});

// ── ensureUniqueName ─────────────────────────────────────────────────────────

describe("ensureUniqueName", () => {
  const teamsDir = path.join(CLAUDE_DIR, "teams");
  const archiveDir = path.join(CLAUDE_DIR, "teams-archive");

  let originalReaddirSync: typeof fs.readdirSync;
  let originalExistsSync: typeof fs.existsSync;

  beforeEach(() => {
    originalReaddirSync = fs.readdirSync;
    originalExistsSync = fs.existsSync;
  });

  afterEach(() => {
    fs.readdirSync = originalReaddirSync;
    fs.existsSync = originalExistsSync;
  });

  it("returns the base name if no conflicts", () => {
    fs.existsSync = vi.fn(() => false) as unknown as typeof fs.existsSync;
    expect(ensureUniqueName("my-team")).toBe("my-team");
  });

  it("appends -2 when base name already exists in active teams", () => {
    fs.existsSync = vi.fn((p: fs.PathLike) => {
      const s = String(p);
      return s === teamsDir;
    }) as unknown as typeof fs.existsSync;

    fs.readdirSync = vi.fn((p: fs.PathLike) => {
      const s = String(p);
      if (s === teamsDir) {
        return [
          { name: "my-team", isDirectory: () => true },
        ] as unknown as fs.Dirent[];
      }
      return [] as unknown as fs.Dirent[];
    }) as unknown as typeof fs.readdirSync;

    expect(ensureUniqueName("my-team")).toBe("my-team-2");
  });

  it("appends -2 when base name exists in archive", () => {
    fs.existsSync = vi.fn((p: fs.PathLike) => {
      const s = String(p);
      return s === archiveDir;
    }) as unknown as typeof fs.existsSync;

    fs.readdirSync = vi.fn((p: fs.PathLike) => {
      const s = String(p);
      if (s === archiveDir) {
        return [
          { name: "my-team", isDirectory: () => true },
        ] as unknown as fs.Dirent[];
      }
      return [] as unknown as fs.Dirent[];
    }) as unknown as typeof fs.readdirSync;

    expect(ensureUniqueName("my-team")).toBe("my-team-2");
  });

  it("increments suffix when -2 is also taken", () => {
    fs.existsSync = vi.fn((p: fs.PathLike) => {
      const s = String(p);
      return s === teamsDir;
    }) as unknown as typeof fs.existsSync;

    fs.readdirSync = vi.fn((p: fs.PathLike) => {
      const s = String(p);
      if (s === teamsDir) {
        return [
          { name: "my-team", isDirectory: () => true },
          { name: "my-team-2", isDirectory: () => true },
          { name: "my-team-3", isDirectory: () => true },
        ] as unknown as fs.Dirent[];
      }
      return [] as unknown as fs.Dirent[];
    }) as unknown as typeof fs.readdirSync;

    expect(ensureUniqueName("my-team")).toBe("my-team-4");
  });

  it("checks both active and archived teams", () => {
    fs.existsSync = vi.fn(() => true) as unknown as typeof fs.existsSync;

    fs.readdirSync = vi.fn((p: fs.PathLike) => {
      const s = String(p);
      if (s === teamsDir) {
        return [
          { name: "my-team", isDirectory: () => true },
        ] as unknown as fs.Dirent[];
      }
      if (s === archiveDir) {
        return [
          { name: "my-team-2", isDirectory: () => true },
        ] as unknown as fs.Dirent[];
      }
      return [] as unknown as fs.Dirent[];
    }) as unknown as typeof fs.readdirSync;

    expect(ensureUniqueName("my-team")).toBe("my-team-3");
  });
});

// ── generateLocalPlan ────────────────────────────────────────────────────────

describe("generateLocalPlan", () => {
  let originalExistsSync: typeof fs.existsSync;

  beforeEach(() => {
    originalExistsSync = fs.existsSync;
    // Prevent ensureUniqueName from hitting the real filesystem
    fs.existsSync = vi.fn(() => false) as unknown as typeof fs.existsSync;
  });

  afterEach(() => {
    fs.existsSync = originalExistsSync;
  });

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

  it("derives team name from goal text instead of using generic template name", () => {
    const plan = generateLocalPlan("Build a REST API for inventory management");
    // Should derive from goal, not use generic "api-builders"
    expect(plan.teamName).toContain("rest");
    expect(plan.teamName).toContain("api");
    expect(plan.teamName).toContain("inventory");
  });

  it("falls back to template name when goal has too few meaningful words", () => {
    // "I want to" are all stop words, remaining < 3 chars
    const plan = generateLocalPlan("I want to");
    // Should fall back to best-matching template name
    expect(plan.teamName.length).toBeGreaterThan(0);
  });

  it("selects API template for API-related goals", () => {
    const plan = generateLocalPlan("Build a REST API endpoint");
    expect(plan.description).toContain("API");
    expect(plan.personas.some((p) => p.name === "backend-dev")).toBe(true);
  });

  it("selects UI template for frontend-related goals", () => {
    const plan = generateLocalPlan("Build a React dashboard component");
    expect(plan.description).toContain("frontend");
    expect(plan.personas.some((p) => p.name === "frontend-dev")).toBe(true);
  });

  it("selects refactor template for refactoring goals", () => {
    const plan = generateLocalPlan("Refactor database queries to optimize performance");
    expect(plan.description).toContain("refactor");
    expect(plan.personas.some((p) => p.name === "refactorer")).toBe(true);
  });

  it("selects QA template for testing goals", () => {
    const plan = generateLocalPlan("Write comprehensive test coverage");
    expect(plan.description).toContain("testing");
    expect(plan.personas.some((p) => p.name === "test-planner")).toBe(true);
  });

  it("defaults to fullstack template for generic goals", () => {
    const plan = generateLocalPlan("Build the application");
    expect(plan.personas.some((p) => p.name === "architect")).toBe(true);
    expect(plan.personas.some((p) => p.name === "frontend-dev")).toBe(true);
    expect(plan.personas.some((p) => p.name === "backend-dev")).toBe(true);
  });

  it("appends goal context to task descriptions", () => {
    const goal = "Build a user authentication system";
    const plan = generateLocalPlan(goal);
    for (const task of plan.initialTasks) {
      expect(task.description).toContain(`Goal context: ${goal}`);
    }
  });

  it("team name is kebab-case and max 40 chars", () => {
    const plan = generateLocalPlan(
      "Create an extremely complex multi-service distributed microservices architecture"
    );
    expect(plan.teamName).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(plan.teamName.length).toBeLessThanOrEqual(40);
  });

  it("personas have required fields", () => {
    const plan = generateLocalPlan("Build something");
    for (const p of plan.personas) {
      expect(p).toHaveProperty("name");
      expect(p).toHaveProperty("role");
      expect(p).toHaveProperty("agentType");
      expect(p).toHaveProperty("description");
      expect(typeof p.name).toBe("string");
      expect(typeof p.role).toBe("string");
    }
  });
});

// ── generateTeamPlan (API integration) ───────────────────────────────────────

// We mock the module used by team-planner.ts.
// The module's default export is the Anthropic class constructor.
const mockCreate = vi.fn();

vi.mock("@anthropic-ai/sdk", () => {
  // Return a class-like constructor
  function MockAnthropic() {
    return { messages: { create: mockCreate } };
  }
  return { default: MockAnthropic };
});

describe("generateTeamPlan", () => {
  const originalEnv = process.env.ANTHROPIC_API_KEY;

  beforeEach(() => {
    mockCreate.mockReset();
    // Prevent filesystem access for ensureUniqueName
    vi.spyOn(fs, "existsSync").mockReturnValue(false);
  });

  afterEach(() => {
    process.env.ANTHROPIC_API_KEY = originalEnv;
    vi.restoreAllMocks();
  });

  it("falls back to local plan when no API key is set", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const result = await generateTeamPlan("Build a REST API");
    expect(result._source).toBe("local");
    expect(result.teamName).toBeTruthy();
    expect(result.personas.length).toBeGreaterThan(0);
  });

  it("falls back to local plan with reason on API error (invalid key)", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test-invalid-key";
    mockCreate.mockRejectedValue(
      new Error("authentication failed: invalid x-api-key")
    );

    const result = await generateTeamPlan("Build a REST API");
    expect(result._source).toBe("local");
    expect(result._fallbackReason).toBe("invalid_key");
  });

  it("falls back with insufficient_credits reason", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test-key";
    mockCreate.mockRejectedValue(
      new Error("Your credit balance is too low")
    );

    const result = await generateTeamPlan("Build a REST API");
    expect(result._source).toBe("local");
    expect(result._fallbackReason).toBe("insufficient_credits");
  });

  it("falls back with api_error for generic errors", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test-key";
    mockCreate.mockRejectedValue(new Error("Connection timeout"));

    const result = await generateTeamPlan("Build a REST API");
    expect(result._source).toBe("local");
    expect(result._fallbackReason).toBe("api_error");
  });

  it("includes projectPath in user prompt when provided", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test-key";
    mockCreate.mockResolvedValue({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            teamName: "test-team",
            description: "Test",
            personas: [
              {
                name: "dev",
                role: "Dev",
                agentType: "general-purpose",
                description: "test",
              },
            ],
            initialTasks: [],
          }),
        },
      ],
    });

    await generateTeamPlan("Build a REST API", "/home/user/project");

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          {
            role: "user",
            content: "Goal: Build a REST API\nProject path: /home/user/project",
          },
        ],
      })
    );
  });

  it("returns AI plan with _source 'ai' on success", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test-key";
    mockCreate.mockResolvedValue({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            teamName: "user-auth-impl",
            description: "Implement user authentication",
            personas: [
              {
                name: "backend-dev",
                role: "Backend Developer",
                agentType: "general-purpose",
                description: "Implements auth",
              },
            ],
            initialTasks: [
              {
                subject: "Set up auth",
                description: "Implement auth system",
                assignTo: "backend-dev",
              },
            ],
          }),
        },
      ],
    });

    const result = await generateTeamPlan("Add user authentication");
    expect(result._source).toBe("ai");
    expect(result.teamName).toBe("user-auth-impl");
    expect(result.personas).toHaveLength(1);
    expect(result.initialTasks).toHaveLength(1);
  });

  it("falls back when AI returns invalid plan (no personas)", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test-key";
    mockCreate.mockResolvedValue({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            teamName: "broken-plan",
            description: "Bad plan",
            personas: [],
            initialTasks: [],
          }),
        },
      ],
    });

    const result = await generateTeamPlan("Build something");
    expect(result._source).toBe("local");
    expect(result._fallbackReason).toBe("invalid_plan");
  });

  it("falls back when AI returns no text block", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test-key";
    mockCreate.mockResolvedValue({ content: [] });

    const result = await generateTeamPlan("Build something");
    expect(result._source).toBe("local");
    expect(result._fallbackReason).toBe("no_text_response");
  });

  it("ensures AI-generated team name is unique", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test-key";

    // Simulate "user-auth-impl" already exists
    const teamsDir = path.join(CLAUDE_DIR, "teams");
    vi.restoreAllMocks();
    vi.spyOn(fs, "existsSync").mockImplementation((p: fs.PathLike) => {
      return String(p) === teamsDir;
    });
    vi.spyOn(fs, "readdirSync").mockImplementation((p: fs.PathLike) => {
      if (String(p) === teamsDir) {
        return [
          { name: "user-auth-impl", isDirectory: () => true },
        ] as unknown as fs.Dirent[];
      }
      return [] as unknown as fs.Dirent[];
    });

    mockCreate.mockResolvedValue({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            teamName: "user-auth-impl",
            description: "Auth implementation",
            personas: [
              {
                name: "dev",
                role: "Dev",
                agentType: "general-purpose",
                description: "dev",
              },
            ],
            initialTasks: [],
          }),
        },
      ],
    });

    const result = await generateTeamPlan("Add user auth");
    expect(result.teamName).toBe("user-auth-impl-2");
  });

  it("handles AI response with missing initialTasks gracefully", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test-key";
    mockCreate.mockResolvedValue({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            teamName: "no-tasks-team",
            description: "Team without tasks",
            personas: [
              {
                name: "dev",
                role: "Dev",
                agentType: "general-purpose",
                description: "dev",
              },
            ],
            // initialTasks intentionally omitted
          }),
        },
      ],
    });

    const result = await generateTeamPlan("Do something");
    expect(result._source).toBe("ai");
    expect(result.initialTasks).toEqual([]);
  });
});

// ── Queue worker naming convention ───────────────────────────────────────────

describe("queue worker team naming", () => {
  beforeEach(() => {
    vi.spyOn(fs, "existsSync").mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("queue worker uses q-{id}-{planName} pattern", () => {
    // Simulate what queue-worker.ts does: `q-${task.id}-${plan.teamName}`
    const taskId = 5;
    const plan = generateLocalPlan("Build user authentication system");
    const teamName = ensureUniqueName(`q-${taskId}-${plan.teamName}`);

    expect(teamName).toMatch(/^q-5-/);
    // Should contain meaningful words from the goal
    expect(teamName).toContain("user");
    expect(teamName).toContain("authentication");
  });

  it("queue names remain unique across multiple tasks with same goal", () => {
    const teamsDir = path.join(CLAUDE_DIR, "teams");

    vi.restoreAllMocks();
    vi.spyOn(fs, "existsSync").mockImplementation((p: fs.PathLike) => {
      return String(p) === teamsDir;
    });
    vi.spyOn(fs, "readdirSync").mockImplementation((p: fs.PathLike) => {
      if (String(p) === teamsDir) {
        return [
          { name: "q-1-rest-api-inventory", isDirectory: () => true },
        ] as unknown as fs.Dirent[];
      }
      return [] as unknown as fs.Dirent[];
    });

    const plan = generateLocalPlan("Build REST API for inventory");
    const name1 = `q-1-${plan.teamName}`;
    const name2 = ensureUniqueName(`q-2-${plan.teamName}`);

    // Different task IDs should produce different names
    expect(name1).not.toBe(name2);
  });
});
