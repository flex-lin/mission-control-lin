import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, serverError } from "@/lib/api-helpers";
import { getCutoffDate, UNTRACKED_TEAM_LABEL } from "@/lib/analytics-helpers";

// GET /api/analytics/by-team?period=7d|30d|1m
export async function GET(req: NextRequest) {
  try {
    const period = req.nextUrl.searchParams.get("period") ?? "7d";
    const cutoff = getCutoffDate(period);

    const rows = await db.proxyLog.groupBy({
      by: ["teamName"],
      where: { timestamp: { gte: cutoff } },
      _sum: { inputTokens: true, outputTokens: true, cacheReadTokens: true, cacheCreationTokens: true },
      _count: { id: true },
    });

    const data = rows.map((r) => {
      const input = (r._sum.inputTokens ?? 0) + (r._sum.cacheReadTokens ?? 0) + (r._sum.cacheCreationTokens ?? 0);
      const output = r._sum.outputTokens ?? 0;
      return {
        teamName: r.teamName ?? UNTRACKED_TEAM_LABEL,
        totalInput: input,
        totalOutput: output,
        totalTokens: input + output,
        requests: r._count.id,
      };
    });

    return ok(data, { count: data.length });
  } catch (e) {
    return serverError(e);
  }
}
