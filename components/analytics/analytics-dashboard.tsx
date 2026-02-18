"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { TokenUsageChart } from "@/components/analytics/token-usage-chart"
import { ModelPieChart, TeamBarChart } from "@/components/analytics/model-breakdown-chart"
import { RequestLogTable } from "@/components/analytics/request-log-table"
import { UsageLimitsCard } from "@/components/analytics/usage-limits-card"
import { Skeleton } from "@/components/ui/skeleton"
import { toast } from "sonner"
import { useSettings } from "@/lib/settings-context"
import { RepoUsageChart } from "@/components/analytics/repo-usage-chart"
import type { ProxyLog, DailyEntry, ModelEntry, TeamEntry, MemberEntry } from "@/types"

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

async function fetchJson<T>(url: string, fallback: T): Promise<T> {
  const res = await fetch(url, { cache: "no-store" })
  if (!res.ok) throw new Error(`${url} returned ${res.status}`)
  return ((await res.json()).data as T) ?? fallback
}

async function fetchAnalyticsData(period: Period): Promise<AnalyticsData> {
  const errors: string[] = []

  const [daily, byModel, byTeam, byMember, logs] = await Promise.all([
    fetchJson<DailyEntry[]>(`/api/analytics?period=${period}&groupBy=day`, []).catch((e: Error) => {
      errors.push(e.message)
      return [] as DailyEntry[]
    }),
    fetchJson<ModelEntry[]>(`/api/analytics/by-model?period=${period}`, []).catch((e: Error) => {
      errors.push(e.message)
      return [] as ModelEntry[]
    }),
    fetchJson<TeamEntry[]>(`/api/analytics/by-team?period=${period}`, []).catch((e: Error) => {
      errors.push(e.message)
      return [] as TeamEntry[]
    }),
    fetchJson<MemberEntry[]>(`/api/analytics/by-member?period=${period}`, []).catch((e: Error) => {
      errors.push(e.message)
      return [] as MemberEntry[]
    }),
    fetchJson<ProxyLog[]>(`/api/proxy-logs?limit=500`, []).catch((e: Error) => {
      errors.push(e.message)
      return [] as ProxyLog[]
    }),
  ])

  if (errors.length > 0) {
    toast.error(`Failed to load some analytics data: ${errors[0]}`)
  }

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
  const { settings } = useSettings()
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const loadData = useCallback(async (p: Period) => {
    setLoading(true)
    try {
      const result = await fetchAnalyticsData(p)
      setData(result)
    } catch {
      toast.error("Failed to load analytics data")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData(period)
  }, [period, loadData])

  // Auto-refresh based on settings
  useEffect(() => {
    const intervalMs = (settings.refreshInterval ?? 30) * 1000
    intervalRef.current = setInterval(() => {
      loadData(period)
    }, intervalMs)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [period, loadData, settings.refreshInterval])

  const { daily, byModel, byTeam, logs, totalInput, totalOutput, totalCost, totalRequests } = data

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

      {/* Usage limits */}
      <UsageLimitsCard />

      {/* Cost summary */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="pt-4 space-y-2">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-8 w-32" />
              </CardContent>
            </Card>
          ))
        ) : (
          <>
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
          </>
        )}
      </div>

      {/* Token usage line chart */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">
            Token Usage Over Time ({PERIOD_LABELS[period]})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? <Skeleton className="h-[280px] w-full" /> : <TokenUsageChart data={daily} />}
        </CardContent>
      </Card>

      {/* Model + team charts */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Tokens by Model</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? <Skeleton className="h-[250px] w-full" /> : <ModelPieChart data={byModel} />}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Tokens by Team</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? <Skeleton className="h-[250px] w-full" /> : <TeamBarChart data={byTeam} />}
          </CardContent>
        </Card>
      </div>

      {/* Usage by Repo */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Usage by Repo</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? <Skeleton className="h-[300px] w-full" /> : <RepoUsageChart data={byTeam} />}
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
                .sort((a, b) => b.estimatedCost - a.estimatedCost)
                .map((t) => (
                  <div key={t.teamName} className="flex items-center justify-between text-xs">
                    <span className="font-medium text-foreground">{t.teamName}</span>
                    <div className="flex gap-6 text-right">
                      <span className="text-muted-foreground">{t.requests.toLocaleString()} req</span>
                      <span>{t.totalTokens.toLocaleString()} tokens</span>
                      <span className="w-20 font-medium text-emerald-400">
                        ${t.estimatedCost.toFixed(4)}
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
          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-[384px] w-full" />
            </div>
          ) : (
            <RequestLogTable logs={logs} />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
