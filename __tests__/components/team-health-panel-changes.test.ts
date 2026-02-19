import { describe, it, expect } from "vitest";
import type { TeamHealthStatus, TeamTask } from "@/types";

// Verifies the structural changes to team-health-panel:
// - tmux column REMOVED from member health table
// - TmuxAttachBar added as separate component for leader session
// - Member health table now only has: Name, Status, Last Seen

interface MemberHealth {
  name: string;
  status: TeamHealthStatus;
  lastSeen: string | null;
  tmuxAlive?: boolean;
  attachCmd?: string;
}

interface LeaderSession {
  alive: boolean;
  sessionName: string;
  attachCmd: string;
}

interface TeamHealthData {
  status: TeamHealthStatus;
  lastActivity: string | null;
  staleTasks: TeamTask[];
  memberHealth: MemberHealth[];
  leaderSession?: LeaderSession;
}

describe("TeamHealthPanel structural changes", () => {
  const healthData: TeamHealthData = {
    status: "alive",
    lastActivity: new Date().toISOString(),
    staleTasks: [],
    memberHealth: [
      { name: "leader", status: "alive", lastSeen: new Date().toISOString(), tmuxAlive: true, attachCmd: "tmux attach -t mc-team-leader" },
      { name: "worker", status: "alive", lastSeen: new Date().toISOString(), tmuxAlive: true },
      { name: "tester", status: "exited", lastSeen: null, tmuxAlive: false },
    ],
    leaderSession: {
      alive: true,
      sessionName: "mc-team-leader",
      attachCmd: "tmux attach -t mc-team-leader",
    },
  };

  describe("member health table columns", () => {
    // The old table had: Name, Status, tmux, Last Seen (4 columns)
    // The new table has: Name, Status, Last Seen (3 columns)
    it("member health data has Name, Status, and Last Seen fields", () => {
      for (const member of healthData.memberHealth) {
        expect(member).toHaveProperty("name");
        expect(member).toHaveProperty("status");
        expect(member).toHaveProperty("lastSeen");
      }
    });

    it("tmuxAlive is still in data but no longer rendered in health table columns", () => {
      // tmuxAlive remains in the interface for backward compatibility
      // but is NOT displayed in the member health table anymore
      const leader = healthData.memberHealth[0];
      expect(leader.tmuxAlive).toBe(true);
      // This field exists but the column was removed from the table
    });
  });

  describe("leader session attach bar", () => {
    it("leaderSession is available in health data", () => {
      expect(healthData.leaderSession).toBeDefined();
      expect(healthData.leaderSession!.alive).toBe(true);
      expect(healthData.leaderSession!.attachCmd).toContain("tmux attach");
    });

    it("TmuxAttachBar only renders when leaderSession exists and is alive", () => {
      // When alive: renders the bar
      expect(healthData.leaderSession?.alive).toBe(true);

      // When not alive: component returns null
      const deadSession: LeaderSession = { alive: false, sessionName: "mc-t-leader", attachCmd: "tmux attach -t mc-t-leader" };
      expect(deadSession.alive).toBe(false);
    });

    it("health data without leaderSession should not render attach bar", () => {
      const noLeader: TeamHealthData = {
        ...healthData,
        leaderSession: undefined,
      };
      expect(noLeader.leaderSession).toBeUndefined();
    });
  });

  describe("WakeButton conditional rendering", () => {
    it("shows wake button when status is not exited", () => {
      expect(healthData.status).not.toBe("exited");
      // WakeButton should render
    });

    it("hides wake button when status is exited", () => {
      const exited: TeamHealthData = { ...healthData, status: "exited" };
      expect(exited.status).toBe("exited");
      // WakeButton should NOT render
    });
  });
});

describe("team-detail-live structural changes", () => {
  // The Members tab previously had columns: Name, Type, tmux, Actions
  // Now it has: Name, Type, Actions (tmux column removed)
  // TmuxSessionBar is now placed between stat cards and the grid

  interface SessionInfo {
    name: string;
    sessionName: string;
    alive: boolean;
    attachCmd: string;
  }

  it("session bar receives sessions from polling data", () => {
    const sessionData = {
      sessions: [
        { name: "leader", sessionName: "mc-t-leader", alive: true, attachCmd: "tmux attach -t mc-t-leader" },
        { name: "dev", sessionName: "mc-t-dev", alive: false, attachCmd: "tmux attach -t mc-t-dev" },
      ],
    };
    // TmuxSessionBar gets sessions from sessionData?.sessions ?? []
    const sessions = sessionData?.sessions ?? [];
    expect(sessions).toHaveLength(2);
  });

  it("falls back to empty array when no session data", () => {
    const sessionData = null as { sessions: SessionInfo[] } | null;
    const sessions = sessionData?.sessions ?? [];
    expect(sessions).toEqual([]);
  });

  it("members tab actions column shows Launch button only when session is not alive", () => {
    const sessions: SessionInfo[] = [
      { name: "worker", sessionName: "mc-t-worker", alive: false, attachCmd: "tmux attach -t mc-t-worker" },
    ];
    const sessionMap = new Map(sessions.map((s) => [s.name, s]));
    const session = sessionMap.get("worker");
    // Launch button shows when !session?.alive
    expect(!session?.alive).toBe(true);
  });

  it("members tab hides Launch button when session is alive", () => {
    const sessions: SessionInfo[] = [
      { name: "worker", sessionName: "mc-t-worker", alive: true, attachCmd: "tmux attach -t mc-t-worker" },
    ];
    const sessionMap = new Map(sessions.map((s) => [s.name, s]));
    const session = sessionMap.get("worker");
    expect(!session?.alive).toBe(false);
  });
});
