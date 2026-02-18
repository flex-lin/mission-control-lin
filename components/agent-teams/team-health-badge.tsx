"use client"

import { Badge } from "@/components/ui/badge"
import type { TeamHealthStatus } from "@/types"

interface TeamHealthBadgeProps {
  status: TeamHealthStatus
  staleTaskCount?: number
  stuckCount?: number
}

const statusConfig = {
  alive: {
    dotClass: "bg-emerald-400 animate-pulse",
    label: "Alive",
  },
  asleep: {
    dotClass: "bg-amber-400",
    label: "Asleep",
  },
  exited: {
    dotClass: "bg-gray-400",
    label: "Exited",
  },
} as const

export function TeamHealthBadge({ status, staleTaskCount, stuckCount }: TeamHealthBadgeProps) {
  const config = statusConfig[status]

  return (
    <span className="inline-flex items-center gap-2">
      <span className="inline-flex items-center gap-1.5">
        <span className={`h-2 w-2 rounded-full ${config.dotClass}`} />
        <span className="text-xs text-muted-foreground">{config.label}</span>
      </span>
      {stuckCount != null && stuckCount > 0 && (
        <Badge variant="destructive" className="h-4 min-w-4 px-1 text-[10px]">
          {stuckCount} stuck
        </Badge>
      )}
      {staleTaskCount != null && staleTaskCount > 0 && !stuckCount && (
        <Badge variant="destructive" className="h-4 min-w-4 px-1 text-[10px]">
          {staleTaskCount}
        </Badge>
      )}
    </span>
  )
}
