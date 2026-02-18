import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ok, serverError } from "@/lib/api-helpers";
import { computeCost } from "@/lib/pricing";

// GET /api/analytics?period=7d|30d|1m&groupBy=day|model|team
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = req.nextUrl;
    const period = searchParams.get("period") ?? "7d";
    const groupBy = searchParams.get("groupBy") ?? "day";

    // Compute cutoff date
    const now = new Date();
    const cutoff = new Date(now);
    if (period === "all") cutoff.setFullYear(2000);
    else if (period === "30d") cutoff.setDate(now.getDate() - 30);
    else if (period === "1m") cutoff.setMonth(now.getMonth() - 1);
    else cutoff.setDate(now.getDate() - 7);

    if (groupBy === "model") {
      const rows = await db.proxyLog.groupBy({
        by: ["model"],
        where: { timestamp: { gte: cutoff } },
        _sum: { inputTokens: true, outputTokens: true },
        _count: { id: true },
        _avg: { latencyMs: true },
      });

      const data = rows.map((r) => ({
        model: r.model,
        totalInput: r._sum.inputTokens ?? 0,
        totalOutput: r._sum.outputTokens ?? 0,
        requests: r._count.id,
        avgLatencyMs: Math.round(r._avg.latencyMs ?? 0),
        estimatedCost: computeCost(r.model, r._sum.inputTokens ?? 0, r._sum.outputTokens ?? 0),
      }));

      return ok(data);
    }

    if (groupBy === "team") {
      const rows = await db.proxyLog.groupBy({
        by: ["teamName"],
        where: { timestamp: { gte: cutoff } },
        _sum: { inputTokens: true, outputTokens: true },
        _count: { id: true },
      });

      const data = rows.map((r) => ({
        teamName: r.teamName ?? "unknown",
        totalInput: r._sum.inputTokens ?? 0,
        totalOutput: r._sum.outputTokens ?? 0,
        requests: r._count.id,
      }));

      return ok(data);
    }

    // Default: group by day from proxy_logs
    const logs = await db.proxyLog.findMany({
      where: { timestamp: { gte: cutoff } },
      select: { timestamp: true, model: true, inputTokens: true, outputTokens: true },
      orderBy: { timestamp: "asc" },
    });

    // Aggregate by date
    const byDate = new Map<string, { totalInput: number; totalOutput: number; estimatedCost: number }>();
    for (const log of logs) {
      const date = log.timestamp.toISOString().slice(0, 10);
      const existing = byDate.get(date) ?? { totalInput: 0, totalOutput: 0, estimatedCost: 0 };
      byDate.set(date, {
        totalInput: existing.totalInput + log.inputTokens,
        totalOutput: existing.totalOutput + log.outputTokens,
        estimatedCost: existing.estimatedCost + computeCost(log.model, log.inputTokens, log.outputTokens),
      });
    }

    const data = Array.from(byDate.entries()).map(([date, vals]) => ({
      date,
      ...vals,
    }));

    // Also compute overall stats
    const stats = await db.proxyLog.aggregate({
      where: { timestamp: { gte: cutoff } },
      _sum: { inputTokens: true, outputTokens: true },
      _count: { id: true },
      _avg: { latencyMs: true },
    });

    return ok(data, {
      totalRequests: stats._count.id,
      totalInputTokens: stats._sum.inputTokens ?? 0,
      totalOutputTokens: stats._sum.outputTokens ?? 0,
      avgLatencyMs: Math.round(stats._avg.latencyMs ?? 0),
    });
  } catch (e) {
    return serverError(e);
  }
}
