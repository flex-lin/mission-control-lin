import { NextRequest, NextResponse } from "next/server";
import { ok, err, created, serverError } from "@/lib/api-helpers";
import { db } from "@/lib/db";

const ACTIVE_STATUSES = ["pending", "running"];
const COMPLETED_STATUSES = ["completed", "failed", "cancelled"];

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(req.url);
    const statusFilter = searchParams.get("status");
    const group = searchParams.get("group");

    let where: Record<string, unknown> = {};

    if (group === "active") {
      where = { status: { in: ACTIVE_STATUSES } };
    } else if (group === "completed") {
      where = { status: { in: COMPLETED_STATUSES } };
    } else if (statusFilter) {
      where = { status: { in: statusFilter.split(",") } };
    }

    const orderBy =
      group === "completed"
        ? [{ completedAt: "desc" as const }, { createdAt: "desc" as const }]
        : [{ priority: "desc" as const }, { createdAt: "asc" as const }];

    const [tasks, counts] = await Promise.all([
      db.queuedTask.findMany({ where, orderBy }),
      db.queuedTask.groupBy({
        by: ["status"],
        _count: { status: true },
      }),
    ]);

    const countMap = Object.fromEntries(
      counts.map((c) => [c.status, c._count.status])
    );

    const meta = {
      activeCounts: {
        pending: countMap["pending"] ?? 0,
        running: countMap["running"] ?? 0,
      },
      completedCounts: {
        completed: countMap["completed"] ?? 0,
        failed: countMap["failed"] ?? 0,
        cancelled: countMap["cancelled"] ?? 0,
      },
    };

    return ok(tasks, meta);
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
      teamMembers?: unknown;
    };

    if (!body.goal || typeof body.goal !== "string" || !body.goal.trim()) {
      return err("goal is required", "VALIDATION_ERROR");
    }
    const projectPath = (body.projectPath && typeof body.projectPath === "string" && body.projectPath.trim())
      ? body.projectPath.trim()
      : process.cwd();

    // teamMembers: optional array of TeamRole objects (with at least id or name), stored as JSON string
    let teamMembersJson = "[]";
    if (Array.isArray(body.teamMembers) && body.teamMembers.length > 0) {
      // Validate that each member has at minimum a name field
      const invalid = body.teamMembers.find(
        (m) => typeof m !== "object" || m === null || !("name" in m) || typeof (m as Record<string, unknown>).name !== "string"
      );
      if (invalid) {
        return err("Each teamMember must be an object with a 'name' field", "VALIDATION_ERROR");
      }
      teamMembersJson = JSON.stringify(body.teamMembers);
    }

    const task = await db.queuedTask.create({
      data: {
        goal: body.goal.trim(),
        projectPath,
        priority: body.priority ?? 0,
        teamMembers: teamMembersJson,
      },
    });

    return created(task);
  } catch (e) {
    return serverError(e);
  }
}
