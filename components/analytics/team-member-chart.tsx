"use client"

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts"

const TOOLTIP_STYLE = {
  contentStyle: {
    backgroundColor: "hsl(222.2 47.4% 6%)",
    border: "1px solid hsl(216 34% 17%)",
    borderRadius: "6px",
    fontSize: 12,
  },
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

interface TeamMemberChartProps {
  data: MemberEntry[]
}

export function TeamMemberChart({ data }: TeamMemberChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center text-xs text-muted-foreground">
        No per-member data yet. Enable the proxy with x-claude-member headers, or ingest session logs.
      </div>
    )
  }

  const chartData = data
    .sort((a, b) => b.totalTokens - a.totalTokens)
    .slice(0, 10)
    .map((d) => ({
      name: d.memberName,
      input: d.totalInput,
      output: d.totalOutput,
      cost: d.estimatedCost,
    }))

  return (
    <ResponsiveContainer width="100%" height={280}>
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
          formatter={(v, name) => [
            `${Number(v).toLocaleString()} tokens`,
            name === "input" ? "Input" : "Output",
          ]}
        />
        <Legend wrapperStyle={{ fontSize: 12, color: "hsl(215.4 16.3% 56.9%)" }} />
        <Bar dataKey="input" name="Input tokens" fill="#60a5fa" stackId="a" radius={[0, 0, 0, 0]} />
        <Bar dataKey="output" name="Output tokens" fill="#34d399" stackId="a" radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}
