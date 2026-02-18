import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, serverError } from "@/lib/api-helpers";
import { computeCost } from "@/lib/pricing";
import { getCutoffDate } from "@/lib/analytics-helpers";
import type { UsageDailySummary } from "@/types";

// GET /api/usage/summary?period=7d|30d|1m|all&source=api|proxy|all
export async function GET(req: NextRequest) {
  try {
    const period = req.nextUrl.searchParams.get("period") ?? "7d";
    const source = req.nextUrl.searchParams.get("source") ?? "all";
    const cutoff = getCutoffDate(period);

    const data: UsageDailySummary[] = [];
    let totalCostCents = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalRequests: number | undefined;

    // ── API data from UsageRecord + CostRecord ──
    if (source === "api" || source === "all") {
      const usageRecords = await db.usageRecord.findMany({
        where: { bucketStart: { gte: cutoff } },
        orderBy: { bucketStart: "asc" },
      });

      // Group by date
      const byDate = new Map<string, { uncached: number; cacheRead: number; cacheCreation: number; output: number }>();
      for (const r of usageRecords) {
        const date = r.bucketStart.toISOString().slice(0, 10);
        const existing = byDate.get(date) ?? { uncached: 0, cacheRead: 0, cacheCreation: 0, output: 0 };
        existing.uncached += r.uncachedInputTokens;
        existing.cacheRead += r.cacheReadInputTokens;
        existing.cacheCreation += r.cache5mCreationTokens + r.cache1hCreationTokens;
        existing.output += r.outputTokens;
        byDate.set(date, existing);
      }

      // Get cost data for the same period
      const costRecords = await db.costRecord.findMany({
        where: { bucketStart: { gte: cutoff } },
      });
      const costByDate = new Map<string, number>();
      for (const c of costRecords) {
        const date = c.bucketStart.toISOString().slice(0, 10);
        costByDate.set(date, (costByDate.get(date) ?? 0) + c.amountCents);
      }

      for (const [date, tokens] of byDate) {
        const totalInput = tokens.uncached + tokens.cacheRead + tokens.cacheCreation;
        const costCents = costByDate.get(date) ?? 0;
        data.push({
          date,
          totalInputTokens: totalInput,
          uncachedInputTokens: tokens.uncached,
          cacheReadTokens: tokens.cacheRead,
          cacheCreationTokens: tokens.cacheCreation,
          outputTokens: tokens.output,
          costCents,
          source: "api",
        });
        totalCostCents += costCents;
        totalInputTokens += totalInput;
        totalOutputTokens += tokens.output;
      }
    }

    // ── Proxy data from ProxyLog ──
    if (source === "proxy" || source === "all") {
      const logs = await db.proxyLog.findMany({
        where: { timestamp: { gte: cutoff } },
        select: {
          timestamp: true,
          model: true,
          inputTokens: true,
          outputTokens: true,
          cacheReadTokens: true,
          cacheCreationTokens: true,
        },
        orderBy: { timestamp: "asc" },
      });

      const byDate = new Map<string, { input: number; cacheRead: number; cacheCreation: number; output: number; cost: number }>();
      for (const log of logs) {
        const date = log.timestamp.toISOString().slice(0, 10);
        const existing = byDate.get(date) ?? { input: 0, cacheRead: 0, cacheCreation: 0, output: 0, cost: 0 };
        existing.input += log.inputTokens;
        existing.cacheRead += log.cacheReadTokens;
        existing.cacheCreation += log.cacheCreationTokens;
        existing.output += log.outputTokens;
        existing.cost += computeCost(log.model, log.inputTokens, log.outputTokens, log.cacheReadTokens, log.cacheCreationTokens) * 100;
        byDate.set(date, existing);
      }

      for (const [date, tokens] of byDate) {
        const totalInput = tokens.input + tokens.cacheRead + tokens.cacheCreation;
        data.push({
          date,
          totalInputTokens: totalInput,
          uncachedInputTokens: tokens.input,
          cacheReadTokens: tokens.cacheRead,
          cacheCreationTokens: tokens.cacheCreation,
          outputTokens: tokens.output,
          costCents: tokens.cost,
          source: "proxy",
        });
        totalCostCents += tokens.cost;
        totalInputTokens += totalInput;
        totalOutputTokens += tokens.output;
      }

      const proxyStats = await db.proxyLog.aggregate({
        where: { timestamp: { gte: cutoff } },
        _count: { id: true },
      });
      totalRequests = proxyStats._count.id;
    }

    // Sort by date
    data.sort((a, b) => a.date.localeCompare(b.date));

    return ok(data, {
      totalCostCents,
      totalInputTokens,
      totalOutputTokens,
      totalRequests,
      period,
    });
  } catch (e) {
    return serverError(e);
  }
}
