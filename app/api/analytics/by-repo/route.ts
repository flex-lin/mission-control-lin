import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, serverError } from "@/lib/api-helpers";
import { computeCost } from "@/lib/pricing";
import { getCutoffDate } from "@/lib/analytics-helpers";

const UNTRACKED_REPO_LABEL = "(untracked)";

// GET /api/analytics/by-repo?period=7d|30d|1m
export async function GET(req: NextRequest) {
  try {
    const period = req.nextUrl.searchParams.get("period") ?? "7d";
    const cutoff = getCutoffDate(period);

    const rows = await db.proxyLog.groupBy({
      by: ["repoName", "model"],
      where: { timestamp: { gte: cutoff } },
      _sum: { inputTokens: true, outputTokens: true, cacheReadTokens: true, cacheCreationTokens: true },
      _count: { id: true },
    });

    // Aggregate across models per repo
    const repoMap = new Map<string, { totalInput: number; totalOutput: number; requests: number; estimatedCost: number }>();
    for (const r of rows) {
      const name = r.repoName ?? UNTRACKED_REPO_LABEL;
      const baseInput = r._sum.inputTokens ?? 0;
      const output = r._sum.outputTokens ?? 0;
      const cacheRead = r._sum.cacheReadTokens ?? 0;
      const cacheCreate = r._sum.cacheCreationTokens ?? 0;
      const input = baseInput + cacheRead + cacheCreate;

      const existing = repoMap.get(name) ?? { totalInput: 0, totalOutput: 0, requests: 0, estimatedCost: 0 };
      existing.totalInput += input;
      existing.totalOutput += output;
      existing.requests += r._count.id;
      existing.estimatedCost += computeCost(r.model, baseInput, output, cacheRead, cacheCreate);
      repoMap.set(name, existing);
    }

    const data = Array.from(repoMap.entries()).map(([repoName, v]) => ({
      repoName,
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
