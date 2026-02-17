import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { listTeams } from "@/lib/claude-files";
import { ok, serverError } from "@/lib/api-helpers";

// GET /api/dashboard/stats — overview stats for the dashboard
export async function GET(_req: NextRequest): Promise<NextResponse> {
  try {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const weekAgo = new Date(today);
    weekAgo.setDate(today.getDate() - 7);

    // Total requests today vs yesterday
    const [todayCount, yesterdayCount] = await Promise.all([
      db.proxyLog.count({ where: { timestamp: { gte: today } } }),
      db.proxyLog.count({
        where: { timestamp: { gte: yesterday, lt: today } },
      }),
    ]);

    // Avg latency this week vs last week
    const prevWeek = new Date(weekAgo);
    prevWeek.setDate(weekAgo.getDate() - 7);

    const [thisWeekStats, lastWeekStats] = await Promise.all([
      db.proxyLog.aggregate({
        where: { timestamp: { gte: weekAgo } },
        _avg: { latencyMs: true },
        _sum: { inputTokens: true, outputTokens: true },
      }),
      db.proxyLog.aggregate({
        where: { timestamp: { gte: prevWeek, lt: weekAgo } },
        _avg: { latencyMs: true },
        _sum: { inputTokens: true, outputTokens: true },
      }),
    ]);

    // Active teams
    const teams = listTeams();
    const activeTeams = teams.length;

    // Estimate cost (this week)
    const totalInputThisWeek = thisWeekStats._sum.inputTokens ?? 0;
    const totalOutputThisWeek = thisWeekStats._sum.outputTokens ?? 0;
    const estimatedCost =
      (totalInputThisWeek / 1_000_000) * 3 +
      (totalOutputThisWeek / 1_000_000) * 15;

    const prevCost =
      ((lastWeekStats._sum.inputTokens ?? 0) / 1_000_000) * 3 +
      ((lastWeekStats._sum.outputTokens ?? 0) / 1_000_000) * 15;

    function pctChange(current: number, previous: number): number {
      if (previous === 0) return current > 0 ? 100 : 0;
      return Math.round(((current - previous) / previous) * 100);
    }

    return ok({
      totalRequests: {
        value: todayCount,
        change: pctChange(todayCount, yesterdayCount),
        period: "vs yesterday",
      },
      avgLatencyMs: {
        value: Math.round(thisWeekStats._avg.latencyMs ?? 0),
        change: pctChange(
          thisWeekStats._avg.latencyMs ?? 0,
          lastWeekStats._avg.latencyMs ?? 0
        ),
        period: "vs last week",
      },
      activeTeams: {
        value: activeTeams,
        change: 0,
        period: "total",
      },
      estimatedCost: {
        value: Math.round(estimatedCost * 100) / 100,
        change: pctChange(estimatedCost, prevCost),
        period: "vs last week",
      },
    });
  } catch (e) {
    return serverError(e);
  }
}
