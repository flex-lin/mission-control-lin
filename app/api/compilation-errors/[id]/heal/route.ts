/**
 * POST /api/compilation-errors/[id]/heal
 *
 * Trigger a healing attempt for the given compilation error.
 * The AI-powered healer will:
 *   1. Ask Claude for file patches
 *   2. Apply them to disk
 *   3. Run the build to verify the fix
 *   4. Record the attempt result
 *
 * Returns a HealingResult object.
 */
import { NextRequest } from "next/server";
import { ok, err, notFound, serverError } from "@/lib/api-helpers";
import { db } from "@/lib/db";
import { healError } from "@/lib/self-healer";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const numId = parseInt(id, 10);
    if (isNaN(numId)) return err("Invalid id", "VALIDATION_ERROR");

    const record = await db.compilationError.findUnique({ where: { id: numId } });
    if (!record) return notFound(`CompilationError #${id} not found`);

    if (record.status === "healed") {
      return ok({
        compilationErrorId: numId,
        success: true,
        attemptNumber: record.retryCount,
        strategy: record.healingStrategy ?? "custom",
        resolution: record.resolution ?? "Already healed",
        durationMs: 0,
      });
    }

    if (record.status === "healing") {
      return err(
        "A healing attempt is already in progress for this error",
        "CONFLICT",
        409
      );
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return err(
        "ANTHROPIC_API_KEY environment variable is not set — cannot run AI healing",
        "CONFIGURATION_ERROR",
        503
      );
    }

    const result = await healError(numId);
    return ok(result);
  } catch (e) {
    return serverError(e);
  }
}
