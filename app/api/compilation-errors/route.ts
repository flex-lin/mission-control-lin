/**
 * GET  /api/compilation-errors  — list compilation errors (with optional filters)
 * POST /api/compilation-errors  — report a new compilation error
 */
import { NextRequest, NextResponse } from "next/server";
import { ok, created, err, serverError } from "@/lib/api-helpers";
import { db } from "@/lib/db";
import { reportError, getSelfHealingStats } from "@/lib/self-healer";
import type { ReportCompilationErrorRequest, CompilationErrorType } from "@/types";

const VALID_ERROR_TYPES: CompilationErrorType[] = ["typescript", "build", "lint", "runtime"];
const VALID_STATUSES = ["pending", "healing", "healed", "failed", "skipped"];

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(req.url);

    const statusFilter = searchParams.get("status");
    const projectPath  = searchParams.get("projectPath");
    const statsOnly    = searchParams.get("stats") === "true";
    const limitParam   = searchParams.get("limit");
    const limit        = limitParam ? Math.min(parseInt(limitParam, 10) || 50, 200) : 50;

    if (statsOnly) {
      const stats = await getSelfHealingStats(projectPath ?? undefined);
      return ok(stats);
    }

    const where: Record<string, unknown> = {};
    if (statusFilter) {
      const statuses = statusFilter.split(",").filter((s) => VALID_STATUSES.includes(s));
      if (statuses.length) where.status = { in: statuses };
    }
    if (projectPath) {
      where.projectPath = projectPath;
    }

    const errors = await db.compilationError.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        healingAttempts: {
          orderBy: { attemptNumber: "asc" },
        },
      },
    });

    const stats = await getSelfHealingStats(projectPath ?? undefined);

    return ok(errors, { stats });
  } catch (e) {
    return serverError(e);
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = (await req.json()) as Partial<ReportCompilationErrorRequest>;

    if (!body.projectPath || typeof body.projectPath !== "string" || !body.projectPath.trim()) {
      return err("projectPath is required", "VALIDATION_ERROR");
    }
    if (!body.errorMessage || typeof body.errorMessage !== "string" || !body.errorMessage.trim()) {
      return err("errorMessage is required", "VALIDATION_ERROR");
    }
    if (body.errorType && !VALID_ERROR_TYPES.includes(body.errorType)) {
      return err(
        `errorType must be one of: ${VALID_ERROR_TYPES.join(", ")}`,
        "VALIDATION_ERROR"
      );
    }

    const id = await reportError({
      projectPath: body.projectPath.trim(),
      errorMessage: body.errorMessage.trim(),
      errorType: body.errorType,
      filePath: body.filePath,
      lineNumber: body.lineNumber,
    });

    const record = await db.compilationError.findUnique({
      where: { id },
      include: { healingAttempts: true },
    });

    return created(record);
  } catch (e) {
    return serverError(e);
  }
}
