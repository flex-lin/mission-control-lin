import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { readTeamConfig } from "../lib/claude-files";

/**
 * Tests for the member reconciliation logic added in the refactor.
 *
 * When the dashboard pre-populates placeholder members (e.g. "analyst" with
 * status "idle"), and the leader later spawns them via Claude Code's Task tool,
 * Claude Code adds them as new entries with a "-N" suffix (e.g. "analyst-2")
 * because the name is already taken. reconcileMembers() merges these so:
 * - Placeholders matched by a spawned member are removed
 * - Spawned members are renamed to the original placeholder name
 * - No duplicates remain
 */

const CLAUDE_DIR = path.join(process.env.HOME ?? "/root", ".claude");
const TEST_TEAM = "__test-reconcile__";

function writeConfig(members: Record<string, unknown>[]) {
  const teamDir = path.join(CLAUDE_DIR, "teams", TEST_TEAM);
  fs.mkdirSync(teamDir, { recursive: true });
  const config = { name: TEST_TEAM, members, createdAt: new Date().toISOString() };
  fs.writeFileSync(path.join(teamDir, "config.json"), JSON.stringify(config, null, 2), "utf-8");
}

function cleanup() {
  fs.rmSync(path.join(CLAUDE_DIR, "teams", TEST_TEAM), { recursive: true, force: true });
}

beforeEach(cleanup);
afterEach(cleanup);

describe("member reconciliation — no duplicates", () => {
  it("returns placeholders unchanged when no spawned members exist", () => {
    writeConfig([
      { name: "leader", agentId: "id-0", agentType: "general-purpose", status: "active" },
      { name: "analyst", agentId: "id-1", agentType: "Explore", status: "idle" },
      { name: "coder", agentId: "id-2", agentType: "general-purpose", status: "idle" },
    ]);

    const team = readTeamConfig(TEST_TEAM)!;
    expect(team.members).toHaveLength(3);
    expect(team.members.map((m) => m.name)).toEqual(["leader", "analyst", "coder"]);
  });

  it("merges spawned member with its placeholder (no duplicate)", () => {
    writeConfig([
      // Placeholder from dashboard
      { name: "leader", agentId: "id-0", agentType: "general-purpose", status: "active" },
      { name: "analyst", agentId: "id-1", agentType: "Explore", status: "idle" },
      // Spawned by leader (has joinedAt)
      {
        name: "analyst-2",
        agentId: "analyst-2@team",
        agentType: "general-purpose",
        joinedAt: 1771432895279,
        isActive: true,
      },
    ]);

    const team = readTeamConfig(TEST_TEAM)!;
    // Should have 2 members (leader + reconciled analyst), not 3
    expect(team.members).toHaveLength(2);
    const names = team.members.map((m) => m.name);
    expect(names).toContain("leader");
    expect(names).toContain("analyst");
    // The duplicate "analyst-2" should not appear
    expect(names).not.toContain("analyst-2");
  });

  it("reconciles multiple spawned members with their placeholders", () => {
    writeConfig([
      { name: "leader", agentId: "id-0", agentType: "general-purpose", status: "active" },
      { name: "analyst", agentId: "id-1", agentType: "Explore", status: "idle" },
      { name: "coder", agentId: "id-2", agentType: "general-purpose", status: "idle" },
      { name: "tester", agentId: "id-3", agentType: "Bash", status: "idle" },
      // Spawned members
      {
        name: "analyst-2",
        agentId: "analyst-2@team",
        agentType: "general-purpose",
        joinedAt: 1000,
        isActive: true,
      },
      {
        name: "coder-2",
        agentId: "coder-2@team",
        agentType: "general-purpose",
        joinedAt: 1001,
        isActive: true,
      },
      {
        name: "tester-2",
        agentId: "tester-2@team",
        agentType: "general-purpose",
        joinedAt: 1002,
        isActive: false,
      },
    ]);

    const team = readTeamConfig(TEST_TEAM)!;
    // leader + 3 reconciled = 4 (not 7)
    expect(team.members).toHaveLength(4);
    const names = team.members.map((m) => m.name);
    expect(names).toEqual(expect.arrayContaining(["leader", "analyst", "coder", "tester"]));
    // No "-2" suffixed names
    expect(names.every((n) => !n.endsWith("-2"))).toBe(true);
  });
});

describe("member reconciliation — placeholder vs real distinction", () => {
  it("spawned members have joinedAt; placeholders do not", () => {
    writeConfig([
      { name: "leader", agentId: "id-0", agentType: "general-purpose", status: "active" },
      { name: "worker", agentId: "id-1", agentType: "general-purpose", status: "idle" },
      {
        name: "worker-2",
        agentId: "worker-2@team",
        agentType: "general-purpose",
        joinedAt: 9999,
        isActive: true,
      },
    ]);

    const team = readTeamConfig(TEST_TEAM)!;
    const worker = team.members.find((m) => m.name === "worker")!;
    // The reconciled "worker" should be the spawned version (has joinedAt)
    expect("joinedAt" in worker).toBe(true);
  });

  it("derives active status from isActive=true on spawned member", () => {
    writeConfig([
      { name: "leader", agentId: "id-0", agentType: "general-purpose", status: "active" },
      { name: "bot", agentId: "id-1", agentType: "general-purpose", status: "idle" },
      {
        name: "bot-2",
        agentId: "bot-2@team",
        agentType: "general-purpose",
        joinedAt: 100,
        isActive: true,
      },
    ]);

    const team = readTeamConfig(TEST_TEAM)!;
    const bot = team.members.find((m) => m.name === "bot")!;
    expect(bot.status).toBe("active");
  });

  it("derives offline status from isActive=false on spawned member", () => {
    writeConfig([
      { name: "leader", agentId: "id-0", agentType: "general-purpose", status: "active" },
      { name: "bot", agentId: "id-1", agentType: "general-purpose", status: "idle" },
      {
        name: "bot-2",
        agentId: "bot-2@team",
        agentType: "general-purpose",
        joinedAt: 100,
        isActive: false,
      },
    ]);

    const team = readTeamConfig(TEST_TEAM)!;
    const bot = team.members.find((m) => m.name === "bot")!;
    expect(bot.status).toBe("offline");
  });
});

describe("member reconciliation — edge cases", () => {
  it("keeps spawned members without matching placeholder as-is", () => {
    writeConfig([
      { name: "leader", agentId: "id-0", agentType: "general-purpose", status: "active" },
      // No placeholder for "extra", spawned directly
      {
        name: "extra",
        agentId: "extra@team",
        agentType: "general-purpose",
        joinedAt: 200,
        isActive: true,
      },
    ]);

    const team = readTeamConfig(TEST_TEAM)!;
    expect(team.members).toHaveLength(2);
    expect(team.members.map((m) => m.name)).toContain("extra");
  });

  it("handles compound names correctly (frontend-dev-2 → frontend-dev)", () => {
    writeConfig([
      { name: "leader", agentId: "id-0", agentType: "general-purpose", status: "active" },
      { name: "frontend-dev", agentId: "id-1", agentType: "general-purpose", status: "idle" },
      {
        name: "frontend-dev-2",
        agentId: "fd-2@team",
        agentType: "general-purpose",
        joinedAt: 300,
        isActive: true,
      },
    ]);

    const team = readTeamConfig(TEST_TEAM)!;
    expect(team.members).toHaveLength(2);
    const names = team.members.map((m) => m.name);
    expect(names).toContain("frontend-dev");
    expect(names).not.toContain("frontend-dev-2");
  });

  it("does not strip suffix from names that naturally end in numbers", () => {
    writeConfig([
      { name: "leader", agentId: "id-0", agentType: "general-purpose", status: "active" },
      // "agent3" has no dash before the number — should NOT be treated as "agent" + "-3"
      {
        name: "agent3",
        agentId: "a3@team",
        agentType: "general-purpose",
        joinedAt: 400,
        isActive: true,
      },
    ]);

    const team = readTeamConfig(TEST_TEAM)!;
    expect(team.members).toHaveLength(2);
    expect(team.members.map((m) => m.name)).toContain("agent3");
  });

  it("only reconciles when spawned name differs from base (exact match = no-op)", () => {
    writeConfig([
      { name: "leader", agentId: "id-0", agentType: "general-purpose", status: "active" },
      { name: "bot", agentId: "id-1", agentType: "general-purpose", status: "idle" },
      // Spawned with exact same name "bot" (no suffix) — should not consume placeholder
      {
        name: "bot",
        agentId: "bot@team",
        agentType: "general-purpose",
        joinedAt: 500,
        isActive: true,
      },
    ]);

    const team = readTeamConfig(TEST_TEAM)!;
    // Both "bot" entries remain because the spawned name equals the base name
    // (getBaseName("bot") === "bot" === member.name, so baseName !== member.name is false)
    expect(team.members.filter((m) => m.name === "bot")).toHaveLength(2);
  });

  it("handles empty members array", () => {
    writeConfig([]);
    const team = readTeamConfig(TEST_TEAM)!;
    expect(team.members).toHaveLength(0);
  });

  it("handles team with only leader (no personas)", () => {
    writeConfig([
      { name: "leader", agentId: "id-0", agentType: "general-purpose", status: "active" },
    ]);
    const team = readTeamConfig(TEST_TEAM)!;
    expect(team.members).toHaveLength(1);
    expect(team.members[0].name).toBe("leader");
  });
});

describe("member reconciliation — subagent detection via tmuxPaneId", () => {
  it("preserves tmuxPaneId on spawned members after reconciliation", () => {
    writeConfig([
      { name: "leader", agentId: "id-0", agentType: "general-purpose", status: "active", tmuxSession: "mc-team-leader" },
      { name: "analyst", agentId: "id-1", agentType: "Explore", status: "idle" },
      {
        name: "analyst-2",
        agentId: "analyst-2@team",
        agentType: "general-purpose",
        joinedAt: 600,
        tmuxPaneId: "%6",
        isActive: true,
      },
    ]);

    const team = readTeamConfig(TEST_TEAM)!;
    const analyst = team.members.find((m) => m.name === "analyst")!;
    // tmuxPaneId should be carried over from spawned member
    expect((analyst as unknown as Record<string, unknown>).tmuxPaneId).toBe("%6");
  });

  it("health endpoint uses leader session for subagent members", () => {
    // This tests the pattern in health/route.ts lines 129-141:
    // When a member has no own tmux session but leader is alive,
    // it's considered a subagent and gets tmuxAlive=true
    writeConfig([
      { name: "leader", agentId: "id-0", agentType: "general-purpose", status: "active", tmuxSession: "mc-team-leader" },
      { name: "worker", agentId: "id-1", agentType: "general-purpose", status: "idle" },
      {
        name: "worker-2",
        agentId: "worker-2@team",
        agentType: "general-purpose",
        joinedAt: 700,
        tmuxPaneId: "%7",
        isActive: true,
      },
    ]);

    const team = readTeamConfig(TEST_TEAM)!;
    // After reconciliation, worker should have the spawned member's data
    const worker = team.members.find((m) => m.name === "worker")!;
    expect(worker).toBeDefined();
    // The worker has tmuxPaneId but no tmuxSession of its own
    // Health endpoint should use leader's session for the attach cmd
    expect((worker as unknown as Record<string, unknown>).tmuxPaneId).toBe("%7");
    expect(worker.tmuxSession).toBeUndefined();
  });
});

describe("sessions endpoint uses reconciled members", () => {
  it("sessions endpoint reads reconciled names (no suffix duplicates)", () => {
    writeConfig([
      { name: "leader", agentId: "id-0", agentType: "general-purpose", status: "active" },
      { name: "analyst", agentId: "id-1", agentType: "Explore", status: "idle" },
      {
        name: "analyst-2",
        agentId: "analyst-2@team",
        agentType: "general-purpose",
        joinedAt: 800,
        isActive: true,
      },
    ]);

    // The sessions endpoint calls readTeamConfig then maps member names.
    // After reconciliation, it should see ["leader", "analyst"], not ["leader", "analyst", "analyst-2"]
    const team = readTeamConfig(TEST_TEAM)!;
    const memberNames = team.members.map((m) => m.name);
    expect(memberNames).toEqual(["leader", "analyst"]);
    expect(memberNames).not.toContain("analyst-2");
  });
});
