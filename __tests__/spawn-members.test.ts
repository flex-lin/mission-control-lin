import { describe, it, expect } from "vitest";
import type { TeamPlan, Teammate } from "../types";

/**
 * Tests for the spawn route member pre-population logic.
 *
 * The actual POST handler depends on tmux/filesystem side effects, so we
 * extract and test the pure member-building logic that was refactored to
 * pre-populate ALL personas (not just the leader) in config.json.
 */

function buildMembers(teamName: string, personas: TeamPlan["personas"]): Teammate[] {
  return [
    {
      name: "leader",
      agentId: `${teamName}-leader-0`,
      agentType: "general-purpose",
      status: "active" as const,
      tmuxSession: `mc-${teamName}-leader`,
    },
    ...personas.map((p, i) => ({
      name: p.name,
      agentId: `${teamName}-${p.name}-${i}`,
      agentType: p.agentType ?? "general-purpose",
      status: "idle" as const,
    })),
  ];
}

describe("spawn route member pre-population", () => {
  it("includes the leader as the first member", () => {
    const members = buildMembers("test-team", []);
    expect(members).toHaveLength(1);
    expect(members[0].name).toBe("leader");
    expect(members[0].status).toBe("active");
    expect(members[0].agentType).toBe("general-purpose");
  });

  it("includes all personas as members after leader", () => {
    const personas = [
      { name: "analyst", role: "Analyst", agentType: "Explore", description: "Analyze" },
      { name: "coder", role: "Developer", agentType: "general-purpose", description: "Code" },
      { name: "tester", role: "QA", agentType: "Bash", description: "Test" },
    ];
    const members = buildMembers("my-team", personas);

    expect(members).toHaveLength(4); // leader + 3 personas
    expect(members[0].name).toBe("leader");
    expect(members[1].name).toBe("analyst");
    expect(members[2].name).toBe("coder");
    expect(members[3].name).toBe("tester");
  });

  it("sets personas to 'idle' status, not 'active'", () => {
    const personas = [
      { name: "worker", role: "Dev", agentType: "general-purpose", description: "Work" },
    ];
    const members = buildMembers("t", personas);

    expect(members[0].status).toBe("active"); // leader
    expect(members[1].status).toBe("idle");   // persona
  });

  it("preserves persona agentType", () => {
    const personas = [
      { name: "explorer", role: "Scout", agentType: "Explore", description: "Search" },
      { name: "runner", role: "CI", agentType: "Bash", description: "Run" },
    ];
    const members = buildMembers("t", personas);

    expect(members[1].agentType).toBe("Explore");
    expect(members[2].agentType).toBe("Bash");
  });

  it("defaults agentType to general-purpose when not specified", () => {
    const personas = [
      { name: "helper", role: "Helper", agentType: undefined as unknown as string, description: "Help" },
    ];
    const members = buildMembers("t", personas);

    expect(members[1].agentType).toBe("general-purpose");
  });

  it("generates unique agentIds with team name and index", () => {
    const personas = [
      { name: "a", role: "A", agentType: "general-purpose", description: "A" },
      { name: "b", role: "B", agentType: "general-purpose", description: "B" },
    ];
    const members = buildMembers("my-team", personas);

    expect(members[0].agentId).toBe("my-team-leader-0");
    expect(members[1].agentId).toBe("my-team-a-0");
    expect(members[2].agentId).toBe("my-team-b-1");

    // All IDs are unique
    const ids = members.map((m) => m.agentId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("only leader has tmuxSession set", () => {
    const personas = [
      { name: "worker", role: "Dev", agentType: "general-purpose", description: "Work" },
    ];
    const members = buildMembers("t", personas);

    expect(members[0].tmuxSession).toBeDefined();
    expect(members[1].tmuxSession).toBeUndefined();
  });

  it("handles empty personas list (leader-only team)", () => {
    const members = buildMembers("solo", []);
    expect(members).toHaveLength(1);
    expect(members[0].name).toBe("leader");
  });

  it("handles large teams", () => {
    const personas = Array.from({ length: 10 }, (_, i) => ({
      name: `agent-${i}`,
      role: `Role ${i}`,
      agentType: "general-purpose",
      description: `Agent ${i}`,
    }));
    const members = buildMembers("big-team", personas);

    expect(members).toHaveLength(11); // leader + 10
    expect(members[0].name).toBe("leader");
    for (let i = 0; i < 10; i++) {
      expect(members[i + 1].name).toBe(`agent-${i}`);
    }
  });
});
