import { NextRequest } from "next/server";
import { readTeamConfig, readTaskList } from "@/lib/claude-files";
import { ok, notFound, serverError } from "@/lib/api-helpers";
import { resumeTeamAsLeader, personaToLaunchable, getLeaderSessionName } from "@/lib/agent-launcher";
import { sessionExists, sendKeys, sessionProcessAlive, killSession } from "@/lib/tmux-manager";
import type { WakeRequest, WakeResponse, TeamPersona } from "@/types";
import fs from "fs";
import path from "path";

const CLAUDE_DIR = path.join(process.env.HOME ?? "/root", ".claude");

function safeName(name: string): string {
  if (!/^[\w-]+$/.test(name)) {
    throw new Error(`Invalid name: ${name}`);
  }
  return name;
}

// POST /api/teams/[name]/wake — wake team via the leader session
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const { name } = await params;
    const safe = safeName(name);

    const team = readTeamConfig(safe);
    if (!team) return notFound(`Team "${name}" not found`);

    const body = (await req.json().catch(() => ({}))) as WakeRequest;
    const message =
      body.message ?? "Check your task list — there are pending tasks. Use TaskList to see them and coordinate your team.";

    // Read team config for projectPath and description
    const configPath = path.join(CLAUDE_DIR, "teams", safe, "config.json");
    let projectPath: string | undefined;
    let description = "";
    try {
      const raw = fs.readFileSync(configPath, "utf-8");
      const config = JSON.parse(raw) as { projectPath?: string; description?: string };
      projectPath = config.projectPath;
      description = config.description ?? "";
    } catch {
      // ignore
    }

    const tasks = readTaskList(safe);
    const leaderSession = getLeaderSessionName(safe);

    let action: "messaged" | "restarted";

    if (sessionExists(leaderSession) && sessionProcessAlive(leaderSession)) {
      // Leader is running — send a wake message
      sendKeys(leaderSession, message);
      action = "messaged";
    } else {
      // Leader is dead or Claude exited — kill and relaunch
      if (sessionExists(leaderSession)) {
        killSession(leaderSession);
      }

      // Rebuild personas from team members (exclude the leader itself)
      const personas: TeamPersona[] = (team.members ?? [])
        .filter((m) => m.name !== "leader")
        .map((m) => ({
          name: m.name,
          role: m.agentType,
          agentType: m.agentType,
          description: `Team member on ${safe}`,
        }));

      const launchable = personas.map(personaToLaunchable);
      await resumeTeamAsLeader(safe, description, launchable, projectPath, tasks);
      action = "restarted";
    }

    const response: WakeResponse = {
      teamName: safe,
      woken: true,
      message: action === "restarted"
        ? `Restarted leader session for team "${safe}".`
        : `Sent wake message to leader of team "${safe}".`,
    };

    return ok(response);
  } catch (e) {
    return serverError(e);
  }
}
