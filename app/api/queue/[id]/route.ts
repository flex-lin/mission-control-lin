import { NextRequest, NextResponse } from "next/server";
import { ok, err, notFound, serverError } from "@/lib/api-helpers";
import { db } from "@/lib/db";
import { killSessionAsync, listTeamSessionsAsync } from "@/lib/tmux-manager";
import { rm } from "fs/promises";
import { existsSync } from "fs";
import path from "path";

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads", "tasks");

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

    // Update DB status immediately so UI can reflect cancellation fast
    if (task.status === "pending" || task.status === "running") {
      await db.queuedTask.update({
        where: { id: taskId },
        data: { status: "cancelled", completedAt: new Date() },
      });

      // Kill tmux sessions in background (non-blocking) for running tasks
      if (task.status === "running" && task.teamName) {
        listTeamSessionsAsync(task.teamName).then(async (sessions) => {
          await Promise.allSettled(
            sessions.filter((s) => s.alive).map((s) => killSessionAsync(s.sessionName))
          );
        }).catch(() => { /* best-effort cleanup */ });
      }

      return ok({ cancelled: true });
    }

    // For completed/failed/cancelled tasks, delete the record and clean up files
    const taskDir = path.join(UPLOAD_DIR, String(taskId));
    if (existsSync(taskDir)) {
      await rm(taskDir, { recursive: true, force: true });
    }
    await db.queuedTask.delete({ where: { id: taskId } });
    return ok({ deleted: true });
  } catch (e) {
    return serverError(e);
  }
}

// Update a pending task (goal, priority)
export async function PATCH(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  try {
    const { id } = await ctx.params;
    const taskId = parseInt(id, 10);
    if (isNaN(taskId)) return err("Invalid task ID", "VALIDATION_ERROR");

    const task = await db.queuedTask.findUnique({ where: { id: taskId } });
    if (!task) return notFound("Queued task not found");

    if (task.status !== "pending") {
      return err("Only pending tasks can be edited", "INVALID_STATE");
    }

    const body = await req.json();
    const data: Record<string, unknown> = {};

    if (typeof body.goal === "string" && body.goal.trim()) {
      data.goal = body.goal.trim();
    }
    if (typeof body.priority === "number" && body.priority >= 0 && body.priority <= 3) {
      data.priority = body.priority;
    }

    if (Object.keys(data).length === 0) {
      return err("No valid fields to update", "VALIDATION_ERROR");
    }

    const updated = await db.queuedTask.update({
      where: { id: taskId },
      data,
    });

    return ok(updated);
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

    if (task.status !== "failed" && task.status !== "cancelled" && task.status !== "running") {
      return err("Only failed, cancelled, or stuck running tasks can be retried", "INVALID_STATE");
    }
    // Note: resetting a "running" task while the queue worker is actively monitoring
    // it is a race condition — the monitor could still write status = 'completed'.
    // The UI guards against this by only showing the reset button when the worker is stopped.

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
