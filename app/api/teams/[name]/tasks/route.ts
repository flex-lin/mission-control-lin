import { NextRequest, NextResponse } from "next/server";
import { readTaskList, writeTask, readTeamConfig } from "@/lib/claude-files";
import { ok, created, notFound, err, serverError } from "@/lib/api-helpers";
import type { TeamTask } from "@/types";

// GET /api/teams/[name]/tasks — list tasks for a team
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
): Promise<NextResponse> {
  try {
    const { name } = await params;
    const team = readTeamConfig(name);
    if (!team) return notFound(`Team "${name}" not found`);

    const tasks = readTaskList(name);
    const sorted = tasks.sort((a, b) => Number(a.id) - Number(b.id));
    return ok(sorted, { count: sorted.length });
  } catch (e) {
    return serverError(e);
  }
}

// POST /api/teams/[name]/tasks — create a new task
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
): Promise<NextResponse> {
  try {
    const { name } = await params;
    const team = readTeamConfig(name);
    if (!team) return notFound(`Team "${name}" not found`);

    const body = await req.json() as Partial<TeamTask>;

    if (!body.subject || typeof body.subject !== "string") {
      return err("subject is required", "VALIDATION_ERROR");
    }

    // Generate a new ID by finding max existing + 1
    const existing = readTaskList(name);
    const maxId = existing.reduce((max, t) => Math.max(max, Number(t.id) || 0), 0);
    const newId = String(maxId + 1);

    const task: TeamTask = {
      id: newId,
      subject: body.subject,
      description: body.description,
      status: "pending",
      owner: body.owner,
      blockedBy: body.blockedBy ?? [],
      blocks: body.blocks ?? [],
      activeForm: body.activeForm,
      metadata: body.metadata,
    };

    writeTask(name, task);
    return created(task);
  } catch (e) {
    return serverError(e);
  }
}
