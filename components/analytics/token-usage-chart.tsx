"use client"

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts"
import { format } from "date-fns"
import type { DailyEntry } from "@/types"

interface TokenUsageChartProps {
  data: DailyEntry[]
}

export function TokenUsageChart({ data }: TokenUsageChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-xs text-muted-foreground">
        No token usage data yet
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(216 34% 17%)" />
        <XAxis
          dataKey="date"
          tick={{ fill: "hsl(215.4 16.3% 56.9%)", fontSize: 11 }}
          tickFormatter={(v: string) => {
            try { return format(new Date(v + "T00:00:00"), "MMM d") } catch { return v }
          }}
        />
        <YAxis
          tick={{ fill: "hsl(215.4 16.3% 56.9%)", fontSize: 11 }}
          tickFormatter={(v: number) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v))}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: "hsl(222.2 47.4% 6%)",
            border: "1px solid hsl(216 34% 17%)",
            borderRadius: "6px",
            fontSize: 12,
          }}
          labelStyle={{ color: "hsl(213 31% 91%)" }}
          labelFormatter={(v) => {
            const s = String(v)
            try { return format(new Date(s + "T00:00:00"), "MMM d, yyyy") } catch { return s }
          }}
        />
        <Legend wrapperStyle={{ fontSize: 12, color: "hsl(215.4 16.3% 56.9%)" }} />
        <Line
          type="monotone"
          dataKey="totalInput"
          name="Input tokens"
          stroke="#60a5fa"
          strokeWidth={2}
          dot={false}
        />
        <Line
          type="monotone"
          dataKey="totalOutput"
          name="Output tokens"
          stroke="#34d399"
          strokeWidth={2}
          dot={false}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
