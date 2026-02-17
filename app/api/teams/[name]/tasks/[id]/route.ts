import { NextRequest, NextResponse } from "next/server";
import { readTaskList, writeTask, readTeamConfig } from "@/lib/claude-files";
import { ok, notFound, err, serverError } from "@/lib/api-helpers";
import type { TeamTask } from "@/types";

// PATCH /api/teams/[name]/tasks/[id] — update task status, owner, etc.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ name: string; id: string }> }
): Promise<NextResponse> {
  try {
    const { name, id } = await params;
    const team = readTeamConfig(name);
    if (!team) return notFound(`Team "${name}" not found`);

    const tasks = readTaskList(name);
    const task = tasks.find((t) => t.id === id);
    if (!task) return notFound(`Task "${id}" not found`);

    const body = await req.json() as Partial<TeamTask>;

    // Validate status if provided
    const validStatuses = ["pending", "in_progress", "completed", "deleted"] as const;
    if (body.status && !validStatuses.includes(body.status)) {
      return err(`Invalid status: ${body.status}`, "VALIDATION_ERROR");
    }

    const updated: TeamTask = {
      ...task,
      ...(body.status !== undefined && { status: body.status }),
      ...(body.owner !== undefined && { owner: body.owner }),
      ...(body.subject !== undefined && { subject: body.subject }),
      ...(body.description !== undefined && { description: body.description }),
      ...(body.activeForm !== undefined && { activeForm: body.activeForm }),
      ...(body.blockedBy !== undefined && { blockedBy: body.blockedBy }),
      ...(body.blocks !== undefined && { blocks: body.blocks }),
      ...(body.metadata !== undefined && { metadata: body.metadata }),
    };

    writeTask(name, updated);
    return ok(updated);
  } catch (e) {
    return serverError(e);
  }
}
