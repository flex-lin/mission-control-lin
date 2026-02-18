import { NextRequest, NextResponse } from "next/server";
import { ok, err, notFound, serverError } from "@/lib/api-helpers";
import { db } from "@/lib/db";
import { killSession, listTeamSessions } from "@/lib/tmux-manager";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  try {
    const { id } = await ctx.params;
    const taskId = parseInt(id, 10);
    if (isNaN(taskId)) return err("Invalid task ID", "VALIDATION_ERROR");

    const task = await db.queuedTask.findUnique({ where: { id: taskId } });
    if (!task) return notFound("Queued task not found");

    return ok(task);
  } catch (e) {
    return serverError(e);
  }
}

export async function DELETE(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  try {
    const { id } = await ctx.params;
    const taskId = parseInt(id, 10);
    if (isNaN(taskId)) return err("Invalid task ID", "VALIDATION_ERROR");

    const task = await db.queuedTask.findUnique({ where: { id: taskId } });
    if (!task) return notFound("Queued task not found");

    if (task.status === "running" && task.teamName) {
      // Kill the team's tmux sessions before cancelling
      const sessions = listTeamSessions(task.teamName);
      for (const s of sessions) {
        if (s.alive) {
          try { killSession(s.sessionName); } catch { /* ignore */ }
        }
      }
    }

    if (task.status === "pending" || task.status === "running") {
      await db.queuedTask.update({
        where: { id: taskId },
        data: { status: "cancelled", completedAt: new Date() },
      });
      return ok({ cancelled: true });
    }

    // For completed/failed/cancelled tasks, delete the record
    await db.queuedTask.delete({ where: { id: taskId } });
    return ok({ deleted: true });
  } catch (e) {
    return serverError(e);
  }
}

// Retry a failed task
export async function POST(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  try {
    const { id } = await ctx.params;
    const taskId = parseInt(id, 10);
    if (isNaN(taskId)) return err("Invalid task ID", "VALIDATION_ERROR");

    const task = await db.queuedTask.findUnique({ where: { id: taskId } });
    if (!task) return notFound("Queued task not found");

    if (task.status !== "failed" && task.status !== "cancelled") {
      return err("Only failed or cancelled tasks can be retried", "INVALID_STATE");
    }

    const updated = await db.queuedTask.update({
      where: { id: taskId },
      data: {
        status: "pending",
        teamName: null,
        result: null,
        startedAt: null,
        completedAt: null,
      },
    });

    return ok(updated);
  } catch (e) {
    return serverError(e);
  }
}
