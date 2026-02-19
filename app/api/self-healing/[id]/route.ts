import { db } from "@/lib/db"
import { ok, notFound, err, serverError } from "@/lib/api-helpers"
import { NextRequest } from "next/server"
import type { CompilationErrorStatus, HealingStrategy } from "@/types"

export const dynamic = "force-dynamic"

/** GET /api/self-healing/[id] — get a single compilation error with healing attempts */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const numId = parseInt(id, 10)
    if (isNaN(numId)) return err("Invalid id", "INVALID_ID")

    const error = await db.compilationError.findUnique({
      where: { id: numId },
      include: {
        healingAttempts: { orderBy: { attemptNumber: "asc" } },
      },
    })

    if (!error) return notFound("Compilation error not found")
    return ok(error)
  } catch (e) {
    return serverError(e)
  }
}

/** PATCH /api/self-healing/[id] — update status, strategy, resolution */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const numId = parseInt(id, 10)
    if (isNaN(numId)) return err("Invalid id", "INVALID_ID")

    const body = (await request.json()) as {
      status?: CompilationErrorStatus
      healingStrategy?: HealingStrategy
      resolution?: string
    }

    const validStatuses: CompilationErrorStatus[] = ["pending", "healing", "healed", "failed", "skipped"]
    const validStrategies: HealingStrategy[] = ["fix_types", "fix_imports", "fix_syntax", "custom"]

    if (body.status && !validStatuses.includes(body.status)) {
      return err(`Invalid status: ${body.status}`, "INVALID_STATUS")
    }
    if (body.healingStrategy && !validStrategies.includes(body.healingStrategy)) {
      return err(`Invalid healingStrategy: ${body.healingStrategy}`, "INVALID_STRATEGY")
    }

    const updated = await db.compilationError.update({
      where: { id: numId },
      data: {
        ...(body.status ? { status: body.status } : {}),
        ...(body.status === "healed" ? { healedAt: new Date() } : {}),
        ...(body.healingStrategy ? { healingStrategy: body.healingStrategy } : {}),
        ...(body.resolution !== undefined ? { resolution: body.resolution } : {}),
      },
      include: { healingAttempts: { orderBy: { attemptNumber: "asc" } } },
    })

    return ok(updated)
  } catch (e) {
    return serverError(e)
  }
}

/** DELETE /api/self-healing/[id] — delete a compilation error record */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const numId = parseInt(id, 10)
    if (isNaN(numId)) return err("Invalid id", "INVALID_ID")

    await db.compilationError.delete({ where: { id: numId } })
    return ok({ deleted: true })
  } catch (e) {
    return serverError(e)
  }
}
