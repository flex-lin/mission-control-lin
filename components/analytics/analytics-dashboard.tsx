"use client"

import { useState, useEffect, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { TokenUsageChart } from "@/components/analytics/token-usage-chart"
import { ModelPieChart, TeamBarChart } from "@/components/analytics/model-breakdown-chart"
import { TeamMemberChart } from "@/components/analytics/team-member-chart"
import { RequestLogTable } from "@/components/analytics/request-log-table"
import type { ProxyLog } from "@/types"

interface DailyEntry {
  date: string
  totalInput: number
  totalOutput: number
  estimatedCost: number
}

interface ModelEntry {
  model: string
  totalInput: number
  totalOutput: number
  totalTokens: number
  requests: number
  avgLatencyMs: number
  estimatedCost: number
}

interface TeamEntry {
  teamName: string
  totalInput: number
  totalOutput: number
  totalTokens: number
  requests: number
}

interface MemberEntry {
  memberName: string
  teamName: string
  totalInput: number
  totalOutput: number
  totalTokens: number
  requests: number
  estimatedCost: number
}

interface AnalyticsData {
  daily: DailyEntry[]
  byModel: ModelEntry[]
  byTeam: TeamEntry[]
  byMember: MemberEntry[]
  logs: ProxyLog[]
  totalInput: number
  totalOutput: number
  totalCost: number
  totalRequests: number
}

type Period = "7d" | "30d" | "all"

const PERIOD_LABELS: Record<Period, string> = {
  "7d": "7 Days",
  "30d": "30 Days",
  all: "All Time",
}

interface AnalyticsDashboardProps {
  initialData: AnalyticsData
}

async function fetchAnalyticsData(period: Period): Promise<AnalyticsData> {
  const periodParam = period
  const [dailyRes, modelRes, teamRes, memberRes, logsRes] = await Promise.allSettled([
    fetch(`/api/analytics?period=${periodParam}&groupBy=day`, { cache: "no-store" }),
    fetch(`/api/analytics/by-model?period=${periodParam}`, { cache: "no-store" }),
    fetch(`/api/analytics/by-team?period=${periodParam}`, { cache: "no-store" }),
    fetch(`/api/analytics/by-member?period=${periodParam}`, { cache: "no-store" }),
    fetch(`/api/proxy-logs?limit=500`, { cache: "no-store" }),
  ])

  const daily: DailyEntry[] =
    dailyRes.status === "fulfilled" && dailyRes.value.ok
      ? ((await dailyRes.value.json()).data ?? [])
      : []

  const byModel: ModelEntry[] =
    modelRes.status === "fulfilled" && modelRes.value.ok
      ? ((await modelRes.value.json()).data ?? [])
      : []

  const byTeam: TeamEntry[] =
    teamRes.status === "fulfilled" && teamRes.value.ok
      ? ((await teamRes.value.json()).data ?? [])
      : []

  const byMember: MemberEntry[] =
    memberRes.status === "fulfilled" && memberRes.value.ok
      ? ((await memberRes.value.json()).data ?? [])
      : []

  const logs: ProxyLog[] =
    logsRes.status === "fulfilled" && logsRes.value.ok
      ? ((await logsRes.value.json()).data ?? [])
      : []

  const totalInput = byModel.reduce((s, m) => s + m.totalInput, 0)
  const totalOutput = byModel.reduce((s, m) => s + m.totalOutput, 0)
  const totalCost = byModel.reduce((s, m) => s + m.estimatedCost, 0)
  const totalRequests = byModel.reduce((s, m) => s + m.requests, 0)

  return { daily, byModel, byTeam, byMember, logs, totalInput, totalOutput, totalCost, totalRequests }
}

export function AnalyticsDashboard({ initialData }: AnalyticsDashboardProps) {
  const [period, setPeriod] = useState<Period>("7d")
  const [data, setData] = useState<AnalyticsData>(initialData)
  const [loading, setLoading] = useState(false)

  const loadData = useCallback(async (p: Period) => {
    if (p === "7d") {
      setData(initialData)
      return
    }
    setLoading(true)
    try {
      const result = await fetchAnalyticsData(p)
      setData(result)
    } catch {
      // Keep current data on error
    } finally {
      setLoading(false)
    }
  }, [initialData])

  useEffect(() => {
    loadData(period)
  }, [period, loadData])

  const { daily, byModel, byTeam, byMember, logs, totalInput, totalOutput, totalCost, totalRequests } = data

  return (
    <div className="space-y-6 p-6">
      {/* Period selector */}
      <div className="flex items-center justify-between">
        <Tabs value={period} onValueChange={(v) => setPeriod(v as Period)}>
          <TabsList>
            {(Object.entries(PERIOD_LABELS) as [Period, string][]).map(([key, label]) => (
              <TabsTrigger key={key} value={key} className="text-xs">
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        {loading && (
          <span className="text-xs text-muted-foreground animate-pulse">Loading…</span>
        )}
      </div>

      {/* Cost summary */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Total Requests</p>
            <p className="text-2xl font-bold">{totalRequests.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Total Input Tokens</p>
            <p className="text-2xl font-bold">{totalInput.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Total Output Tokens</p>
            <p className="text-2xl font-bold">{totalOutput.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Estimated Cost ({PERIOD_LABELS[period]})</p>
            <p className="text-2xl font-bold text-emerald-400">${totalCost.toFixed(4)}</p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              Based on Anthropic pricing
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Token usage line chart */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">
            Token Usage Over Time ({PERIOD_LABELS[period]})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <TokenUsageChart data={daily} />
        </CardContent>
      </Card>

      {/* Model + team charts */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Tokens by Model</CardTitle>
          </CardHeader>
          <CardContent>
            <ModelPieChart data={byModel} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Tokens by Team</CardTitle>
          </CardHeader>
          <CardContent>
            <TeamBarChart data={byTeam} />
          </CardContent>
        </Card>
      </div>

      {/* Per-member token usage */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Token Usage by Team Member</CardTitle>
        </CardHeader>
        <CardContent>
          <TeamMemberChart data={byMember} />
        </CardContent>
      </Card>

      {/* Per-model cost breakdown */}
      {byModel.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Cost by Model</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {byModel
                .sort((a, b) => b.estimatedCost - a.estimatedCost)
                .map((m) => (
                  <div key={m.model} className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">{m.model}</span>
                    <div className="flex gap-6 text-right">
                      <span>{m.requests.toLocaleString()} requests</span>
                      <span>{m.totalTokens.toLocaleString()} tokens</span>
                      <span className="w-20 font-medium text-emerald-400">
                        ${m.estimatedCost.toFixed(4)}
                      </span>
                    </div>
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Per-team cost breakdown */}
      {byTeam.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Usage by Team</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {byTeam
                .sort((a, b) => b.totalTokens - a.totalTokens)
                .map((t) => (
                  <div key={t.teamName} className="flex items-center justify-between text-xs">
                    <span className="font-medium text-foreground">{t.teamName}</span>
                    <div className="flex gap-6 text-right">
                      <span className="text-muted-foreground">{t.requests.toLocaleString()} requests</span>
                      <span className="text-blue-400">{t.totalInput.toLocaleString()} in</span>
                      <span className="text-emerald-400">{t.totalOutput.toLocaleString()} out</span>
                    </div>
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Per-member cost breakdown table */}
      {byMember.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Cost by Team Member</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {byMember
                .sort((a, b) => b.estimatedCost - a.estimatedCost)
                .map((m) => (
                  <div key={`${m.teamName}:${m.memberName}`} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-foreground">{m.memberName}</span>
                      <span className="text-muted-foreground">({m.teamName})</span>
                    </div>
                    <div className="flex gap-6 text-right">
                      <span className="text-muted-foreground">{m.requests.toLocaleString()} req</span>
                      <span>{m.totalTokens.toLocaleString()} tokens</span>
                      <span className="w-20 font-medium text-emerald-400">
                        ${m.estimatedCost.toFixed(4)}
                      </span>
                    </div>
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Request log table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">
            Request Log ({logs.length.toLocaleString()} requests)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <RequestLogTable logs={logs} />
        </CardContent>
      </Card>
    </div>
  )
}
