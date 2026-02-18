"use client"

import { useState } from "react"
import { useAutoRefresh } from "@/lib/hooks/use-auto-refresh"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { AlertTriangle } from "lucide-react"
import Link from "next/link"
import { UnblockDialog } from "@/components/agent-teams/unblock-dialog"
import type { StuckTask } from "@/types"

export function StuckTeamsSummary() {
  const [respondTask, setRespondTask] = useState<StuckTask | null>(null)

  const { data, loading } = useAutoRefresh<StuckTask[]>({
    url: "/api/teams/stuck",
    intervalMs: 15000,
  })

  const tasks = data ?? []
  const stuckTeams = new Set(tasks.map((t) => t.teamName)).size
  const totalBlockers = tasks.length

  if (loading && !data) {
    return (
      <Card>
        <CardContent className="py-6 text-center">
          <p className="text-xs text-muted-foreground">Loading...</p>
        </CardContent>
      </Card>
    )
  }

  if (totalBlockers === 0) return null

  return (
    <>
      <Card className="border-amber-500/30">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <AlertTriangle className="h-4 w-4 text-amber-400" />
            Stuck Teams
            <Badge variant="destructive" className="ml-auto text-[10px] h-4 px-1.5">
              {totalBlockers}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-xs text-muted-foreground">
            {stuckTeams} team{stuckTeams !== 1 ? "s" : ""} with {totalBlockers} blocker{totalBlockers !== 1 ? "s" : ""}
          </p>
          <div className="space-y-1.5">
            {tasks.slice(0, 3).map((task) => (
              <button
                key={`${task.teamName}-${task.id}`}
                onClick={() => setRespondTask(task)}
                className="flex items-start gap-2 text-xs w-full text-left rounded px-1.5 py-1 -mx-1.5 hover:bg-muted/50 transition-colors cursor-pointer"
              >
                <Badge variant="outline" className="text-[10px] h-4 px-1 shrink-0">
                  {task.teamName}
                </Badge>
                <span className="text-muted-foreground truncate">
                  {task.blockerSummary ?? task.subject}
                </span>
              </button>
            ))}
          </div>
          <Link
            href="/stuck"
            className="text-[10px] text-muted-foreground hover:text-foreground underline"
          >
            View all {totalBlockers} blockers
          </Link>
        </CardContent>
      </Card>
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
