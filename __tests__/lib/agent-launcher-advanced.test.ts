import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";

/**
 * Advanced tests for agent-launcher.ts — tests the pure functions and
 * file output of writeLeaderLauncher, buildSetupMessage, buildResumeMessage.
 * We test these indirectly through launchTeamAsLeader / resumeTeamAsLeader
 * by mocking tmux operations.
 */

// Track calls to tmux functions
const mockCreateSession = vi.fn();
const mockSendKeysAndSubmit = vi.fn();
const mockCapturePane = vi.fn(() => "❯");
const mockSendRawKey = vi.fn();
const mockSessionExists = vi.fn(() => false);
const mockSessionProcessAlive = vi.fn(() => false);
const mockKillSession = vi.fn();

vi.mock("@/lib/tmux-manager", () => ({
  getSessionName: (team: string, member: string) => `mc-${team}-${member}`,
  sessionExists: (...args: unknown[]) => mockSessionExists(...args),
  createSession: (...args: unknown[]) => mockCreateSession(...args),
  sessionProcessAlive: (...args: unknown[]) => mockSessionProcessAlive(...args),
  killSession: (...args: unknown[]) => mockKillSession(...args),
  sendKeysAndSubmit: (...args: unknown[]) => mockSendKeysAndSubmit(...args),
  capturePane: (...args: unknown[]) => mockCapturePane(...args),
  sendRawKey: (...args: unknown[]) => mockSendRawKey(...args),
  getTeamSessionStatus: vi.fn(() => []),
}));

let tmpDir: string;

describe("agent-launcher advanced", () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-launcher-test-"));
    vi.stubEnv("HOME", tmpDir);
    mockSendKeysAndSubmit.mockClear();
    mockSendRawKey.mockClear();
    mockCapturePane.mockReturnValue("❯");
    mockSessionExists.mockReturnValue(false);
    mockSessionProcessAlive.mockReturnValue(false);
    mockKillSession.mockClear();
    // After createSession is called, sessionExists should return true
    // so waitForClaudeReady polling finds the session and sees the "❯" prompt
    mockCreateSession.mockReset();
    mockCreateSession.mockImplementation(() => {
      mockSessionExists.mockReturnValue(true);
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── launchTeamAsLeader ────────────────────────────────────────────────

  describe("launchTeamAsLeader", () => {
    it("creates a tmux session via launcher script", async () => {
      const { launchTeamAsLeader } = await import("@/lib/agent-launcher");
      const result = await launchTeamAsLeader(
        "test-team",
        "Test description",
        [{ name: "dev", role: "Dev", agentType: "general-purpose", description: "Code" }],
        "/home/user/project",
        []
      );

      expect(result.launched).toBe(true);
      expect(result.sessionName).toBe("mc-test-team-leader");
      expect(mockCreateSession).toHaveBeenCalledTimes(1);
    });

    // Note: writeLeaderLauncher file output is tested in team-spawner.test.ts
    // since the CLAUDE_DIR constant is computed at module-load time and
    // cannot be re-stubbed without resetModules (which breaks mock wiring).

    it("sends setup message with member spawn instructions", async () => {
      const { launchTeamAsLeader } = await import("@/lib/agent-launcher");
      await launchTeamAsLeader(
        "msg-team", "Message test",
        [
          { name: "dev", role: "Developer", agentType: "general-purpose", description: "Code stuff" },
          { name: "tester", role: "QA", agentType: "Bash", description: "Test stuff" },
        ],
        "/tmp/project",
        [
          { id: "1", subject: "Build feature", status: "pending", owner: "dev" },
          { id: "2", subject: "Write tests", status: "pending", owner: "tester" },
        ]
      );

      expect(mockSendKeysAndSubmit).toHaveBeenCalledTimes(1);
      const sentMsg = mockSendKeysAndSubmit.mock.calls[0][1];

      expect(sentMsg).toContain("ONE-TIME SETUP");
      expect(sentMsg).toContain("msg-team");
      expect(sentMsg).toContain('name="dev"');
      expect(sentMsg).toContain('name="tester"');
      expect(sentMsg).toContain("Build feature");
      expect(sentMsg).toContain("Write tests");
      expect(sentMsg).toContain("STEP 1: Call TeamCreate");
      expect(sentMsg).toContain("STEP 2: Spawn ALL teammates");
    });

    it("does not launch if session already alive", async () => {
      mockSessionExists.mockReturnValue(true);
      mockSessionProcessAlive.mockReturnValue(true);

      const { launchTeamAsLeader } = await import("@/lib/agent-launcher");
      const result = await launchTeamAsLeader("alive-team", "Already alive", [], "/tmp");

      expect(result.launched).toBe(false);
      expect(mockCreateSession).not.toHaveBeenCalled();
    });

    it("kills dead session and relaunches", async () => {
      mockSessionExists.mockReturnValue(true);
      mockSessionProcessAlive.mockReturnValue(false);

      const { launchTeamAsLeader } = await import("@/lib/agent-launcher");
      const result = await launchTeamAsLeader("dead-team", "Was dead", [], "/tmp");

      expect(result.launched).toBe(true);
      expect(mockKillSession).toHaveBeenCalledWith("mc-dead-team-leader");
      expect(mockCreateSession).toHaveBeenCalledTimes(1);
    });
  });

  // ── resumeTeamAsLeader ───────────────────────────────────────────────

  describe("resumeTeamAsLeader", () => {
    it("sends RESUME message instead of setup", async () => {
      const { resumeTeamAsLeader } = await import("@/lib/agent-launcher");
      await resumeTeamAsLeader(
        "resume-team", "Resume test",
        [{ name: "dev", role: "Dev", agentType: "general-purpose", description: "Code" }],
        "/tmp/project",
        [{ id: "1", subject: "Half done", status: "in_progress", owner: "dev" }]
      );

      expect(mockSendKeysAndSubmit).toHaveBeenCalledTimes(1);
      const sentMsg = mockSendKeysAndSubmit.mock.calls[0][1];

      expect(sentMsg).toContain("RESUME");
      expect(sentMsg).toContain("resume-team");
      expect(sentMsg).toContain("DO NOT call TeamCreate");
      expect(sentMsg).toContain("Half done");
      expect(sentMsg).toContain("in_progress");
    });

    it("does not relaunch if session is still alive", async () => {
      mockSessionExists.mockReturnValue(true);
      mockSessionProcessAlive.mockReturnValue(true);

      const { resumeTeamAsLeader } = await import("@/lib/agent-launcher");
      const result = await resumeTeamAsLeader("still-alive", "Test", [], "/tmp");

      expect(result.launched).toBe(false);
      expect(mockCreateSession).not.toHaveBeenCalled();
    });
  });

  // ── personaToLaunchable ──────────────────────────────────────────────

  describe("personaToLaunchable", () => {
    it("maps all persona fields", async () => {
      const { personaToLaunchable } = await import("@/lib/agent-launcher");
      const result = personaToLaunchable({
        name: "test",
        role: "Role",
        agentType: "general-purpose",
        description: "Desc",
      });
      expect(result).toEqual({
        name: "test",
        role: "Role",
        agentType: "general-purpose",
        description: "Desc",
      });
    });
  });

  // ── getLeaderSessionName ─────────────────────────────────────────────

  describe("getLeaderSessionName", () => {
    it("returns mc-{team}-leader", async () => {
      const { getLeaderSessionName } = await import("@/lib/agent-launcher");
      expect(getLeaderSessionName("my-team")).toBe("mc-my-team-leader");
    });
  });

  // ── getTeamStatus ────────────────────────────────────────────────────

  describe("getTeamStatus", () => {
    it("delegates to tmux-manager getTeamSessionStatus", async () => {
      const { getTeamStatus } = await import("@/lib/agent-launcher");
      const result = getTeamStatus("team", ["leader", "dev"]);
      expect(Array.isArray(result)).toBe(true);
    });
  });
});
