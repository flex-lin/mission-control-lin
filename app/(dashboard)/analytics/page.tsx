export const dynamic = "force-dynamic"

import { Topbar } from "@/components/layout/topbar"
import { IngestButton } from "@/components/analytics/ingest-button"
import { AnalyticsDashboard } from "@/components/analytics/analytics-dashboard"
import { db } from "@/lib/db"
import { computeCost } from "@/lib/pricing"
import { getCutoffDate, toLocalDateString, UNTRACKED_TEAM_LABEL } from "@/lib/analytics-helpers"
import type { DailyEntry, ModelEntry, TeamEntry, MemberEntry, ProxyLog } from "@/types"

async function loadAnalytics() {
  const cutoff = getCutoffDate("7d")

  const [logs, modelRows, teamRows, memberRows, recentLogs] = await Promise.all([
    db.proxyLog.findMany({
      where: { timestamp: { gte: cutoff } },
      select: { timestamp: true, model: true, inputTokens: true, outputTokens: true, cacheReadTokens: true, cacheCreationTokens: true },
      orderBy: { timestamp: "asc" },
    }),
    db.proxyLog.groupBy({
      by: ["model"],
      where: { timestamp: { gte: cutoff } },
      _sum: { inputTokens: true, outputTokens: true, cacheReadTokens: true, cacheCreationTokens: true },
      _count: { id: true },
      _avg: { latencyMs: true },
    }),
    db.proxyLog.groupBy({
      by: ["teamName", "model"],
      where: { timestamp: { gte: cutoff } },
      _sum: { inputTokens: true, outputTokens: true, cacheReadTokens: true, cacheCreationTokens: true },
      _count: { id: true },
    }),
    db.proxyLog.groupBy({
      by: ["memberName", "teamName", "model"],
      where: { timestamp: { gte: cutoff }, memberName: { not: null } },
      _sum: { inputTokens: true, outputTokens: true, cacheReadTokens: true, cacheCreationTokens: true },
      _count: { id: true },
      _avg: { latencyMs: true },
    }),
    db.proxyLog.findMany({
      orderBy: { timestamp: "desc" },
      take: 500,
    }),
  ])

  // Aggregate daily entries
  const byDate = new Map<string, DailyEntry>()
  for (const log of logs) {
    const date = toLocalDateString(log.timestamp)
    const existing = byDate.get(date) ?? { date, totalInput: 0, totalOutput: 0, cacheReadTokens: 0, cacheCreationTokens: 0, estimatedCost: 0 }
    existing.totalInput += log.inputTokens + log.cacheReadTokens + log.cacheCreationTokens
    existing.totalOutput += log.outputTokens
    existing.cacheReadTokens += log.cacheReadTokens
    existing.cacheCreationTokens += log.cacheCreationTokens
    existing.estimatedCost += computeCost(log.model, log.inputTokens, log.outputTokens, log.cacheReadTokens, log.cacheCreationTokens)
    byDate.set(date, existing)
  }
  const daily: DailyEntry[] = Array.from(byDate.values())

  // Model breakdown
  const byModel: ModelEntry[] = modelRows.map((r) => {
    const input = r._sum.inputTokens ?? 0
    const output = r._sum.outputTokens ?? 0
    const cacheRead = r._sum.cacheReadTokens ?? 0
    const cacheCreate = r._sum.cacheCreationTokens ?? 0
    return {
      model: r.model,
      totalInput: input + cacheRead + cacheCreate,
      totalOutput: output,
      cacheReadTokens: cacheRead,
      cacheCreationTokens: cacheCreate,
      totalTokens: input + cacheRead + cacheCreate + output,
      requests: r._count.id,
      avgLatencyMs: Math.round(r._avg.latencyMs ?? 0),
      estimatedCost: computeCost(r.model, input, output, cacheRead, cacheCreate),
    }
  })

  // Team breakdown (aggregate across models for cost computation)
  const teamAgg = new Map<string, { totalInput: number; totalOutput: number; requests: number; estimatedCost: number }>()
  for (const r of teamRows) {
    const name = r.teamName ?? UNTRACKED_TEAM_LABEL
    const baseInput = r._sum.inputTokens ?? 0
    const output = r._sum.outputTokens ?? 0
    const cacheRead = r._sum.cacheReadTokens ?? 0
    const cacheCreate = r._sum.cacheCreationTokens ?? 0
    const input = baseInput + cacheRead + cacheCreate

    const existing = teamAgg.get(name) ?? { totalInput: 0, totalOutput: 0, requests: 0, estimatedCost: 0 }
    existing.totalInput += input
    existing.totalOutput += output
    existing.requests += r._count.id
    existing.estimatedCost += computeCost(r.model, baseInput, output, cacheRead, cacheCreate)
    teamAgg.set(name, existing)
  }
  const byTeam: TeamEntry[] = Array.from(teamAgg.entries()).map(([teamName, v]) => ({
    teamName,
    totalInput: v.totalInput,
    totalOutput: v.totalOutput,
    totalTokens: v.totalInput + v.totalOutput,
    requests: v.requests,
    estimatedCost: v.estimatedCost,
  }))

  // Member breakdown (aggregate across models)
  const memberMap = new Map<string, MemberEntry>()
  for (const r of memberRows) {
    const key = `${r.teamName ?? UNTRACKED_TEAM_LABEL}:${r.memberName ?? "unknown"}`
    const existing = memberMap.get(key) ?? {
      memberName: r.memberName ?? "unknown",
      teamName: r.teamName ?? UNTRACKED_TEAM_LABEL,
      totalInput: 0,
      totalOutput: 0,
      totalTokens: 0,
      requests: 0,
      estimatedCost: 0,
    }
    const baseInput = r._sum.inputTokens ?? 0
    const output = r._sum.outputTokens ?? 0
    const cacheRead = r._sum.cacheReadTokens ?? 0
    const cacheCreate = r._sum.cacheCreationTokens ?? 0
    const input = baseInput + cacheRead + cacheCreate
    existing.totalInput += input
    existing.totalOutput += output
    existing.totalTokens += input + output
    existing.requests += r._count.id
    existing.estimatedCost += computeCost(r.model, baseInput, output, cacheRead, cacheCreate)
    memberMap.set(key, existing)
  }
  const byMember: MemberEntry[] = Array.from(memberMap.values())

  // Map Prisma logs to ProxyLog type
  const logsMapped: ProxyLog[] = recentLogs.map((l) => ({
    id: l.id,
    timestamp: l.timestamp.toISOString(),
    model: l.model,
    inputTokens: l.inputTokens,
    outputTokens: l.outputTokens,
    cacheReadTokens: l.cacheReadTokens,
    cacheCreationTokens: l.cacheCreationTokens,
    teamName: l.teamName ?? undefined,
    memberName: l.memberName ?? undefined,
    endpoint: l.endpoint,
    latencyMs: l.latencyMs,
    statusCode: l.statusCode,
  }))

  const totalInput = byModel.reduce((s, m) => s + m.totalInput, 0)
  const totalOutput = byModel.reduce((s, m) => s + m.totalOutput, 0)
  const totalCost = byModel.reduce((s, m) => s + m.estimatedCost, 0)
  const totalRequests = byModel.reduce((s, m) => s + m.requests, 0)

  return { daily, byModel, byTeam, byMember, logs: logsMapped, totalInput, totalOutput, totalCost, totalRequests }
}

export default async function AnalyticsPage() {
  const initialData = await loadAnalytics().catch(() => ({
    daily: [] as DailyEntry[],
    byModel: [] as ModelEntry[],
    byTeam: [] as TeamEntry[],
    byMember: [] as MemberEntry[],
    logs: [] as ProxyLog[],
    totalInput: 0,
    totalOutput: 0,
    totalCost: 0,
    totalRequests: 0,
  }))

  return (
    <div className="flex flex-col">
      <Topbar title="Analytics" subtitle="Token usage, costs, and request logs">
        <IngestButton />
      </Topbar>
      <AnalyticsDashboard initialData={initialData} />
    </div>
  )
}
