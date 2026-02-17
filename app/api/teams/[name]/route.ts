import { NextRequest, NextResponse } from "next/server";
import { readTeamConfig, readTaskList } from "@/lib/claude-files";
import { ok, notFound, serverError } from "@/lib/api-helpers";

// GET /api/teams/[name] — team detail with members and tasks
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
): Promise<NextResponse> {
  try {
    const { name } = await params;
    const team = readTeamConfig(name);
    if (!team) return notFound(`Team "${name}" not found`);

    const tasks = readTaskList(name);
    return ok({ ...team, tasks });
  } catch (e) {
    return serverError(e);
  }
}
