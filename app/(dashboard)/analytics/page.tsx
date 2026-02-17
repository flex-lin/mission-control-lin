export const dynamic = "force-dynamic"

import { Topbar } from "@/components/layout/topbar"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { TokenUsageChart } from "@/components/analytics/token-usage-chart"
import { ModelPieChart, TeamBarChart } from "@/components/analytics/model-breakdown-chart"
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

async function fetchAnalytics(base: string) {
  const [dailyRes, modelRes, teamRes, logsRes] = await Promise.allSettled([
    fetch(`${base}/api/analytics?period=7d&groupBy=day`, { cache: "no-store" }),
    fetch(`${base}/api/analytics/by-model?period=7d`, { cache: "no-store" }),
    fetch(`${base}/api/analytics/by-team?period=7d`, { cache: "no-store" }),
    fetch(`${base}/api/proxy-logs?limit=500`, { cache: "no-store" }),
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

  const logs: ProxyLog[] =
    logsRes.status === "fulfilled" && logsRes.value.ok
      ? ((await logsRes.value.json()).data ?? [])
      : []

  const totalInput = byModel.reduce((s, m) => s + m.totalInput, 0)
  const totalOutput = byModel.reduce((s, m) => s + m.totalOutput, 0)
  const totalCost = byModel.reduce((s, m) => s + m.estimatedCost, 0)

  return { daily, byModel, byTeam, logs, totalInput, totalOutput, totalCost }
}

export default async function AnalyticsPage() {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
  const { daily, byModel, byTeam, logs, totalInput, totalOutput, totalCost } =
    await fetchAnalytics(base).catch(() => ({
      daily: [],
      byModel: [],
      byTeam: [],
      logs: [],
      totalInput: 0,
      totalOutput: 0,
      totalCost: 0,
    }))

  return (
    <div className="flex flex-col">
      <Topbar title="Analytics" subtitle="Token usage, costs, and request logs (last 7 days)" />

      <div className="space-y-6 p-6">
        {/* Cost summary */}
        <div className="grid gap-4 sm:grid-cols-3">
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
              <p className="text-xs text-muted-foreground">Estimated Cost (7d)</p>
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
            <CardTitle className="text-sm font-semibold">Token Usage Over Time (7d)</CardTitle>
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
    </div>
  )
}
