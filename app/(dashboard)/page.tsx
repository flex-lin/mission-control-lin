export const dynamic = "force-dynamic"

import { Topbar } from "@/components/layout/topbar"
import { StatCard } from "@/components/dashboard/stat-card"
import { ActivityFeed } from "@/components/dashboard/activity-feed"
import { QuickActions } from "@/components/dashboard/quick-actions"
import { StuckTeamsSummary } from "@/components/dashboard/stuck-teams-summary"
import { Users, Zap, DollarSign, Activity } from "lucide-react"
import { db } from "@/lib/db"
import { listTeams } from "@/lib/claude-files"
import { computeCost } from "@/lib/pricing"

interface DashboardStats {
  totalRequests: { value: number; change: number; period: string }
  avgLatencyMs: { value: number; change: number; period: string }
  activeTeams: { value: number; change: number; period: string }
  estimatedCost: { value: number; change: number; period: string }
}

async function getDashboardStats(): Promise<DashboardStats> {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  const weekAgo = new Date(today)
  weekAgo.setDate(today.getDate() - 7)
  const prevWeek = new Date(weekAgo)
  prevWeek.setDate(weekAgo.getDate() - 7)

  // Active teams (always from filesystem)
  const teams = listTeams()
  const activeTeams = teams.length

  // Total requests today vs yesterday
  const [todayCount, yesterdayCount] = await Promise.all([
    db.proxyLog.count({ where: { timestamp: { gte: today } } }),
    db.proxyLog.count({ where: { timestamp: { gte: yesterday, lt: today } } }),
  ])

  // Avg latency this week vs last week
  const [thisWeekStats, lastWeekStats] = await Promise.all([
    db.proxyLog.aggregate({
      where: { timestamp: { gte: weekAgo } },
      _avg: { latencyMs: true },
    }),
    db.proxyLog.aggregate({
      where: { timestamp: { gte: prevWeek, lt: weekAgo } },
      _avg: { latencyMs: true },
    }),
  ])

  // Cost this week — group by model for accurate per-model pricing
  const [thisWeekByModel, lastWeekByModel] = await Promise.all([
    db.proxyLog.groupBy({
      by: ["model"],
      where: { timestamp: { gte: weekAgo } },
      _sum: { inputTokens: true, outputTokens: true, cacheReadTokens: true, cacheCreationTokens: true },
    }),
    db.proxyLog.groupBy({
      by: ["model"],
      where: { timestamp: { gte: prevWeek, lt: weekAgo } },
      _sum: { inputTokens: true, outputTokens: true, cacheReadTokens: true, cacheCreationTokens: true },
    }),
  ])

  const estimatedCost = thisWeekByModel.reduce(
    (sum, g) => sum + computeCost(g.model, g._sum.inputTokens ?? 0, g._sum.outputTokens ?? 0, g._sum.cacheReadTokens ?? 0, g._sum.cacheCreationTokens ?? 0),
    0,
  )
  const prevCost = lastWeekByModel.reduce(
    (sum, g) => sum + computeCost(g.model, g._sum.inputTokens ?? 0, g._sum.outputTokens ?? 0, g._sum.cacheReadTokens ?? 0, g._sum.cacheCreationTokens ?? 0),
    0,
  )

  function pctChange(current: number, previous: number): number {
    if (previous === 0) return current > 0 ? 100 : 0
    return Math.round(((current - previous) / previous) * 100)
  }

  const hasProxyData = todayCount > 0 || (thisWeekStats._avg.latencyMs ?? 0) > 0

  return {
    totalRequests: {
      value: todayCount,
      change: pctChange(todayCount, yesterdayCount),
      period: hasProxyData ? "vs yesterday" : "No proxy data yet",
    },
    avgLatencyMs: {
      value: Math.round(thisWeekStats._avg.latencyMs ?? 0),
      change: pctChange(
        thisWeekStats._avg.latencyMs ?? 0,
        lastWeekStats._avg.latencyMs ?? 0,
      ),
      period: hasProxyData ? "vs last week" : "No proxy data yet",
    },
    activeTeams: {
      value: activeTeams,
      change: 0,
      period: "total",
    },
    estimatedCost: {
      value: Math.round(estimatedCost * 10000) / 10000,
      change: pctChange(estimatedCost, prevCost),
      period: hasProxyData ? "vs last week" : "No proxy data yet",
    },
  }
}

function changeSuffix(change: number, period: string) {
  if (change === 0) return period
  const sign = change > 0 ? "+" : ""
  return `${sign}${change}% ${period}`
}

function changeTrend(change: number): "up" | "down" | "neutral" {
  if (change > 0) return "up"
  if (change < 0) return "down"
  return "neutral"
}

export default async function DashboardPage() {
  const stats = await getDashboardStats()

  return (
    <div className="flex flex-col">
      <Topbar title="Dashboard" subtitle="Mission Control Lin — overview" />

      <div className="flex-1 space-y-6 p-6">
        {/* Stat Cards */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            title="Active Teams"
            value={stats.activeTeams.value}
            subtitle={stats.activeTeams.period}
            icon={Users}
            trend="neutral"
          />
          <StatCard
            title="Requests Today"
            value={stats.totalRequests.value.toLocaleString()}
            subtitle={changeSuffix(stats.totalRequests.change, stats.totalRequests.period)}
            icon={Activity}
            trend={changeTrend(stats.totalRequests.change)}
          />
          <StatCard
            title="Avg Latency"
            value={`${stats.avgLatencyMs.value}ms`}
            subtitle={changeSuffix(stats.avgLatencyMs.change, stats.avgLatencyMs.period)}
            icon={Zap}
            trend={stats.avgLatencyMs.change > 0 ? "down" : "up"}
          />
          <StatCard
            title="Est. Cost (week)"
            value={`$${stats.estimatedCost.value.toFixed(4)}`}
            subtitle={changeSuffix(stats.estimatedCost.change, stats.estimatedCost.period)}
            icon={DollarSign}
            trend={changeTrend(-stats.estimatedCost.change)}
          />
        </div>

        {/* Stuck Teams */}
        <StuckTeamsSummary />

        {/* Activity + Quick Actions */}
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <ActivityFeed />
          </div>
          <div>
            <QuickActions />
          </div>
        </div>
      </div>
    </div>
  )
}
