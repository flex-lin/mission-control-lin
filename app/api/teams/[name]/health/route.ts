import { NextRequest, NextResponse } from "next/server";
import { readTeamConfig, readTaskList, getTeamLastActivity } from "@/lib/claude-files";
import { ok, notFound, serverError } from "@/lib/api-helpers";
import { db } from "@/lib/db";
import { sessionExists, getSessionName, sessionProcessAlive } from "@/lib/tmux-manager";
import { getLeaderSessionName } from "@/lib/agent-launcher";
import type { TeamHealthStatus, TeamTask } from "@/types";
import fs from "fs";
import path from "path";

const CLAUDE_DIR = path.join(process.env.HOME ?? "/root", ".claude");
const STALENESS_MS = 5 * 60 * 1000;

interface LeaderSession {
  alive: boolean;
  sessionName: string;
  attachCmd: string;
}

interface MemberHealth {
  name: string;
  lastSeen: string | null;
  status: TeamHealthStatus;
  tmuxAlive: boolean;
  attachCmd: string;
}

// GET /api/teams/[name]/health — computed health for a team
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
): Promise<NextResponse> {
  try {
    const { name } = await params;

    // Check if team is archived
    const archivePath = path.join(CLAUDE_DIR, "teams-archive", name, "config.json");
    if (fs.existsSync(archivePath)) {
      return ok({
        status: "exited" as TeamHealthStatus,
        lastActivity: null,
        staleTasks: [],
        memberHealth: [],
      });
    }

    const team = readTeamConfig(name);
    if (!team) return notFound(`Team "${name}" not found`);

    const now = Date.now();

    // Get filesystem-based last activity
    const fsActivity = getTeamLastActivity(name);

    // Get proxy_logs last entry per member
    const proxyLogs = await db.proxyLog.groupBy({
      by: ["memberName"],
      where: { teamName: name },
      _max: { timestamp: true },
    });

    // Determine overall last proxy activity
    let lastProxyActivity: string | null = null;
    for (const log of proxyLogs) {
      const ts = log._max.timestamp?.toISOString() ?? null;
      if (ts && (!lastProxyActivity || ts > lastProxyActivity)) {
        lastProxyActivity = ts;
      }
    }

    // Use the more recent of filesystem vs proxy activity
    let lastActivity: string | null = null;
    if (fsActivity && lastProxyActivity) {
      lastActivity = fsActivity > lastProxyActivity ? fsActivity : lastProxyActivity;
    } else {
      lastActivity = fsActivity ?? lastProxyActivity;
    }

    // Check leader session (primary indicator)
    const leaderSessionName = getLeaderSessionName(name);
    const leaderTmuxAlive = sessionExists(leaderSessionName) && sessionProcessAlive(leaderSessionName);

    // Also check individual member sessions (for legacy teams)
    const anyMemberTmuxAlive = (team.members ?? []).some((member) => {
      if (member.name === "leader") return false;
      const sn = getSessionName(name, member.name);
      return sessionExists(sn) && sessionProcessAlive(sn);
    });

    const anyTmuxAlive = leaderTmuxAlive || anyMemberTmuxAlive;

    // Determine status
    let status: TeamHealthStatus = "asleep";
    if (anyTmuxAlive) {
      status = "alive";
    } else if (lastActivity) {
      const elapsed = now - new Date(lastActivity).getTime();
      status = elapsed < STALENESS_MS ? "alive" : "asleep";
    }

    // Find stale in-progress tasks
    const tasks = readTaskList(name);
    const staleTasks: TeamTask[] = [];
    const tasksBasePath = path.join(CLAUDE_DIR, "tasks", name);
    for (const task of tasks) {
      if (task.status !== "in_progress") continue;
      try {
        const taskFile = path.join(tasksBasePath, `${task.id}.json`);
        const stat = fs.statSync(taskFile);
        if (now - stat.mtimeMs > STALENESS_MS) {
          staleTasks.push(task);
        }
      } catch {
        // If we can't stat the file, skip it
      }
    }

    // Build member health with tmux info
    const proxyMap = new Map<string, string>();
    for (const log of proxyLogs) {
      if (log.memberName && log._max.timestamp) {
        proxyMap.set(log.memberName, log._max.timestamp.toISOString());
      }
    }

    const memberHealth: MemberHealth[] = (team.members ?? []).map((member) => {
      const memberLastActivity = proxyMap.get(member.name) ?? null;

      // For the leader, check the leader session; for others check individual sessions
      let tmuxAlive = false;
      let attachCmd = "";
      if (member.name === "leader") {
        tmuxAlive = leaderTmuxAlive;
        attachCmd = `tmux attach -t ${leaderSessionName}`;
      } else {
        const tmuxSessionName = getSessionName(name, member.name);
        const tmuxExists = sessionExists(tmuxSessionName);
        tmuxAlive = tmuxExists && sessionProcessAlive(tmuxSessionName);
        // For new-style teams, teammates run inside the leader's process
        // Show leader session as the attach target
        if (!tmuxAlive && leaderTmuxAlive) {
          tmuxAlive = true; // they're subagents of the leader
          attachCmd = `tmux attach -t ${leaderSessionName}`;
        } else {
          attachCmd = `tmux attach -t ${tmuxSessionName}`;
        }
      }

      let memberStatus: TeamHealthStatus = "asleep";
      if (tmuxAlive) {
        memberStatus = "alive";
      } else if (memberLastActivity) {
        const elapsed = now - new Date(memberLastActivity).getTime();
        memberStatus = elapsed < STALENESS_MS ? "alive" : "asleep";
      }

      return {
        name: member.name,
        lastSeen: memberLastActivity,
        status: memberStatus,
        tmuxAlive,
        attachCmd,
      };
    });

    // Build leader session info for standalone tmux bar
    const leaderSessionInfo: LeaderSession = {
      alive: leaderTmuxAlive,
      sessionName: leaderSessionName,
      attachCmd: `tmux attach -t ${leaderSessionName}`,
    };

    return ok({
      status,
      lastActivity,
      staleTasks,
      memberHealth,
      leaderSession: leaderSessionInfo,
    });
  } catch (e) {
    return serverError(e);
  }
}
