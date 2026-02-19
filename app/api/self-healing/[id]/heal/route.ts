import { db } from "@/lib/db"
import { ok, notFound, err, serverError } from "@/lib/api-helpers"
import { NextRequest } from "next/server"

export const dynamic = "force-dynamic"

/**
 * POST /api/self-healing/[id]/heal
 *
 * Triggers a self-healing attempt for the given compilation error by submitting
 * a queue task. The queue worker will then spawn an agent team to fix the errors.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const numId = parseInt(id, 10)
    if (isNaN(numId)) return err("Invalid id", "INVALID_ID")

    const compilationError = await db.compilationError.findUnique({
      where: { id: numId },
    })

    if (!compilationError) return notFound("Compilation error not found")

    if (compilationError.status === "healed") {
      return err("This error has already been healed.", "ALREADY_HEALED")
    }

    if (compilationError.retryCount >= compilationError.maxRetries) {
      return err(
        `Max retries (${compilationError.maxRetries}) reached. Mark as skipped or delete to clear.`,
        "MAX_RETRIES_REACHED"
      )
    }

    // Build a focused goal message for the queue worker
    const errorSnippet = compilationError.errorMessage.slice(0, 800)
    const fileContext = compilationError.filePath
      ? ` in \`${compilationError.filePath}\`${compilationError.lineNumber ? ` at line ${compilationError.lineNumber}` : ""}`
      : ""

    const goal =
      `Fix ${compilationError.errorType} compilation error${fileContext} in the project at ${compilationError.projectPath}.\n\n` +
      `Error details:\n\`\`\`\n${errorSnippet}\n\`\`\`\n\n` +
      `After fixing, verify by running \`pnpm build\` (or the appropriate build command). ` +
      `The compilation error record ID is ${numId} — update /api/self-healing/${numId} with ` +
      `status "healed" and the resolution description once fixed.`

    // Submit to queue
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:31777"
    const queueRes = await fetch(`${baseUrl}/api/queue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goal, projectPath: compilationError.projectPath }),
    })

    if (!queueRes.ok) {
      const queueJson = await queueRes.json() as { error?: string }
      return err(
        `Failed to queue healing task: ${queueJson.error ?? `HTTP ${queueRes.status}`}`,
        "QUEUE_FAILED"
      )
    }

    const queueJson = await queueRes.json() as { data?: { id?: number } }
    const queueTaskId = queueJson.data?.id ?? null

    // Update status to "healing" and increment retry count
    const updated = await db.compilationError.update({
      where: { id: numId },
      data: {
        status: "healing",
        retryCount: { increment: 1 },
      },
    })

    // Create a healing attempt record
    const attemptNumber = updated.retryCount
    await db.healingAttempt.create({
      data: {
        compilationErrorId: numId,
        attemptNumber,
        strategy: compilationError.healingStrategy ?? "custom",
        success: false,
      },
    })

    return ok({
      compilationErrorId: numId,
      queueTaskId,
      attemptNumber,
      status: "healing",
    })
  } catch (e) {
    return serverError(e)
  }
}
