import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { personaToLaunchable, getLeaderSessionName } from "../lib/agent-launcher";

// We can't easily test launchTeamAsLeader (tmux dependency) but we can test
// the pure functions and verify file output from writeLeaderLauncher indirectly.

describe("personaToLaunchable", () => {
  it("converts a TeamPersona to a LaunchableMember", () => {
    const persona = {
      name: "researcher",
      role: "Code Analyst",
      agentType: "Explore",
      description: "Analyze codebase for patterns",
    };
    const result = personaToLaunchable(persona);
    expect(result).toEqual({
      name: "researcher",
      role: "Code Analyst",
      agentType: "Explore",
      description: "Analyze codebase for patterns",
    });
  });

  it("preserves all fields from persona", () => {
    const persona = {
      name: "tester",
      role: "QA Engineer",
      agentType: "Bash",
      description: "Run tests and validate",
    };
    const result = personaToLaunchable(persona);
    expect(result.name).toBe("tester");
    expect(result.role).toBe("QA Engineer");
    expect(result.agentType).toBe("Bash");
    expect(result.description).toBe("Run tests and validate");
  });
});

describe("getLeaderSessionName", () => {
  it("returns a session name containing the team name", () => {
    const name = getLeaderSessionName("my-team");
    expect(name).toContain("my-team");
  });

  it("returns a session name containing 'leader'", () => {
    const name = getLeaderSessionName("test-team");
    expect(name).toContain("leader");
  });

  it("returns consistent results for same input", () => {
    const a = getLeaderSessionName("foo");
    const b = getLeaderSessionName("foo");
    expect(a).toBe(b);
  });
});
