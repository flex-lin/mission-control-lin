import { db } from "@/lib/db"
import { ok, serverError } from "@/lib/api-helpers"
import type { SelfHealingStats } from "@/types"

export const dynamic = "force-dynamic"

/** GET /api/self-healing/stats — summary stats for the self-healing dashboard */
export async function GET() {
  try {
    const [total, pending, healing, healed, failed, skipped] = await Promise.all([
      db.compilationError.count(),
      db.compilationError.count({ where: { status: "pending" } }),
      db.compilationError.count({ where: { status: "healing" } }),
      db.compilationError.count({ where: { status: "healed" } }),
      db.compilationError.count({ where: { status: "failed" } }),
      db.compilationError.count({ where: { status: "skipped" } }),
    ])

    const resolved = healed + failed + skipped
    const successRate = resolved > 0 ? Math.round((healed / resolved) * 100) : 0

    const stats: SelfHealingStats = {
      total,
      pending,
      healing,
      healed,
      failed,
      skipped,
      successRate,
    }

    return ok(stats)
  } catch (e) {
    return serverError(e)
  }
}
