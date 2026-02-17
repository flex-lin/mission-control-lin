"use client"

import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts"

const COLORS = ["#60a5fa", "#34d399", "#f59e0b", "#f87171", "#a78bfa", "#fb923c"]

const TOOLTIP_STYLE = {
  contentStyle: {
    backgroundColor: "hsl(222.2 47.4% 6%)",
    border: "1px solid hsl(216 34% 17%)",
    borderRadius: "6px",
    fontSize: 12,
  },
}

// ── Model Pie Chart ────────────────────────────────────────────────────────────

interface ModelEntry {
  model: string
  totalTokens: number
  estimatedCost: number
}

interface ModelPieChartProps {
  data: ModelEntry[]
}

export function ModelPieChart({ data }: ModelPieChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center text-xs text-muted-foreground">
        No model data yet
      </div>
    )
  }

  const chartData = data.map((d) => ({
    name: d.model.replace("claude-", "").replace("-4-6", " 4.6").replace("-4-5-20251001", " 4.5"),
    value: d.totalTokens,
    cost: d.estimatedCost,
  }))

  return (
    <ResponsiveContainer width="100%" height={220}>
      <PieChart>
        <Pie
          data={chartData}
          cx="50%"
          cy="50%"
          innerRadius={50}
          outerRadius={80}
          dataKey="value"
          label={({ name, percent }: { name?: string; percent?: number }) =>
            `${name ?? ""} ${((percent ?? 0) * 100).toFixed(0)}%`
          }
          labelLine={false}
        >
          {chartData.map((_, i) => (
            <Cell key={i} fill={COLORS[i % COLORS.length]} />
          ))}
        </Pie>
        <Tooltip
          {...TOOLTIP_STYLE}
          formatter={(value, name) => [
            `${Number(value).toLocaleString()} tokens`,
            String(name),
          ]}
        />
      </PieChart>
    </ResponsiveContainer>
  )
}

// ── Team Bar Chart ─────────────────────────────────────────────────────────────

interface TeamEntry {
  teamName: string
  totalTokens: number
  requests: number
}

interface TeamBarChartProps {
  data: TeamEntry[]
}

export function TeamBarChart({ data }: TeamBarChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center text-xs text-muted-foreground">
        No team data yet
      </div>
    )
  }

  const chartData = data
    .sort((a, b) => b.totalTokens - a.totalTokens)
    .slice(0, 8)
    .map((d) => ({ name: d.teamName, tokens: d.totalTokens }))

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 30 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(216 34% 17%)" />
        <XAxis
          dataKey="name"
          tick={{ fill: "hsl(215.4 16.3% 56.9%)", fontSize: 10 }}
          angle={-30}
          textAnchor="end"
        />
        <YAxis
          tick={{ fill: "hsl(215.4 16.3% 56.9%)", fontSize: 10 }}
          tickFormatter={(v: number) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v))}
        />
        <Tooltip
          {...TOOLTIP_STYLE}
          formatter={(v) => [`${Number(v).toLocaleString()} tokens`, "Tokens"]}
        />
        <Bar dataKey="tokens" fill="#60a5fa" radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}
