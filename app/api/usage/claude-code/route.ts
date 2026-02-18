import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, serverError } from "@/lib/api-helpers";
import { getCutoffDate, toLocalDateString } from "@/lib/analytics-helpers";
import type { ClaudeCodeSummary } from "@/types";

interface ModelBreakdownEntry {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheRead: number;
  cacheCreation: number;
  costCents: number;
}

// GET /api/usage/claude-code?period=7d|30d|1m
export async function GET(req: NextRequest) {
  try {
    const period = req.nextUrl.searchParams.get("period") ?? "7d";
    const cutoff = getCutoffDate(period);

    const metrics = await db.claudeCodeDailyMetric.findMany({
      where: { date: { gte: cutoff } },
      orderBy: { date: "asc" },
    });

    // ── Summary aggregation ──
    let totalSessions = 0;
    let totalLinesAdded = 0;
    let totalLinesRemoved = 0;
    let totalCommits = 0;
    let totalPRs = 0;
    let totalEditAccepted = 0;
    let totalEditRejected = 0;
    let totalWriteAccepted = 0;
    let totalWriteRejected = 0;

    // ── Daily aggregation ──
    const dailyMap = new Map<string, {
      sessions: number;
      linesAdded: number;
      linesRemoved: number;
      commits: number;
      pullRequests: number;
    }>();

    // ── By-user aggregation ──
    const userMap = new Map<string, {
      sessions: number;
      linesAdded: number;
      linesRemoved: number;
      costCents: number;
    }>();

    // ── By-model aggregation ──
    const modelMap = new Map<string, {
      inputTokens: number;
      outputTokens: number;
      costCents: number;
    }>();

    for (const m of metrics) {
      totalSessions += m.numSessions;
      totalLinesAdded += m.linesAdded;
      totalLinesRemoved += m.linesRemoved;
      totalCommits += m.commitsByClaudeCode;
      totalPRs += m.pullRequestsByClaudeCode;
      totalEditAccepted += m.editToolAccepted;
      totalEditRejected += m.editToolRejected;
      totalWriteAccepted += m.writeToolAccepted;
      totalWriteRejected += m.writeToolRejected;

      // Daily
      const date = toLocalDateString(m.date);
      const daily = dailyMap.get(date) ?? { sessions: 0, linesAdded: 0, linesRemoved: 0, commits: 0, pullRequests: 0 };
      daily.sessions += m.numSessions;
      daily.linesAdded += m.linesAdded;
      daily.linesRemoved += m.linesRemoved;
      daily.commits += m.commitsByClaudeCode;
      daily.pullRequests += m.pullRequestsByClaudeCode;
      dailyMap.set(date, daily);

      // By-user
      const user = userMap.get(m.actorIdentifier) ?? { sessions: 0, linesAdded: 0, linesRemoved: 0, costCents: 0 };
      user.sessions += m.numSessions;
      user.linesAdded += m.linesAdded;
      user.linesRemoved += m.linesRemoved;

      // Parse model breakdown for cost and per-model stats
      let breakdown: ModelBreakdownEntry[] = [];
      try {
        breakdown = JSON.parse(m.modelBreakdown) as ModelBreakdownEntry[];
      } catch { /* empty */ }

      for (const mb of breakdown) {
        user.costCents += mb.costCents;

        const model = modelMap.get(mb.model) ?? { inputTokens: 0, outputTokens: 0, costCents: 0 };
        model.inputTokens += mb.inputTokens;
        model.outputTokens += mb.outputTokens;
        model.costCents += mb.costCents;
        modelMap.set(mb.model, model);
      }

      userMap.set(m.actorIdentifier, user);
    }

    const editTotal = totalEditAccepted + totalEditRejected;
    const writeTotal = totalWriteAccepted + totalWriteRejected;

    const result: ClaudeCodeSummary = {
      summary: {
        totalSessions,
        totalLinesAdded,
        totalLinesRemoved,
        totalCommits,
        totalPRs,
        avgEditAcceptRate: editTotal > 0 ? totalEditAccepted / editTotal : 0,
        avgWriteAcceptRate: writeTotal > 0 ? totalWriteAccepted / writeTotal : 0,
      },
      daily: Array.from(dailyMap.entries()).map(([date, d]) => ({ date, ...d })),
      byUser: Array.from(userMap.entries()).map(([actor, u]) => ({ actor, ...u })),
      byModel: Array.from(modelMap.entries()).map(([model, m]) => ({ model, ...m })),
    };

    return ok(result);
  } catch (e) {
    return serverError(e);
  }
}
