import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ok, serverError } from "@/lib/api-helpers";

const PRICING: Record<string, { input: number; output: number }> = {
  "claude-opus-4-6": { input: 15, output: 75 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5-20251001": { input: 0.8, output: 4 },
};

function computeCost(model: string, input: number, output: number): number {
  const p = PRICING[model] ?? { input: 3, output: 15 };
  return (input / 1_000_000) * p.input + (output / 1_000_000) * p.output;
}

// GET /api/analytics/by-model?period=7d|30d|1m
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const period = req.nextUrl.searchParams.get("period") ?? "7d";

    const now = new Date();
    const cutoff = new Date(now);
    if (period === "30d") cutoff.setDate(now.getDate() - 30);
    else if (period === "1m") cutoff.setMonth(now.getMonth() - 1);
    else cutoff.setDate(now.getDate() - 7);

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
      totalTokens: (r._sum.inputTokens ?? 0) + (r._sum.outputTokens ?? 0),
      requests: r._count.id,
      avgLatencyMs: Math.round(r._avg.latencyMs ?? 0),
      estimatedCost: computeCost(r.model, r._sum.inputTokens ?? 0, r._sum.outputTokens ?? 0),
    }));

    return ok(data, { count: data.length });
  } catch (e) {
    return serverError(e);
  }
}
