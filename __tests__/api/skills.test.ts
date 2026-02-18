import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

// ── Tests for listSkills (lib/claude-files.ts) and GET /api/skills ──

let tmpDir: string;

describe("skills", () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-skills-test-"));
    vi.stubEnv("HOME", tmpDir);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // Re-import after HOME is stubbed
  async function getClaudeFiles() {
    vi.resetModules();
    return await import("@/lib/claude-files");
  }

  async function callSkillsGET() {
    vi.resetModules();
    const mod = await import("@/app/api/skills/route");
    const res = await mod.GET();
    return { status: res.status, body: await res.json() };
  }

  // ── Helper: create a skill folder with SKILL.md ──

  function createSkill(
    folderName: string,
    content: string,
    fileName = "SKILL.md"
  ) {
    const skillDir = path.join(tmpDir, ".claude", "skills", folderName);
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, fileName), content);
  }

  // ── listSkills() unit tests ──

  describe("listSkills", () => {
    it("returns empty array when skills directory does not exist", async () => {
      const mod = await getClaudeFiles();
      expect(mod.listSkills()).toEqual([]);
    });

    it("returns empty array when skills directory is empty", async () => {
      const dir = path.join(tmpDir, ".claude", "skills");
      fs.mkdirSync(dir, { recursive: true });

      const mod = await getClaudeFiles();
      expect(mod.listSkills()).toEqual([]);
    });

    it("reads skills with YAML front matter", async () => {
      createSkill(
        "my-skill",
        `---
name: My Skill
description: Does something cool
---
This is the body content.`
      );

      const mod = await getClaudeFiles();
      const skills = mod.listSkills();
      expect(skills).toHaveLength(1);
      expect(skills[0]).toEqual({
        folderName: "my-skill",
        name: "My Skill",
        description: "Does something cool",
        content: "This is the body content.",
      });
    });

    it("uses folder name as skill name when front matter lacks name", async () => {
      createSkill(
        "unnamed-skill",
        `---
description: Just a description
---
Body here.`
      );

      const mod = await getClaudeFiles();
      const skills = mod.listSkills();
      expect(skills).toHaveLength(1);
      expect(skills[0].name).toBe("unnamed-skill");
      expect(skills[0].description).toBe("Just a description");
    });

    it("handles SKILL.md with no front matter", async () => {
      createSkill("no-fm", "Just plain markdown body.");

      const mod = await getClaudeFiles();
      const skills = mod.listSkills();
      expect(skills).toHaveLength(1);
      expect(skills[0].name).toBe("no-fm");
      expect(skills[0].description).toBe("");
      expect(skills[0].content).toBe("Just plain markdown body.");
    });

    it("handles malformed front matter (no closing ---)", async () => {
      createSkill(
        "broken-fm",
        `---
name: Broken
description: Missing closer
This has no closing delimiter.`
      );

      const mod = await getClaudeFiles();
      const skills = mod.listSkills();
      expect(skills).toHaveLength(1);
      // parseFrontMatter returns raw content when no closing ---
      expect(skills[0].name).toBe("broken-fm");
      expect(skills[0].description).toBe("");
    });

    it("skips directories without SKILL.md", async () => {
      const dir = path.join(tmpDir, ".claude", "skills", "empty-dir");
      fs.mkdirSync(dir, { recursive: true });
      // Write a random file, not SKILL.md
      fs.writeFileSync(path.join(dir, "README.md"), "not a skill");

      const mod = await getClaudeFiles();
      expect(mod.listSkills()).toEqual([]);
    });

    it("skips non-directory entries in skills folder", async () => {
      const skillsDir = path.join(tmpDir, ".claude", "skills");
      fs.mkdirSync(skillsDir, { recursive: true });
      // Create a file (not a directory) in the skills folder
      fs.writeFileSync(path.join(skillsDir, "stray-file.txt"), "not a dir");

      const mod = await getClaudeFiles();
      expect(mod.listSkills()).toEqual([]);
    });

    it("finds SKILL.md case-insensitively", async () => {
      createSkill(
        "case-test",
        `---
name: Case Test
description: Testing case sensitivity
---
Content here.`,
        "skill.md" // lowercase
      );

      const mod = await getClaudeFiles();
      const skills = mod.listSkills();
      expect(skills).toHaveLength(1);
      expect(skills[0].name).toBe("Case Test");
    });

    it("reads multiple skills", async () => {
      createSkill(
        "alpha",
        `---
name: Alpha Skill
description: First skill
---
Alpha body.`
      );
      createSkill(
        "beta",
        `---
name: Beta Skill
description: Second skill
---
Beta body.`
      );

      const mod = await getClaudeFiles();
      const skills = mod.listSkills();
      expect(skills).toHaveLength(2);

      const names = skills.map((s) => s.name).sort();
      expect(names).toEqual(["Alpha Skill", "Beta Skill"]);
    });

    it("strips quotes from front matter values", async () => {
      createSkill(
        "quoted",
        `---
name: "Quoted Name"
description: 'Single quoted'
---
Body.`
      );

      const mod = await getClaudeFiles();
      const skills = mod.listSkills();
      expect(skills).toHaveLength(1);
      expect(skills[0].name).toBe("Quoted Name");
      expect(skills[0].description).toBe("Single quoted");
    });
  });

  // ── GET /api/skills endpoint tests ──

  describe("GET /api/skills", () => {
    it("returns 200 with skills array when skills exist", async () => {
      createSkill(
        "api-skill",
        `---
name: API Skill
description: Tested via API
---
API skill body.`
      );

      const { status, body } = await callSkillsGET();
      expect(status).toBe(200);
      expect(body.data).toHaveLength(1);
      expect(body.data[0]).toMatchObject({
        folderName: "api-skill",
        name: "API Skill",
        description: "Tested via API",
      });
      expect(body.meta.count).toBe(1);
    });

    it("returns 200 with empty array when no skills exist", async () => {
      const { status, body } = await callSkillsGET();
      expect(status).toBe(200);
      expect(body.data).toEqual([]);
      expect(body.meta.count).toBe(0);
    });

    it("returns multiple skills with correct count", async () => {
      createSkill("s1", "---\nname: S1\n---\nBody1.");
      createSkill("s2", "---\nname: S2\n---\nBody2.");
      createSkill("s3", "---\nname: S3\n---\nBody3.");

      const { status, body } = await callSkillsGET();
      expect(status).toBe(200);
      expect(body.data).toHaveLength(3);
      expect(body.meta.count).toBe(3);
    });
  });
});
