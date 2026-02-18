import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ok, serverError } from "@/lib/api-helpers";

// GET /api/analytics/by-team?period=7d|30d|1m
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const period = req.nextUrl.searchParams.get("period") ?? "7d";

    const now = new Date();
    const cutoff = new Date(now);
    if (period === "all") cutoff.setFullYear(2000);
    else if (period === "30d") cutoff.setDate(now.getDate() - 30);
    else if (period === "1m") cutoff.setMonth(now.getMonth() - 1);
    else cutoff.setDate(now.getDate() - 7);

    const rows = await db.proxyLog.groupBy({
      by: ["teamName"],
      where: { timestamp: { gte: cutoff } },
      _sum: { inputTokens: true, outputTokens: true },
      _count: { id: true },
    });

    const data = rows.map((r) => ({
      teamName: r.teamName ?? "untracked",
      totalInput: r._sum.inputTokens ?? 0,
      totalOutput: r._sum.outputTokens ?? 0,
      totalTokens: (r._sum.inputTokens ?? 0) + (r._sum.outputTokens ?? 0),
      requests: r._count.id,
    }));

    return ok(data, { count: data.length });
  } catch (e) {
    return serverError(e);
  }
}
