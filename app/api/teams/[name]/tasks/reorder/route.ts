import { NextRequest } from "next/server";
import { readTaskList, writeTask, readTeamConfig } from "@/lib/claude-files";
import { ok, notFound, err, serverError, safeName } from "@/lib/api-helpers";

// PATCH /api/teams/[name]/tasks/reorder — reorder tasks by providing ordered IDs
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const { name } = await params;
    if (!safeName(name)) return err("Invalid team name", "VALIDATION_ERROR");
    const team = readTeamConfig(name);
    if (!team) return notFound(`Team "${name}" not found`);

    const body = (await req.json()) as { taskIds?: string[] };

    if (!Array.isArray(body.taskIds) || body.taskIds.length === 0) {
      return err("taskIds array is required and must not be empty", "VALIDATION_ERROR");
    }

    // Validate all IDs are strings
    for (const id of body.taskIds) {
      if (typeof id !== "string") {
        return err("Each taskId must be a string", "VALIDATION_ERROR");
      }
    }

    const existingTasks = readTaskList(name);
    const taskMap = new Map(existingTasks.map((t) => [t.id, t]));

    // Verify all referenced tasks exist
    for (const id of body.taskIds) {
      if (!taskMap.has(id)) {
        return notFound(`Task "${id}" not found in team "${name}"`);
      }
    }

    // Assign order = index * 10 for spacing (allows future insertions)
    const updated = [];
    for (let i = 0; i < body.taskIds.length; i++) {
      const task = taskMap.get(body.taskIds[i])!;
      task.order = i * 10;
      writeTask(name, task);
      updated.push(task);
    }

    return ok(updated, { count: updated.length });
  } catch (e) {
    return serverError(e);
  }
}
