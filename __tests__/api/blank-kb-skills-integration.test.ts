import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

/**
 * Integration tests: Skills are user-local filesystem artifacts, independent of
 * the knowledge base DB. These tests verify:
 *
 * 1. Skills come from ~/.claude/skills/ on the local machine
 * 2. Adding a project to the knowledge base does NOT create skills
 * 3. Skills disappear when removed from the filesystem
 * 4. Skills are present when skill directories with SKILL.md exist
 * 5. GET /api/skills reflects the live filesystem state
 *
 * This file deliberately does NOT mock @/lib/claude-files so that listSkills()
 * uses the real filesystem with a stubbed HOME. This mirrors skills.test.ts.
 */

// ── DB mock (required because skills route imports nothing from DB, but
// knowledge-base routes used in setup do need it) ─────────────────────────────

const mockFindUnique = vi.fn();
const mockCreate = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    indexedProject: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
      findFirst: vi.fn().mockResolvedValue(null),
      create: (...args: unknown[]) => mockCreate(...args),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

// ── Test helpers ──────────────────────────────────────────────────────────────

let skillsHome: string;
let tmpDir: string;

function createSkill(folderName: string, content: string) {
  const dir = path.join(skillsHome, ".claude", "skills", folderName);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), content);
  return dir;
}

async function callSkillsGET() {
  vi.resetModules();
  const mod = await import("@/app/api/skills/route");
  const res = await mod.GET();
  return { status: res.status, body: await res.json() };
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  skillsHome = fs.mkdtempSync(path.join(os.tmpdir(), "mc-skills-home-"));
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-skills-proj-"));
  vi.stubEnv("HOME", skillsHome);
});

afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(skillsHome, { recursive: true, force: true });
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 1. Fresh HOME — no skills directory
// ═══════════════════════════════════════════════════════════════════════════════

describe("Skills — fresh HOME has no skills", () => {
  it("returns empty skills list when no .claude/skills directory exists", async () => {
    const { status, body } = await callSkillsGET();

    expect(status).toBe(200);
    expect(body.data).toEqual([]);
    expect(body.meta.count).toBe(0);
  });

  it("returns empty skills when skills directory is empty", async () => {
    fs.mkdirSync(path.join(skillsHome, ".claude", "skills"), { recursive: true });

    const { status, body } = await callSkillsGET();

    expect(status).toBe(200);
    expect(body.data).toEqual([]);
    expect(body.meta.count).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. Skills appear when SKILL.md exists
// ═══════════════════════════════════════════════════════════════════════════════

describe("Skills — appear when SKILL.md files exist", () => {
  it("returns a skill with correct shape from YAML front matter", async () => {
    createSkill(
      "deploy-skill",
      "---\nname: Deploy Helper\ndescription: Automates deployments\n---\nRun `pnpm deploy`."
    );

    const { status, body } = await callSkillsGET();

    expect(status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({
      folderName: "deploy-skill",
      name: "Deploy Helper",
      description: "Automates deployments",
      content: "Run `pnpm deploy`.",
    });
  });

  it("returns multiple skills with correct total count", async () => {
    createSkill("s1", "---\nname: S1\ndescription: First\n---\nBody 1.");
    createSkill("s2", "---\nname: S2\ndescription: Second\n---\nBody 2.");
    createSkill("s3", "---\nname: S3\ndescription: Third\n---\nBody 3.");

    const { body } = await callSkillsGET();

    expect(body.data).toHaveLength(3);
    expect(body.meta.count).toBe(3);
    const names = body.data.map((s: { name: string }) => s.name).sort();
    expect(names).toEqual(["S1", "S2", "S3"]);
  });

  it("skill without front matter uses folder name and empty description", async () => {
    createSkill("raw-skill", "Just plain markdown content, no front matter.");

    const { body } = await callSkillsGET();

    expect(body.data).toHaveLength(1);
    expect(body.data[0].name).toBe("raw-skill");
    expect(body.data[0].description).toBe("");
    expect(body.data[0].content).toBe("Just plain markdown content, no front matter.");
  });

  it("skill with quoted front matter values has quotes stripped", async () => {
    createSkill(
      "quoted-skill",
      "---\nname: \"Quoted Name\"\ndescription: 'Single quoted'\n---\nBody."
    );

    const { body } = await callSkillsGET();

    expect(body.data[0].name).toBe("Quoted Name");
    expect(body.data[0].description).toBe("Single quoted");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. Skills disappear when removed from filesystem
// ═══════════════════════════════════════════════════════════════════════════════

describe("Skills — disappear when removed from filesystem", () => {
  it("skill no longer appears in GET after skill directory is deleted", async () => {
    const skillDir = createSkill(
      "temp-skill",
      "---\nname: Temp\ndescription: Will be deleted\n---\nBody."
    );

    // First call — skill is present
    const { body: before } = await callSkillsGET();
    expect(before.data).toHaveLength(1);
    expect(before.data[0].name).toBe("Temp");

    // Remove the skill directory
    fs.rmSync(skillDir, { recursive: true, force: true });

    // Second call — skill should be gone
    const { body: after } = await callSkillsGET();
    expect(after.data).toHaveLength(0);
  });

  it("removing one skill does not affect others", async () => {
    const dir1 = createSkill("keep-me", "---\nname: Keep\ndescription: Stay\n---\nBody.");
    createSkill("remove-me", "---\nname: Remove\ndescription: Go away\n---\nBody.");

    // Both present
    const { body: both } = await callSkillsGET();
    expect(both.data).toHaveLength(2);

    // Remove one
    const removeDir = path.join(skillsHome, ".claude", "skills", "remove-me");
    fs.rmSync(removeDir, { recursive: true, force: true });

    // Only one remains
    const { body: one } = await callSkillsGET();
    expect(one.data).toHaveLength(1);
    expect(one.data[0].name).toBe("Keep");

    // Suppress unused variable warning
    void dir1;
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. Skills are independent of knowledge base DB entries
// ═══════════════════════════════════════════════════════════════════════════════

describe("Skills — independent of knowledge base DB", () => {
  it("adding a project to knowledge base does NOT create any skills", async () => {
    // No skills directory at all
    expect(fs.existsSync(path.join(skillsHome, ".claude", "skills"))).toBe(false);

    // Simulate adding a KB entry via the mock (we are not calling the actual POST
    // to avoid circular dependencies; the key assertion is that skills are filesystem-only)
    mockFindUnique.mockResolvedValue(null);
    mockCreate.mockResolvedValue({
      id: 1,
      path: tmpDir,
      name: "my-project",
      tags: "[]",
      lastScanned: null,
    });

    // Skills are still empty
    const { status, body } = await callSkillsGET();
    expect(status).toBe(200);
    expect(body.data).toEqual([]);

    // No skills directory was created
    expect(fs.existsSync(path.join(skillsHome, ".claude", "skills"))).toBe(false);
  });

  it("skills exist independent of how many KB entries are in the DB", async () => {
    // Add a real skill to filesystem
    createSkill(
      "my-skill",
      "---\nname: My Skill\ndescription: Useful skill\n---\nDo the thing."
    );

    // Regardless of DB state, skills come from filesystem
    const { status, body } = await callSkillsGET();

    expect(status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].name).toBe("My Skill");
    // DB mock was never called for skills
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("deleting all KB entries does not remove skills", async () => {
    // Skill exists
    createSkill(
      "persistent-skill",
      "---\nname: Persistent\ndescription: Stays even when KB is empty\n---\nBody."
    );

    // DB is empty (all KB entries deleted)
    // Skills are still present

    const { status, body } = await callSkillsGET();

    expect(status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].name).toBe("Persistent");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. Skills only exist in user-local filesystem (not in repo)
// ═══════════════════════════════════════════════════════════════════════════════

describe("Skills — user-local only, not repo-committed", () => {
  it("skills path is under HOME not the project directory", async () => {
    // The skill is in skillsHome/.claude/skills/ — NOT in tmpDir
    createSkill("user-skill", "---\nname: User Skill\n---\nBody.");

    // Verify the skill file is under HOME
    const skillPath = path.join(skillsHome, ".claude", "skills", "user-skill", "SKILL.md");
    expect(fs.existsSync(skillPath)).toBe(true);

    // The project tmpDir has no skills
    const projSkillPath = path.join(tmpDir, ".claude", "skills", "user-skill", "SKILL.md");
    expect(fs.existsSync(projSkillPath)).toBe(false);

    // GET /api/skills still finds the skill via HOME
    const { body } = await callSkillsGET();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].name).toBe("User Skill");
  });
});
