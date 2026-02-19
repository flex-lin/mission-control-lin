import { NextRequest } from "next/server";
import { ok, err, notFound, serverError } from "@/lib/api-helpers";
import { db } from "@/lib/db";
import type { TaskAttachment } from "@/types";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: RouteContext) {
  try {
    const { id } = await ctx.params;
    const taskId = parseInt(id, 10);
    if (isNaN(taskId)) return err("Invalid task ID", "VALIDATION_ERROR");

    const task = await db.queuedTask.findUnique({ where: { id: taskId } });
    if (!task) return notFound("Task not found");

    const attachments: TaskAttachment[] = JSON.parse(task.attachments || "[]");
    return ok(attachments);
  } catch (e) {
    return serverError(e);
  }
}
