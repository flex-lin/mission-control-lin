import { NextRequest, NextResponse } from "next/server";
import { readTeamConfig } from "@/lib/claude-files";
import { ok, notFound, serverError } from "@/lib/api-helpers";
import { getTeamSessionStatus, sessionExists, sessionProcessAlive } from "@/lib/tmux-manager";
import { getLeaderSessionName } from "@/lib/agent-launcher";

// GET /api/teams/[name]/sessions — tmux session status per member
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
): Promise<NextResponse> {
  try {
    const { name } = await params;

    const team = readTeamConfig(name);
    if (!team) return notFound(`Team "${name}" not found`);

    const memberNames = team.members.map((m) => m.name);
    const sessions = getTeamSessionStatus(name, memberNames);

    // Top-level leader session info for the tmux attach bar
    const leaderSessionName = getLeaderSessionName(name);
    const leaderAlive = sessionExists(leaderSessionName) && sessionProcessAlive(leaderSessionName);
    const leaderSession = {
      alive: leaderAlive,
      sessionName: leaderSessionName,
      attachCmd: `tmux attach -t ${leaderSessionName}`,
    };

    return ok({ teamName: name, sessions, leaderSession });
  } catch (e) {
    return serverError(e);
  }
}
