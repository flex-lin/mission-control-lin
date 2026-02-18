import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, serverError } from "@/lib/api-helpers";
import { computeCost } from "@/lib/pricing";
import { getCutoffDate } from "@/lib/analytics-helpers";
import type { UsageByModel } from "@/types";

// GET /api/usage/by-model?period=7d|30d|1m|all&source=api|proxy|all
export async function GET(req: NextRequest) {
  try {
    const period = req.nextUrl.searchParams.get("period") ?? "7d";
    const source = req.nextUrl.searchParams.get("source") ?? "all";
    const cutoff = getCutoffDate(period);

    const data: UsageByModel[] = [];

    // ── API data from UsageRecord + CostRecord ──
    if (source === "api" || source === "all") {
      const usageRows = await db.usageRecord.groupBy({
        by: ["model"],
        where: { bucketStart: { gte: cutoff } },
        _sum: {
          uncachedInputTokens: true,
          cacheReadInputTokens: true,
          cache5mCreationTokens: true,
          cache1hCreationTokens: true,
          outputTokens: true,
        },
      });

      // Get cost by model
      const costRows = await db.costRecord.groupBy({
        by: ["model"],
        where: { bucketStart: { gte: cutoff } },
        _sum: { amountCents: true },
      });
      const costByModel = new Map(costRows.map((r) => [r.model ?? "", r._sum.amountCents ?? 0]));

      for (const r of usageRows) {
        const uncached = r._sum.uncachedInputTokens ?? 0;
        const cacheRead = r._sum.cacheReadInputTokens ?? 0;
        const cacheCreation = (r._sum.cache5mCreationTokens ?? 0) + (r._sum.cache1hCreationTokens ?? 0);
        const output = r._sum.outputTokens ?? 0;
        const totalInput = uncached + cacheRead + cacheCreation;

        data.push({
          model: r.model ?? "unknown",
          uncachedInputTokens: uncached,
          cacheReadTokens: cacheRead,
          cacheCreationTokens: cacheCreation,
          outputTokens: output,
          totalTokens: totalInput + output,
          costCents: costByModel.get(r.model ?? "") ?? 0,
          source: "api",
        });
      }
    }

    // ── Proxy data ──
    if (source === "proxy" || source === "all") {
      const rows = await db.proxyLog.groupBy({
        by: ["model"],
        where: { timestamp: { gte: cutoff } },
        _sum: { inputTokens: true, outputTokens: true, cacheReadTokens: true, cacheCreationTokens: true },
      });

      for (const r of rows) {
        const input = r._sum.inputTokens ?? 0;
        const output = r._sum.outputTokens ?? 0;
        const cacheRead = r._sum.cacheReadTokens ?? 0;
        const cacheCreate = r._sum.cacheCreationTokens ?? 0;

        data.push({
          model: r.model,
          uncachedInputTokens: input,
          cacheReadTokens: cacheRead,
          cacheCreationTokens: cacheCreate,
          outputTokens: output,
          totalTokens: input + cacheRead + cacheCreate + output,
          costCents: computeCost(r.model, input, output, cacheRead, cacheCreate) * 100,
          source: "proxy",
        });
      }
    }

    return ok(data, { count: data.length });
  } catch (e) {
    return serverError(e);
  }
}
