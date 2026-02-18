import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ok, serverError } from "@/lib/api-helpers";
import { computeCost } from "@/lib/pricing";
import { getCutoffDate, UNTRACKED_TEAM_LABEL } from "@/lib/analytics-helpers";

export interface TaskTokenEntry {
  taskId: string;
  subject: string;
  status: string;
  owner: string | null;
  teamName: string;
  totalInput: number;
  totalOutput: number;
  totalTokens: number;
  estimatedCost: number;
  requests: number;
  attribution: "exact" | "team-level";
}

/**
 * Build by-task token attribution from proxy_logs.
 *
 * Strategy: proxy_logs are the source of truth for token data.
 * We group by (teamName, memberName) for member-level rows,
 * and by (teamName) for team-level rollups. Each proxy team
 * becomes one or more rows in the output.
 */
export async function buildByTaskData(cutoff: Date): Promise<TaskTokenEntry[]> {
  // Query proxy logs grouped by (teamName, memberName, model)
  const rows = await db.proxyLog.groupBy({
    by: ["teamName", "memberName", "model"],
    where: { timestamp: { gte: cutoff } },
    _sum: {
      inputTokens: true,
      outputTokens: true,
      cacheReadTokens: true,
      cacheCreationTokens: true,
    },
    _count: { id: true },
  });

  // Aggregate into two maps:
  // memberMap: "team:member" → stats (for rows with member attribution)
  // teamMap: "team" → stats (all rows, for team-level totals)
  type TokenStats = {
    totalInput: number;
    totalOutput: number;
    estimatedCost: number;
    requests: number;
  };

  const memberMap = new Map<string, TokenStats>();
  const teamMap = new Map<string, TokenStats>();

  for (const r of rows) {
    const team = r.teamName ?? UNTRACKED_TEAM_LABEL;
    const member = r.memberName;

    const baseInput = r._sum.inputTokens ?? 0;
    const output = r._sum.outputTokens ?? 0;
    const cacheRead = r._sum.cacheReadTokens ?? 0;
    const cacheCreate = r._sum.cacheCreationTokens ?? 0;
    const input = baseInput + cacheRead + cacheCreate;
    const cost = computeCost(r.model, baseInput, output, cacheRead, cacheCreate);

    // Team-level accumulation
    const te = teamMap.get(team) ?? { totalInput: 0, totalOutput: 0, estimatedCost: 0, requests: 0 };
    te.totalInput += input;
    te.totalOutput += output;
    te.requests += r._count.id;
    te.estimatedCost += cost;
    teamMap.set(team, te);

    // Member-level accumulation (only when member_name present)
    if (member) {
      const key = `${team}:${member}`;
      const me = memberMap.get(key) ?? { totalInput: 0, totalOutput: 0, estimatedCost: 0, requests: 0 };
      me.totalInput += input;
      me.totalOutput += output;
      me.requests += r._count.id;
      me.estimatedCost += cost;
      memberMap.set(key, me);
    }
  }

  const data: TaskTokenEntry[] = [];

  // For each team in proxy_logs:
  // - If it has member-level data → emit one row per member (exact attribution)
  // - Always emit a team-level row for the remaining unattributed tokens
  for (const [teamName, teamStats] of teamMap) {
    // Sum up what's already attributed to specific members
    let attributedInput = 0;
    let attributedOutput = 0;
    let attributedCost = 0;
    let attributedRequests = 0;

    for (const [key, mStats] of memberMap) {
      if (!key.startsWith(`${teamName}:`)) continue;
      const memberName = key.slice(teamName.length + 1);

      data.push({
        taskId: `${teamName}:${memberName}`,
        subject: `${memberName}`,
        status: "tracked",
        owner: memberName,
        teamName,
        totalInput: mStats.totalInput,
        totalOutput: mStats.totalOutput,
        totalTokens: mStats.totalInput + mStats.totalOutput,
        estimatedCost: mStats.estimatedCost,
        requests: mStats.requests,
        attribution: "exact",
      });

      attributedInput += mStats.totalInput;
      attributedOutput += mStats.totalOutput;
      attributedCost += mStats.estimatedCost;
      attributedRequests += mStats.requests;
    }

    // Remaining unattributed tokens for this team
    const remainInput = teamStats.totalInput - attributedInput;
    const remainOutput = teamStats.totalOutput - attributedOutput;
    const remainCost = teamStats.estimatedCost - attributedCost;
    const remainRequests = teamStats.requests - attributedRequests;

    if (remainRequests > 0) {
      data.push({
        taskId: teamName,
        subject: teamName,
        status: "tracked",
        owner: null,
        teamName,
        totalInput: remainInput,
        totalOutput: remainOutput,
        totalTokens: remainInput + remainOutput,
        estimatedCost: remainCost,
        requests: remainRequests,
        attribution: "team-level",
      });
    }
  }

  return data;
}

// GET /api/analytics/by-task?period=7d
export async function GET(req: NextRequest) {
  try {
    const period = req.nextUrl.searchParams.get("period") ?? "7d";
    const cutoff = getCutoffDate(period);
    const data = await buildByTaskData(cutoff);
    return ok(data, { count: data.length });
  } catch (e) {
    return serverError(e);
  }
}
