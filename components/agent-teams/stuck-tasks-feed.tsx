"use client"

import { useState } from "react"
import { useAutoRefresh } from "@/lib/hooks/use-auto-refresh"
import { StuckTaskCard } from "@/components/agent-teams/stuck-task-card"
import { UnblockDialog } from "@/components/agent-teams/unblock-dialog"
import type { StuckTask } from "@/types"

interface StuckTasksFeedProps {
  teamName?: string
  limit?: number
  showTeamName?: boolean
}

export function StuckTasksFeed({ teamName, limit, showTeamName }: StuckTasksFeedProps) {
  const [respondTask, setRespondTask] = useState<StuckTask | null>(null)

  const url = teamName
    ? `/api/teams/stuck?team=${encodeURIComponent(teamName)}`
    : "/api/teams/stuck"

  const { data, loading, error } = useAutoRefresh<StuckTask[]>({
    url,
    intervalMs: 10000,
  })

  if (loading && !data) {
    return (
      <p className="text-xs text-muted-foreground py-4 text-center">
        Loading stuck tasks...
      </p>
    )
  }

  if (error && !data) {
    return (
      <p className="text-xs text-red-400 py-4 text-center">
        Failed to load: {error}
      </p>
    )
  }

  const tasks = limit ? (data ?? []).slice(0, limit) : (data ?? [])

  if (tasks.length === 0) {
    return (
      <p className="text-xs text-muted-foreground py-4 text-center">
        No stuck tasks
      </p>
    )
  }

  return (
    <>
      <div className="space-y-2">
        {tasks.map((task) => (
          <StuckTaskCard
            key={`${task.teamName}-${task.id}`}
            task={task}
            showTeamName={showTeamName ?? !teamName}
            onRespond={setRespondTask}
          />
        ))}
      </div>
      <UnblockDialog
        task={respondTask}
        open={!!respondTask}
        onOpenChange={(open) => {
          if (!open) setRespondTask(null)
        }}
      />
    </>
  )
}
