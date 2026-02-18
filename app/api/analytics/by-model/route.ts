import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, serverError } from "@/lib/api-helpers";
import { computeCost } from "@/lib/pricing";
import { getCutoffDate } from "@/lib/analytics-helpers";

// GET /api/analytics/by-model?period=7d|30d|1m
export async function GET(req: NextRequest) {
  try {
    const period = req.nextUrl.searchParams.get("period") ?? "7d";
    const cutoff = getCutoffDate(period);

    const rows = await db.proxyLog.groupBy({
      by: ["model"],
      where: { timestamp: { gte: cutoff } },
      _sum: { inputTokens: true, outputTokens: true, cacheReadTokens: true, cacheCreationTokens: true },
      _count: { id: true },
      _avg: { latencyMs: true },
    });

    const data = rows.map((r) => {
      const input = r._sum.inputTokens ?? 0;
      const output = r._sum.outputTokens ?? 0;
      const cacheRead = r._sum.cacheReadTokens ?? 0;
      const cacheCreate = r._sum.cacheCreationTokens ?? 0;
      return {
        model: r.model,
        totalInput: input + cacheRead + cacheCreate,
        totalOutput: output,
        cacheReadTokens: cacheRead,
        cacheCreationTokens: cacheCreate,
        totalTokens: input + cacheRead + cacheCreate + output,
        requests: r._count.id,
        avgLatencyMs: Math.round(r._avg.latencyMs ?? 0),
        estimatedCost: computeCost(r.model, input, output, cacheRead, cacheCreate),
      };
    });

    return ok(data, { count: data.length });
  } catch (e) {
    return serverError(e);
  }
}
