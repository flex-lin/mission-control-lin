import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, serverError } from "@/lib/api-helpers";
import { getCutoffDate } from "@/lib/analytics-helpers";
import type { UsageByWorkspace } from "@/types";

// GET /api/usage/by-workspace?period=7d|30d|1m|all
export async function GET(req: NextRequest) {
  try {
    const period = req.nextUrl.searchParams.get("period") ?? "7d";
    const cutoff = getCutoffDate(period);

    // Usage records grouped by workspace
    const usageRows = await db.usageRecord.groupBy({
      by: ["workspaceId"],
      where: { bucketStart: { gte: cutoff } },
      _sum: {
        uncachedInputTokens: true,
        cacheReadInputTokens: true,
        cache5mCreationTokens: true,
        cache1hCreationTokens: true,
        outputTokens: true,
      },
    });

    // Cost records grouped by workspace
    const costRows = await db.costRecord.groupBy({
      by: ["workspaceId"],
      where: { bucketStart: { gte: cutoff } },
      _sum: { amountCents: true },
    });
    const costByWs = new Map(costRows.map((r) => [r.workspaceId ?? "", r._sum.amountCents ?? 0]));

    const data: UsageByWorkspace[] = usageRows.map((r) => {
      const uncached = r._sum.uncachedInputTokens ?? 0;
      const cacheRead = r._sum.cacheReadInputTokens ?? 0;
      const cacheCreation = (r._sum.cache5mCreationTokens ?? 0) + (r._sum.cache1hCreationTokens ?? 0);
      const output = r._sum.outputTokens ?? 0;

      return {
        workspaceId: r.workspaceId || null,
        totalInputTokens: uncached + cacheRead + cacheCreation,
        outputTokens: output,
        costCents: costByWs.get(r.workspaceId ?? "") ?? 0,
      };
    });

    return ok(data, { count: data.length });
  } catch (e) {
    return serverError(e);
  }
}
