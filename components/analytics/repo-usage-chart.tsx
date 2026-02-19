"use client"

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts"
import type { RepoEntry } from "@/types"

const TOOLTIP_STYLE = {
  contentStyle: {
    backgroundColor: "hsl(var(--chart-tooltip-bg))",
    border: "1px solid hsl(var(--chart-tooltip-border))",
    borderRadius: "6px",
    fontSize: 12,
  },
}

interface RepoUsageChartProps {
  data: RepoEntry[]
}

export function RepoUsageChart({ data }: RepoUsageChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center text-xs text-muted-foreground">
        No repo data yet
      </div>
    )
  }

  const chartData = data
    .sort((a, b) => b.estimatedCost - a.estimatedCost)
    .slice(0, 12)
    .map((d) => ({
      name: d.repoName,
      cost: parseFloat(d.estimatedCost.toFixed(4)),
      tokens: d.totalTokens,
      requests: d.requests,
    }))

  const barHeight = 28
  const chartHeight = Math.max(220, chartData.length * barHeight + 50)

  return (
    <ResponsiveContainer width="100%" height={chartHeight}>
      <BarChart
        data={chartData}
        layout="vertical"
        margin={{ top: 5, right: 30, left: 0, bottom: 5 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--chart-grid))" horizontal={false} />
        <XAxis
          type="number"
          tick={{ fill: "hsl(var(--chart-tick))", fontSize: 10 }}
          tickFormatter={(v: number) => `$${v.toFixed(2)}`}
        />
        <YAxis
          type="category"
          dataKey="name"
          width={110}
          tick={{ fill: "hsl(var(--chart-tick))", fontSize: 10 }}
        />
        <Tooltip
          {...TOOLTIP_STYLE}
          content={({ active, payload, label }) => {
            if (!active || !payload?.length) return null
            const d = payload[0].payload as { cost: number; tokens: number; requests: number }
            return (
              <div style={TOOLTIP_STYLE.contentStyle} className="px-3 py-2">
                <p className="text-xs font-medium">{label}</p>
                <p className="text-xs text-emerald-400">${d.cost.toFixed(4)}</p>
                <p className="text-xs text-blue-400">{d.tokens.toLocaleString()} tokens</p>
                <p className="text-xs text-muted-foreground">{d.requests.toLocaleString()} requests</p>
              </div>
            )
          }}
        />
        <Bar dataKey="cost" fill="#34d399" radius={[0, 3, 3, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}
