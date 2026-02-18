import { NextRequest, NextResponse } from "next/server";
import { readTeamConfig } from "@/lib/claude-files";
import { ok, notFound, serverError } from "@/lib/api-helpers";
import { getTeamSessionStatus } from "@/lib/tmux-manager";

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

    return ok({ teamName: name, sessions });
  } catch (e) {
    return serverError(e);
  }
}
