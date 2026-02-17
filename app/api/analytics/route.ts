import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ok, serverError } from "@/lib/api-helpers";

// GET /api/analytics?period=7d|30d|1m&groupBy=day|model|team
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = req.nextUrl;
    const period = searchParams.get("period") ?? "7d";
    const groupBy = searchParams.get("groupBy") ?? "day";

    // Compute cutoff date
    const now = new Date();
    const cutoff = new Date(now);
    if (period === "7d") cutoff.setDate(now.getDate() - 7);
    else if (period === "30d") cutoff.setDate(now.getDate() - 30);
    else if (period === "1m") cutoff.setMonth(now.getMonth() - 1);
    else cutoff.setDate(now.getDate() - 7);

    const cutoffIso = cutoff.toISOString();

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

    // Default: group by day using analytics_snapshots
    const snapshots = await db.analyticsSnapshot.findMany({
      where: { date: { gte: cutoffIso.slice(0, 10) } },
      orderBy: { date: "asc" },
    });

    // Aggregate by date across all models
    const byDate = new Map<string, { totalInput: number; totalOutput: number; estimatedCost: number }>();
    for (const s of snapshots) {
      const existing = byDate.get(s.date) ?? { totalInput: 0, totalOutput: 0, estimatedCost: 0 };
      byDate.set(s.date, {
        totalInput: existing.totalInput + s.totalInput,
        totalOutput: existing.totalOutput + s.totalOutput,
        estimatedCost: existing.estimatedCost + s.estimatedCost,
      });
    }

    const data = Array.from(byDate.entries()).map(([date, vals]) => ({
      date,
      ...vals,
    }));

    // Also compute overall stats from proxy_logs
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

function computeCost(model: string, inputTokens: number, outputTokens: number): number {
  // Rough pricing per 1M tokens (USD)
  const pricing: Record<string, { input: number; output: number }> = {
    "claude-opus-4-6": { input: 15, output: 75 },
    "claude-sonnet-4-6": { input: 3, output: 15 },
    "claude-haiku-4-5-20251001": { input: 0.8, output: 4 },
  };
  const p = pricing[model] ?? { input: 3, output: 15 };
  return (inputTokens / 1_000_000) * p.input + (outputTokens / 1_000_000) * p.output;
}
