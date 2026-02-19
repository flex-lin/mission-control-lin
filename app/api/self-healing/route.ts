import { db } from "@/lib/db"
import { ok, err, serverError } from "@/lib/api-helpers"
import { NextRequest } from "next/server"
import type { ReportCompilationErrorRequest, CompilationErrorType } from "@/types"

export const dynamic = "force-dynamic"

/** GET /api/self-healing — list compilation errors with optional filters */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const status = searchParams.get("status")
    const projectPath = searchParams.get("projectPath")
    const limit = Math.min(parseInt(searchParams.get("limit") ?? "50", 10), 100)

    const errors = await db.compilationError.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(projectPath ? { projectPath } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        healingAttempts: {
          orderBy: { attemptNumber: "asc" },
        },
      },
    })

    return ok(errors)
  } catch (e) {
    return serverError(e)
  }
}

/** POST /api/self-healing — report a new compilation error */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as ReportCompilationErrorRequest

    if (!body.projectPath || !body.errorMessage) {
      return err("projectPath and errorMessage are required", "MISSING_FIELDS")
    }

    const validErrorTypes: CompilationErrorType[] = ["typescript", "build", "lint", "runtime"]
    const errorType = (body.errorType && validErrorTypes.includes(body.errorType))
      ? body.errorType
      : "build"

    const error = await db.compilationError.create({
      data: {
        projectPath: body.projectPath,
        errorMessage: body.errorMessage,
        errorType,
        filePath: body.filePath ?? null,
        lineNumber: body.lineNumber ?? null,
        status: "pending",
        retryCount: 0,
        maxRetries: 3,
      },
    })

    return ok(error)
  } catch (e) {
    return serverError(e)
  }
}
