import { describe, it, expect, vi, beforeEach } from "vitest";
import { execSync } from "child_process";

/**
 * Tests for tmux-manager.ts — tests the pure logic and shell quoting.
 * We mock execSync to avoid requiring a real tmux server.
 */

vi.mock("child_process", () => ({
  execSync: vi.fn(),
  exec: vi.fn((cmd: string, opts: unknown, cb?: (err: Error | null, result: { stdout: string; stderr: string }) => void) => {
    // Support both (cmd, cb) and (cmd, opts, cb) signatures
    const callback = typeof opts === "function" ? opts : cb;
    if (callback) callback(null, { stdout: "", stderr: "" });
  }),
}));

const mockExecSync = vi.mocked(execSync);

describe("tmux-manager", () => {
  beforeEach(() => {
    mockExecSync.mockReset();
    vi.resetModules();
  });

  async function getModule() {
    return await import("@/lib/tmux-manager");
  }

  // ── getSessionName ──────────────────────────────────────────────────

  describe("getSessionName", () => {
    it("creates mc- prefixed name", async () => {
      const mod = await getModule();
      expect(mod.getSessionName("team", "member")).toBe("mc-team-member");
    });
  });

  // ── sessionExists ──────────────────────────────────────────────────

  describe("sessionExists", () => {
    it("returns true when tmux has-session succeeds", async () => {
      mockExecSync.mockReturnValue(Buffer.from(""));
      const mod = await getModule();
      expect(mod.sessionExists("mc-team-leader")).toBe(true);
    });

    it("returns false when tmux has-session throws", async () => {
      mockExecSync.mockImplementation(() => {
        throw new Error("no session");
      });
      const mod = await getModule();
      expect(mod.sessionExists("mc-nonexistent")).toBe(false);
    });
  });

  // ── createSession ──────────────────────────────────────────────────

  describe("createSession", () => {
    it("calls tmux new-session with correct args", async () => {
      mockExecSync.mockReturnValue(Buffer.from(""));
      const mod = await getModule();
      mod.createSession("mc-team-leader", "claude", "/home/user");

      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining("tmux new-session -d"),
        expect.anything()
      );
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining("mc-team-leader"),
        expect.anything()
      );
    });

    it("includes cwd flag when provided", async () => {
      mockExecSync.mockReturnValue(Buffer.from(""));
      const mod = await getModule();
      mod.createSession("sess", "cmd", "/my/dir");

      const call = mockExecSync.mock.calls[0][0] as string;
      expect(call).toContain("-c");
      expect(call).toContain("/my/dir");
    });
  });

  // ── killSession ────────────────────────────────────────────────────

  describe("killSession", () => {
    it("calls tmux kill-session", async () => {
      mockExecSync.mockReturnValue(Buffer.from(""));
      const mod = await getModule();
      mod.killSession("mc-team-leader");

      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining("tmux kill-session"),
        expect.anything()
      );
    });

    it("does not throw when session already dead", async () => {
      mockExecSync.mockImplementation(() => {
        throw new Error("session not found");
      });
      const mod = await getModule();
      expect(() => mod.killSession("nonexistent")).not.toThrow();
    });
  });

  // ── listTeamSessions ──────────────────────────────────────────────

  describe("listTeamSessions", () => {
    it("returns sessions matching team prefix", async () => {
      mockExecSync.mockReturnValue(
        "mc-myteam-leader\nmc-myteam-dev\nmc-other-leader\n"
      );
      const mod = await getModule();
      const sessions = mod.listTeamSessions("myteam");

      expect(sessions).toHaveLength(2);
      expect(sessions[0].sessionName).toBe("mc-myteam-leader");
      expect(sessions[1].sessionName).toBe("mc-myteam-dev");
      expect(sessions[0].alive).toBe(true);
    });

    it("returns empty array when no tmux sessions", async () => {
      mockExecSync.mockImplementation(() => {
        throw new Error("no server running");
      });
      const mod = await getModule();
      expect(mod.listTeamSessions("team")).toEqual([]);
    });
  });

  // ── sessionProcessAlive ───────────────────────────────────────────

  describe("sessionProcessAlive", () => {
    it("returns true when process is not a shell", async () => {
      mockExecSync.mockReturnValue("node\n");
      const mod = await getModule();
      expect(mod.sessionProcessAlive("sess")).toBe(true);
    });

    it("returns false when process is bash", async () => {
      mockExecSync.mockReturnValue("bash\n");
      const mod = await getModule();
      expect(mod.sessionProcessAlive("sess")).toBe(false);
    });

    it("returns false when process is zsh", async () => {
      mockExecSync.mockReturnValue("zsh\n");
      const mod = await getModule();
      expect(mod.sessionProcessAlive("sess")).toBe(false);
    });

    it("returns false when process is fish", async () => {
      mockExecSync.mockReturnValue("fish\n");
      const mod = await getModule();
      expect(mod.sessionProcessAlive("sess")).toBe(false);
    });

    it("returns false on error (session gone)", async () => {
      mockExecSync.mockImplementation(() => {
        throw new Error("session not found");
      });
      const mod = await getModule();
      expect(mod.sessionProcessAlive("gone")).toBe(false);
    });
  });

  // ── capturePane ───────────────────────────────────────────────────

  describe("capturePane", () => {
    it("returns pane content", async () => {
      mockExecSync.mockReturnValue("Hello world\n❯ \n");
      const mod = await getModule();
      expect(mod.capturePane("sess")).toContain("Hello world");
    });

    it("returns empty string on error", async () => {
      mockExecSync.mockImplementation(() => {
        throw new Error("no pane");
      });
      const mod = await getModule();
      expect(mod.capturePane("gone")).toBe("");
    });
  });

  // ── sendRawKey ────────────────────────────────────────────────────

  describe("sendRawKey", () => {
    it("sends key to tmux session", async () => {
      mockExecSync.mockReturnValue(Buffer.from(""));
      const mod = await getModule();
      mod.sendRawKey("sess", "Enter");

      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining("send-keys"),
        expect.anything()
      );
    });

    it("does not throw on error", async () => {
      mockExecSync.mockImplementation(() => {
        throw new Error("session gone");
      });
      const mod = await getModule();
      expect(() => mod.sendRawKey("gone", "Enter")).not.toThrow();
    });
  });

  // ── getTeamSessionStatus ──────────────────────────────────────────

  describe("getTeamSessionStatus", () => {
    it("returns status for each member", async () => {
      // First call: listTeamSessions -> tmux list-sessions
      // Second call: sessionProcessAlive for leader
      // Third call: sessionProcessAlive for dev
      let callCount = 0;
      mockExecSync.mockImplementation((cmd: unknown) => {
        const cmdStr = String(cmd);
        if (cmdStr.includes("list-sessions")) {
          return "mc-team-leader\n";
        }
        if (cmdStr.includes("list-panes")) {
          callCount++;
          return callCount === 1 ? "node\n" : "bash\n";
        }
        return "";
      });

      const mod = await getModule();
      const status = mod.getTeamSessionStatus("team", ["leader", "dev"]);

      expect(status).toHaveLength(2);
      expect(status[0].name).toBe("leader");
      expect(status[0].alive).toBe(true);
      // dev has no own session but leader is alive, so dev is a subagent
      expect(status[1].name).toBe("dev");
      expect(status[1].alive).toBe(true);
    });

    it("marks all members as dead when no sessions exist", async () => {
      mockExecSync.mockImplementation(() => {
        throw new Error("no server");
      });

      const mod = await getModule();
      const status = mod.getTeamSessionStatus("dead", ["leader", "dev"]);

      expect(status).toHaveLength(2);
      expect(status.every((s) => !s.alive)).toBe(true);
    });
  });

  // ── shell quoting ─────────────────────────────────────────────────

  describe("shell quoting safety", () => {
    it("rejects session names with special characters", async () => {
      const mod = await getModule();

      // Session names with special characters are now rejected for security
      expect(() => mod.killSession("mc-team-it's-leader")).toThrow(/Invalid session name/);
      expect(() => mod.killSession("team; rm -rf /")).toThrow(/Invalid session name/);
      expect(() => mod.killSession("team`whoami`")).toThrow(/Invalid session name/);
    });

    it("accepts valid session names", async () => {
      mockExecSync.mockReturnValue(Buffer.from(""));
      const mod = await getModule();

      expect(() => mod.killSession("mc-team-leader")).not.toThrow();
      expect(() => mod.killSession("mc-my_team-worker_1")).not.toThrow();
    });
  });
});
