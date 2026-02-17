import { Topbar } from "@/components/layout/topbar"
import { StatCard } from "@/components/dashboard/stat-card"
import { ActivityFeed } from "@/components/dashboard/activity-feed"
import { QuickActions } from "@/components/dashboard/quick-actions"
import { Users, Zap, DollarSign, Activity } from "lucide-react"

interface DashboardStats {
  totalRequests: { value: number; change: number; period: string }
  avgLatencyMs: { value: number; change: number; period: string }
  activeTeams: { value: number; change: number; period: string }
  estimatedCost: { value: number; change: number; period: string }
}

async function getDashboardStats(): Promise<DashboardStats> {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
  const fallback: DashboardStats = {
    totalRequests: { value: 0, change: 0, period: "vs yesterday" },
    avgLatencyMs: { value: 0, change: 0, period: "vs last week" },
    activeTeams: { value: 0, change: 0, period: "total" },
    estimatedCost: { value: 0, change: 0, period: "vs last week" },
  }
  try {
    const res = await fetch(`${base}/api/dashboard/stats`, { cache: "no-store" })
    if (!res.ok) return fallback
    const json = await res.json()
    return json.data ?? fallback
  } catch {
    return fallback
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
