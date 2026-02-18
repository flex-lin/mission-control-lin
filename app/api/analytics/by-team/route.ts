import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, serverError } from "@/lib/api-helpers";
import { computeCost } from "@/lib/pricing";
import { getCutoffDate, UNTRACKED_TEAM_LABEL } from "@/lib/analytics-helpers";

// GET /api/analytics/by-team?period=7d|30d|1m
export async function GET(req: NextRequest) {
  try {
    const period = req.nextUrl.searchParams.get("period") ?? "7d";
    const cutoff = getCutoffDate(period);

    const rows = await db.proxyLog.groupBy({
      by: ["teamName", "model"],
      where: { timestamp: { gte: cutoff } },
      _sum: { inputTokens: true, outputTokens: true, cacheReadTokens: true, cacheCreationTokens: true },
      _count: { id: true },
    });

    // Aggregate across models per team
    const teamMap = new Map<string, { totalInput: number; totalOutput: number; requests: number; estimatedCost: number }>();
    for (const r of rows) {
      const name = r.teamName ?? UNTRACKED_TEAM_LABEL;
      const baseInput = r._sum.inputTokens ?? 0;
      const output = r._sum.outputTokens ?? 0;
      const cacheRead = r._sum.cacheReadTokens ?? 0;
      const cacheCreate = r._sum.cacheCreationTokens ?? 0;
      const input = baseInput + cacheRead + cacheCreate;

      const existing = teamMap.get(name) ?? { totalInput: 0, totalOutput: 0, requests: 0, estimatedCost: 0 };
      existing.totalInput += input;
      existing.totalOutput += output;
      existing.requests += r._count.id;
      existing.estimatedCost += computeCost(r.model, baseInput, output, cacheRead, cacheCreate);
      teamMap.set(name, existing);
    }

    const data = Array.from(teamMap.entries()).map(([teamName, v]) => ({
      teamName,
      totalInput: v.totalInput,
      totalOutput: v.totalOutput,
      totalTokens: v.totalInput + v.totalOutput,
      requests: v.requests,
      estimatedCost: v.estimatedCost,
    }));

    return ok(data, { count: data.length });
  } catch (e) {
    return serverError(e);
  }
}
