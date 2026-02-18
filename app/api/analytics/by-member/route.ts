import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ok, serverError } from "@/lib/api-helpers";
import { computeCost } from "@/lib/pricing";

// GET /api/analytics/by-member?period=7d&team=teamName
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const period = req.nextUrl.searchParams.get("period") ?? "7d";
    const teamFilter = req.nextUrl.searchParams.get("team");

    const now = new Date();
    const cutoff = new Date(now);
    if (period === "all") cutoff.setFullYear(2000);
    else if (period === "30d") cutoff.setDate(now.getDate() - 30);
    else if (period === "1m") cutoff.setMonth(now.getMonth() - 1);
    else cutoff.setDate(now.getDate() - 7);

    const where: Record<string, unknown> = {
      timestamp: { gte: cutoff },
      memberName: { not: null },
    };
    if (teamFilter) where.teamName = teamFilter;

    const rows = await db.proxyLog.groupBy({
      by: ["memberName", "teamName", "model"],
      where,
      _sum: { inputTokens: true, outputTokens: true },
      _count: { id: true },
      _avg: { latencyMs: true },
    });

    // Aggregate by member (across models)
    const memberMap = new Map<
      string,
      {
        memberName: string;
        teamName: string;
        totalInput: number;
        totalOutput: number;
        totalTokens: number;
        requests: number;
        avgLatencyMs: number;
        estimatedCost: number;
        latencySum: number;
        latencyCount: number;
      }
    >();

    for (const r of rows) {
      const key = `${r.teamName ?? "unknown"}:${r.memberName ?? "unknown"}`;
      const existing = memberMap.get(key) ?? {
        memberName: r.memberName ?? "unknown",
        teamName: r.teamName ?? "unknown",
        totalInput: 0,
        totalOutput: 0,
        totalTokens: 0,
        requests: 0,
        avgLatencyMs: 0,
        estimatedCost: 0,
        latencySum: 0,
        latencyCount: 0,
      };

      const input = r._sum.inputTokens ?? 0;
      const output = r._sum.outputTokens ?? 0;

      existing.totalInput += input;
      existing.totalOutput += output;
      existing.totalTokens += input + output;
      existing.requests += r._count.id;
      existing.latencySum += (r._avg.latencyMs ?? 0) * r._count.id;
      existing.latencyCount += r._count.id;
      existing.estimatedCost += computeCost(r.model, input, output);

      memberMap.set(key, existing);
    }

    const data = Array.from(memberMap.values()).map((m) => ({
      memberName: m.memberName,
      teamName: m.teamName,
      totalInput: m.totalInput,
      totalOutput: m.totalOutput,
      totalTokens: m.totalTokens,
      requests: m.requests,
      avgLatencyMs: m.latencyCount > 0 ? Math.round(m.latencySum / m.latencyCount) : 0,
      estimatedCost: m.estimatedCost,
    }));

    return ok(data, { count: data.length });
  } catch (e) {
    return serverError(e);
  }
}
