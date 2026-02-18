import { execSync } from "child_process";

/**
 * tmux session management for agent teams.
 * Session naming convention: mc-{teamName}-{memberName}
 */

export function getSessionName(teamName: string, memberName: string): string {
  return `mc-${teamName}-${memberName}`;
}

export function sessionExists(sessionName: string): boolean {
  try {
    execSync(`tmux has-session -t ${quote(sessionName)} 2>/dev/null`);
    return true;
  } catch {
    return false;
  }
}

export function createSession(
  sessionName: string,
  command: string,
  cwd?: string
): void {
  const cwdFlag = cwd ? `-c ${quote(cwd)}` : "";
  execSync(
    `tmux new-session -d -s ${quote(sessionName)} ${cwdFlag} ${quote(command)}`,
    { stdio: "ignore" }
  );
}

export function killSession(sessionName: string): void {
  try {
    execSync(`tmux kill-session -t ${quote(sessionName)}`, { stdio: "ignore" });
  } catch {
    // Session may already be dead
  }
}

export function sendKeys(sessionName: string, text: string): void {
  // Send the text followed by Enter to paste it into the input
  execSync(
    `tmux send-keys -t ${quote(sessionName)} ${quote(text)} Enter`,
    { stdio: "ignore" }
  );
}

/**
 * Send text to a tmux session and submit it to Claude CLI.
 * Sends the text, waits briefly for the paste to complete, then sends Enter to submit.
 */
export function sendKeysAndSubmit(sessionName: string, text: string): void {
  // Send the text with Enter (pastes into input)
  execSync(
    `tmux send-keys -t ${quote(sessionName)} ${quote(text)} Enter`,
    { stdio: "ignore" }
  );
  // Wait for paste to fully register in the TUI
  execSync("sleep 1");
  // Second Enter to submit the multi-line input
  execSync(
    `tmux send-keys -t ${quote(sessionName)} Enter`,
    { stdio: "ignore" }
  );
}

export function listTeamSessions(
  teamName: string
): { sessionName: string; alive: boolean }[] {
  const prefix = `mc-${teamName}-`;
  try {
    const output = execSync("tmux list-sessions -F '#{session_name}' 2>/dev/null", {
      encoding: "utf-8",
    });
    return output
      .trim()
      .split("\n")
      .filter((line) => line.startsWith(prefix))
      .map((sessionName) => ({ sessionName, alive: true }));
  } catch {
    return [];
  }
}

export function getTeamSessionStatus(
  teamName: string,
  memberNames: string[]
): { name: string; sessionName: string; alive: boolean; attachCmd: string }[] {
  const liveSessions = new Set(
    listTeamSessions(teamName).map((s) => s.sessionName)
  );

  // Check if the leader session is alive (for subagent detection)
  const leaderSessionName = getSessionName(teamName, "leader");
  const leaderAlive = liveSessions.has(leaderSessionName) && sessionProcessAlive(leaderSessionName);

  return memberNames.map((name) => {
    const sessionName = getSessionName(teamName, name);
    const hasOwnSession = liveSessions.has(sessionName);
    // Non-leader members without their own session are subagents of the leader
    const isSubagent = !hasOwnSession && name !== "leader" && leaderAlive;
    const alive = hasOwnSession || isSubagent;
    const attachTarget = isSubagent ? leaderSessionName : sessionName;
    return {
      name,
      sessionName: attachTarget,
      alive,
      attachCmd: `tmux attach -t ${attachTarget}`,
    };
  });
}

/**
 * Check if the process running inside a tmux session is still active
 * (i.e. claude CLI is running, not just an idle shell prompt).
 * Returns true if a non-shell process is running in the pane.
 */
export function sessionProcessAlive(sessionName: string): boolean {
  try {
    const cmd = execSync(
      `tmux list-panes -t ${quote(sessionName)} -F '#{pane_current_command}' 2>/dev/null`,
      { encoding: "utf-8" }
    ).trim();
    // If the current command is a shell (bash, zsh, sh, fish), Claude has exited
    const shells = ["bash", "zsh", "sh", "fish", "dash"];
    return !shells.includes(cmd);
  } catch {
    return false;
  }
}

/**
 * Capture the current visible pane content.
 */
export function capturePane(sessionName: string): string {
  try {
    return execSync(
      `tmux capture-pane -t ${quote(sessionName)} -p 2>/dev/null`,
      { encoding: "utf-8" }
    );
  } catch {
    return "";
  }
}

/**
 * Send a raw key (e.g. "Down", "Up", "Enter") to a tmux session.
 */
export function sendRawKey(sessionName: string, key: string): void {
  try {
    execSync(`tmux send-keys -t ${quote(sessionName)} ${key}`, { stdio: "ignore" });
  } catch {
    // ignore
  }
}

/** Shell-quote a string for safe use in exec commands */
function quote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}
