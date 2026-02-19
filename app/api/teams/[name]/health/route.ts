import { NextRequest } from "next/server";
import { readTeamConfig, readTaskList, getTeamLastActivity } from "@/lib/claude-files";
import { ok, err, notFound, serverError, safeName } from "@/lib/api-helpers";
import { db } from "@/lib/db";
import { sessionExists, getSessionName, sessionProcessAlive, anyTeamPaneAlive, killAllTeamSessions } from "@/lib/tmux-manager";
import { getLeaderSessionName, resumeTeamAsLeader, personaToLaunchable } from "@/lib/agent-launcher";
import {
  detectSleep,
  shouldAutoWake,
  recordSleepEvent,
  recordAutoWake,
  readBackgroundConfig,
} from "@/lib/sleep-detector";
import type { TeamHealthStatus, TeamTask, TeamPersona } from "@/types";
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
) {
  try {
    const { name } = await params;
    if (!safeName(name)) return err("Invalid team name", "VALIDATION_ERROR");

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

    // Fallback: check pane IDs from config (for external/cross-repo teams)
    let paneBasedAlive = false;
    if (!leaderTmuxAlive && !anyMemberTmuxAlive && team.members?.length) {
      paneBasedAlive = anyTeamPaneAlive(team.members);
    }

    const anyTmuxAlive = leaderTmuxAlive || anyMemberTmuxAlive || paneBasedAlive;

    // Determine status
    let status: TeamHealthStatus = "asleep";
    if (anyTmuxAlive) {
      status = "alive";
    } else if (lastActivity) {
      const elapsed = now - new Date(lastActivity).getTime();
      status = elapsed < STALENESS_MS ? "alive" : "asleep";
    }

    // Check if all tasks are completed/deleted → override to "completed"
    // Also treat zero tasks + dead leader as "completed" (team had nothing to do)
    const tasks = readTaskList(name);
    if (tasks.length > 0 && tasks.every((t) => t.status === "completed" || t.status === "deleted")) {
      status = "completed";
    } else if (tasks.length === 0 && !anyTmuxAlive) {
      status = "completed";
    }

    // Clean up lingering tmux sessions for completed teams
    if (status === "completed") {
      killAllTeamSessions(name);
    }

    // Find stale in-progress tasks
    const staleTasks: TeamTask[] = [];
    const tasksBasePath = path.join(CLAUDE_DIR, "tasks", name);
    for (const task of tasks) {
      if (task.status !== "in_progress") continue;
      // Validate task.id before using in file path
      if (!/^[\w-]+$/.test(String(task.id))) continue;
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

    // ── Sleep detection & auto-wake ────────────────────────────────────────
    const bgConfig = readBackgroundConfig(name);
    let sleepDetected = false;
    let autoWakeTriggered = false;

    // Only run sleep detection for non-completed teams
    if (status !== "completed") {
      sleepDetected = detectSleep(name);

      if (sleepDetected && !anyTmuxAlive) {
        // System likely slept and the tmux session died
        recordSleepEvent(name);

        const { shouldWake } = shouldAutoWake(name);
        if (shouldWake) {
          // Attempt auto-wake: rebuild personas and relaunch leader
          const hasPendingTasks = tasks.some(
            (t) => t.status === "pending" || t.status === "in_progress"
          );
          if (hasPendingTasks) {
            try {
              const configPath = path.join(CLAUDE_DIR, "teams", name, "config.json");
              let projectPath: string | undefined;
              let description = "";
              try {
                const raw = fs.readFileSync(configPath, "utf-8");
                const config = JSON.parse(raw) as { projectPath?: string; description?: string };
                projectPath = config.projectPath;
                description = config.description ?? "";
              } catch { /* ignore */ }

              const personas: TeamPersona[] = (team.members ?? [])
                .filter((m) => m.name !== "leader")
                .map((m) => ({
                  name: m.name,
                  role: m.agentType,
                  agentType: m.agentType,
                  description: `Team member on ${name}`,
                }));

              const launchable = personas.map(personaToLaunchable);
              await resumeTeamAsLeader(name, description, launchable, projectPath, tasks);
              recordAutoWake(name);
              autoWakeTriggered = true;
              status = "alive";
            } catch {
              // Auto-wake failed — will retry on next poll
            }
          }
        }
      }
    }

    // Build leader session info for standalone tmux bar
    const leaderSessionInfo: LeaderSession = {
      alive: leaderTmuxAlive || autoWakeTriggered,
      sessionName: leaderSessionName,
      attachCmd: `tmux attach -t ${leaderSessionName}`,
    };

    return ok({
      status,
      lastActivity,
      staleTasks,
      memberHealth,
      leaderSession: leaderSessionInfo,
      background: {
        persistent: bgConfig.persistent,
        sleepDetected,
        autoWakeTriggered,
        wakeRetryCount: bgConfig.wakeRetryCount,
        maxWakeRetries: bgConfig.maxWakeRetries,
        lastSleepDetected: bgConfig.lastSleepDetected,
        lastAutoWake: bgConfig.lastAutoWake,
      },
    });
  } catch (e) {
    return serverError(e);
  }
}
