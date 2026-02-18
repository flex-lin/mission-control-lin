import { NextRequest, NextResponse } from "next/server";
import { ok, err, created, serverError } from "@/lib/api-helpers";
import { db } from "@/lib/db";

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(req.url);
    const statusFilter = searchParams.get("status");

    const where = statusFilter
      ? { status: { in: statusFilter.split(",") } }
      : {};

    const tasks = await db.queuedTask.findMany({
      where,
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    });

    return ok(tasks);
  } catch (e) {
    return serverError(e);
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = (await req.json()) as {
      goal?: string;
      projectPath?: string;
      priority?: number;
    };

    if (!body.goal || typeof body.goal !== "string" || !body.goal.trim()) {
      return err("goal is required", "VALIDATION_ERROR");
    }
    if (!body.projectPath || typeof body.projectPath !== "string" || !body.projectPath.trim()) {
      return err("projectPath is required", "VALIDATION_ERROR");
    }

    const task = await db.queuedTask.create({
      data: {
        goal: body.goal.trim(),
        projectPath: body.projectPath.trim(),
        priority: body.priority ?? 0,
      },
    });

    return created(task);
  } catch (e) {
    return serverError(e);
  }
}
