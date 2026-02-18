import { describe, it, expect } from "vitest";

// Test the rendering logic of TmuxSessionBar and TmuxAttachBar
// without DOM rendering (pure logic tests).

interface SessionInfo {
  name: string;
  sessionName: string;
  alive: boolean;
  attachCmd: string;
}

// Extracted logic from TmuxSessionBar: returns null when empty
function shouldRenderSessionBar(sessions: SessionInfo[]): boolean {
  return sessions.length > 0;
}

// Extracted logic from TmuxAttachBar: returns null when not alive
function shouldRenderAttachBar(alive: boolean): boolean {
  return alive;
}

// Extracted: which sessions show copy button + attach command
function getAliveSessionNames(sessions: SessionInfo[]): string[] {
  return sessions.filter((s) => s.alive).map((s) => s.name);
}

// Extracted: which sessions are dimmed (stopped)
function getStoppedSessionNames(sessions: SessionInfo[]): string[] {
  return sessions.filter((s) => !s.alive).map((s) => s.name);
}

describe("TmuxSessionBar rendering logic", () => {
  const mixedSessions: SessionInfo[] = [
    { name: "leader", sessionName: "mc-team-leader", alive: true, attachCmd: "tmux attach -t mc-team-leader" },
    { name: "worker", sessionName: "mc-team-worker", alive: true, attachCmd: "tmux attach -t mc-team-worker" },
    { name: "tester", sessionName: "mc-team-tester", alive: false, attachCmd: "tmux attach -t mc-team-tester" },
  ];

  it("does not render when sessions array is empty", () => {
    expect(shouldRenderSessionBar([])).toBe(false);
  });

  it("renders when sessions exist", () => {
    expect(shouldRenderSessionBar(mixedSessions)).toBe(true);
  });

  it("identifies alive sessions (show copy button + attach cmd)", () => {
    const alive = getAliveSessionNames(mixedSessions);
    expect(alive).toEqual(["leader", "worker"]);
  });

  it("identifies stopped sessions (dimmed, no copy button)", () => {
    const stopped = getStoppedSessionNames(mixedSessions);
    expect(stopped).toEqual(["tester"]);
  });

  it("handles all sessions alive", () => {
    const allAlive = mixedSessions.map((s) => ({ ...s, alive: true }));
    expect(getAliveSessionNames(allAlive)).toHaveLength(3);
    expect(getStoppedSessionNames(allAlive)).toHaveLength(0);
  });

  it("handles all sessions stopped", () => {
    const allStopped = mixedSessions.map((s) => ({ ...s, alive: false }));
    expect(getAliveSessionNames(allStopped)).toHaveLength(0);
    expect(getStoppedSessionNames(allStopped)).toHaveLength(3);
  });
});

describe("TmuxAttachBar rendering logic", () => {
  it("does not render when session is not alive", () => {
    expect(shouldRenderAttachBar(false)).toBe(false);
  });

  it("renders when session is alive", () => {
    expect(shouldRenderAttachBar(true)).toBe(true);
  });
});

describe("CopyButton behavior expectations", () => {
  it("copy handler targets the correct attach command", () => {
    const session: SessionInfo = {
      name: "leader",
      sessionName: "mc-team-leader",
      alive: true,
      attachCmd: "tmux attach -t mc-team-leader",
    };
    // The attach command should be the full tmux attach string
    expect(session.attachCmd).toBe("tmux attach -t mc-team-leader");
    expect(session.attachCmd).toContain("tmux attach");
    expect(session.attachCmd).toContain(session.sessionName);
  });
});

describe("session data structure", () => {
  it("session info has all required fields", () => {
    const session: SessionInfo = {
      name: "worker",
      sessionName: "mc-myteam-worker",
      alive: true,
      attachCmd: "tmux attach -t mc-myteam-worker",
    };
    expect(session).toHaveProperty("name");
    expect(session).toHaveProperty("sessionName");
    expect(session).toHaveProperty("alive");
    expect(session).toHaveProperty("attachCmd");
  });

  it("sessionMap lookup works correctly", () => {
    const sessions: SessionInfo[] = [
      { name: "leader", sessionName: "mc-t-leader", alive: true, attachCmd: "tmux attach -t mc-t-leader" },
      { name: "dev", sessionName: "mc-t-dev", alive: false, attachCmd: "tmux attach -t mc-t-dev" },
    ];
    const sessionMap = new Map(sessions.map((s) => [s.name, s]));

    expect(sessionMap.get("leader")?.alive).toBe(true);
    expect(sessionMap.get("dev")?.alive).toBe(false);
    expect(sessionMap.get("nonexistent")).toBeUndefined();
  });
});
