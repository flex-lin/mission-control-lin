export const dynamic = "force-dynamic"

import { Topbar } from "@/components/layout/topbar"
import { IngestButton } from "@/components/analytics/ingest-button"
import { AnalyticsDashboard } from "@/components/analytics/analytics-dashboard"
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

async function fetchAnalytics(base: string) {
  const [dailyRes, modelRes, teamRes, memberRes, logsRes] = await Promise.allSettled([
    fetch(`${base}/api/analytics?period=7d&groupBy=day`, { cache: "no-store" }),
    fetch(`${base}/api/analytics/by-model?period=7d`, { cache: "no-store" }),
    fetch(`${base}/api/analytics/by-team?period=7d`, { cache: "no-store" }),
    fetch(`${base}/api/analytics/by-member?period=7d`, { cache: "no-store" }),
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

export default async function AnalyticsPage() {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
  const initialData = await fetchAnalytics(base).catch(() => ({
    daily: [],
    byModel: [],
    byTeam: [],
    byMember: [],
    logs: [],
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
