import { db } from "@/lib/db";
import { ok, serverError } from "@/lib/api-helpers";
import { computeCost } from "@/lib/pricing";
import type { UsageLimits, UsageSummary } from "@/types";

// GET /api/analytics/usage-summary — current usage vs configured limits
export async function GET() {
  try {
    const [limits, dailyUsage, monthlyUsage] = await Promise.all([
      loadLimits(),
      aggregateUsage("day"),
      aggregateUsage("month"),
    ]);

    const summary: UsageSummary = {
      daily: {
        tokens: dailyUsage.tokens,
        cost: dailyUsage.cost,
        tokenLimit: limits.dailyTokens,
        costLimit: limits.dailyCost,
      },
      monthly: {
        tokens: monthlyUsage.tokens,
        cost: monthlyUsage.cost,
        tokenLimit: limits.monthlyTokens,
        costLimit: limits.monthlyCost,
      },
    };

    return ok(summary);
  } catch (e) {
    return serverError(e);
  }
}

async function loadLimits(): Promise<UsageLimits> {
  const prefs = await db.preference.findMany({
    where: { key: { startsWith: "usage_limit_" } },
  });
  const map = new Map(prefs.map((p) => [p.key, p.value]));

  return {
    dailyTokens: parseNum(map.get("usage_limit_daily_tokens")),
    dailyCost: parseNum(map.get("usage_limit_daily_cost")),
    monthlyTokens: parseNum(map.get("usage_limit_monthly_tokens")),
    monthlyCost: parseNum(map.get("usage_limit_monthly_cost")),
  };
}

async function aggregateUsage(
  period: "day" | "month"
): Promise<{ tokens: number; cost: number }> {
  const now = new Date();
  let cutoff: Date;

  if (period === "day") {
    // Start of today (UTC)
    cutoff = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  } else {
    // Start of this month (UTC)
    cutoff = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  }

  const logs = await db.proxyLog.findMany({
    where: { timestamp: { gte: cutoff } },
    select: {
      model: true,
      inputTokens: true,
      outputTokens: true,
      cacheReadTokens: true,
      cacheCreationTokens: true,
    },
  });

  let tokens = 0;
  let cost = 0;

  for (const log of logs) {
    const totalInput = log.inputTokens + log.cacheReadTokens + log.cacheCreationTokens;
    tokens += totalInput + log.outputTokens;
    cost += computeCost(
      log.model,
      log.inputTokens,
      log.outputTokens,
      log.cacheReadTokens,
      log.cacheCreationTokens
    );
  }

  return { tokens, cost };
}

function parseNum(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}
