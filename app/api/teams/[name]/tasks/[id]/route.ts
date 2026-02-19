import { NextRequest } from "next/server";
import { readTask, writeTask, readTeamConfig } from "@/lib/claude-files";
import { ok, notFound, err, serverError, safeName } from "@/lib/api-helpers";
import type { TeamTask, TaskPriority } from "@/types";

// PATCH /api/teams/[name]/tasks/[id] — update task status, owner, etc.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ name: string; id: string }> }
) {
  try {
    const { name, id } = await params;
    if (!safeName(name)) return err("Invalid team name", "VALIDATION_ERROR");
    if (!safeName(id)) return err("Invalid task ID", "VALIDATION_ERROR");
    const team = readTeamConfig(name);
    if (!team) return notFound(`Team "${name}" not found`);

    const task = readTask(name, id);
    if (!task) return notFound(`Task "${id}" not found`);

    const body = await req.json() as Partial<TeamTask>;

    // Validate subject if provided
    if (body.subject !== undefined && (typeof body.subject !== "string" || body.subject.trim() === "")) {
      return err("subject must be a non-empty string", "VALIDATION_ERROR");
    }

    // Validate status if provided
    const validStatuses = ["pending", "in_progress", "completed", "deleted"] as const;
    if (body.status && !validStatuses.includes(body.status)) {
      return err(`Invalid status: ${body.status}`, "VALIDATION_ERROR");
    }

    // Validate priority if provided
    const validPriorities: TaskPriority[] = ["low", "medium", "high", "urgent"];
    if (body.priority !== undefined && body.priority !== null && !validPriorities.includes(body.priority)) {
      return err(`Invalid priority: ${body.priority}. Must be one of: ${validPriorities.join(", ")}`, "VALIDATION_ERROR");
    }

    // Validate order if provided
    if (body.order !== undefined && (typeof body.order !== "number" || body.order < 0)) {
      return err("order must be a non-negative number", "VALIDATION_ERROR");
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
      ...(body.priority !== undefined && { priority: body.priority }),
      ...(body.order !== undefined && { order: body.order }),
      ...(body.metadata !== undefined && { metadata: body.metadata }),
    };

    writeTask(name, updated);
    return ok(updated);
  } catch (e) {
    return serverError(e);
  }
}
