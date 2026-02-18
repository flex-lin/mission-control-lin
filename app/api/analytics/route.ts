import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, serverError } from "@/lib/api-helpers";
import { computeCost } from "@/lib/pricing";
import { getCutoffDate } from "@/lib/analytics-helpers";

// GET /api/analytics?period=7d|30d|1m
// Returns daily aggregated data only. Use /by-model, /by-team, /by-member for grouped views.
export async function GET(req: NextRequest) {
  try {
    const period = req.nextUrl.searchParams.get("period") ?? "7d";
    const cutoff = getCutoffDate(period);

    // Group by day from proxy_logs
    const logs = await db.proxyLog.findMany({
      where: { timestamp: { gte: cutoff } },
      select: { timestamp: true, model: true, inputTokens: true, outputTokens: true, cacheReadTokens: true, cacheCreationTokens: true },
      orderBy: { timestamp: "asc" },
    });

    // Aggregate by date
    const byDate = new Map<string, { totalInput: number; totalOutput: number; cacheReadTokens: number; cacheCreationTokens: number; estimatedCost: number }>();
    for (const log of logs) {
      const date = log.timestamp.toISOString().slice(0, 10);
      const existing = byDate.get(date) ?? { totalInput: 0, totalOutput: 0, cacheReadTokens: 0, cacheCreationTokens: 0, estimatedCost: 0 };
      byDate.set(date, {
        totalInput: existing.totalInput + log.inputTokens + log.cacheReadTokens + log.cacheCreationTokens,
        totalOutput: existing.totalOutput + log.outputTokens,
        cacheReadTokens: existing.cacheReadTokens + log.cacheReadTokens,
        cacheCreationTokens: existing.cacheCreationTokens + log.cacheCreationTokens,
        estimatedCost: existing.estimatedCost + computeCost(log.model, log.inputTokens, log.outputTokens, log.cacheReadTokens, log.cacheCreationTokens),
      });
    }

    const data = Array.from(byDate.entries()).map(([date, vals]) => ({
      date,
      ...vals,
    }));

    // Also compute overall stats
    const stats = await db.proxyLog.aggregate({
      where: { timestamp: { gte: cutoff } },
      _sum: { inputTokens: true, outputTokens: true, cacheReadTokens: true, cacheCreationTokens: true },
      _count: { id: true },
      _avg: { latencyMs: true },
    });

    return ok(data, {
      totalRequests: stats._count.id,
      totalInputTokens: (stats._sum.inputTokens ?? 0) + (stats._sum.cacheReadTokens ?? 0) + (stats._sum.cacheCreationTokens ?? 0),
      totalOutputTokens: stats._sum.outputTokens ?? 0,
      totalCacheReadTokens: stats._sum.cacheReadTokens ?? 0,
      totalCacheCreationTokens: stats._sum.cacheCreationTokens ?? 0,
      avgLatencyMs: Math.round(stats._avg.latencyMs ?? 0),
    });
  } catch (e) {
    return serverError(e);
  }
}
