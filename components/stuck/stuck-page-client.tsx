"use client"

import { useState, useMemo, useCallback } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { useAutoRefresh } from "@/lib/hooks/use-auto-refresh"
import { StuckTaskCard } from "@/components/agent-teams/stuck-task-card"
import { UnblockDialog } from "@/components/agent-teams/unblock-dialog"
import { FilterBar } from "@/components/stuck/filter-bar"
import { CheckCircle2 } from "lucide-react"
import { toast } from "sonner"
import type { StuckTask } from "@/types"

export function StuckPageClient() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [respondTask, setRespondTask] = useState<StuckTask | null>(null)

  const blockerType = searchParams.get("type") ?? "all"
  const team = searchParams.get("team") ?? "all"
  const search = searchParams.get("q") ?? ""
  const showDismissed = searchParams.get("dismissed") === "true"

  const updateParams = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString())
      if (value === "all" || value === "") {
        params.delete(key)
      } else {
        params.set(key, value)
      }
      const qs = params.toString()
      router.replace(qs ? `/stuck?${qs}` : "/stuck", { scroll: false })
    },
    [searchParams, router]
  )

  const apiUrl = showDismissed
    ? "/api/teams/stuck?includeDismissed=true"
    : "/api/teams/stuck"

  const { data, loading, error, refetch } = useAutoRefresh<StuckTask[]>({
    url: apiUrl,
    intervalMs: 10000,
  })

  const handleDismiss = useCallback(
    async (task: StuckTask) => {
      const action = task.dismissed ? "undismiss" : "dismiss"
      try {
        const res = await fetch(
          `/api/teams/${encodeURIComponent(task.teamName)}/tasks/${encodeURIComponent(task.id)}/respond`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action }),
          }
        )
        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error ?? `HTTP ${res.status}`)
        }
        toast.success(action === "dismiss" ? "Task dismissed" : "Task restored")
        refetch()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : `Failed to ${action}`)
      }
    },
    [refetch]
  )

  const tasks = data ?? []

  const teamNames = useMemo(
    () => [...new Set(tasks.map((t) => t.teamName))].sort(),
    [tasks]
  )

  const filtered = useMemo(() => {
    let result = tasks
    if (blockerType !== "all") {
      result = result.filter((t) => t.blockerType === blockerType)
    }
    if (team !== "all") {
      result = result.filter((t) => t.teamName === team)
    }
    if (search) {
      const q = search.toLowerCase()
      result = result.filter(
        (t) =>
          t.subject.toLowerCase().includes(q) ||
          t.blockerSummary?.toLowerCase().includes(q) ||
          t.blockerDetails?.toLowerCase().includes(q) ||
          t.teamName.toLowerCase().includes(q)
      )
    }
    return result
  }, [tasks, blockerType, team, search])

  if (loading && !data) {
    return (
      <p className="text-xs text-muted-foreground py-8 text-center">
        Loading stuck tasks...
      </p>
    )
  }

  if (error && !data) {
    return (
      <p className="text-xs text-red-400 py-8 text-center">
        Failed to load: {error}
      </p>
    )
  }

  return (
    <div className="space-y-4">
      <FilterBar
        blockerType={blockerType}
        team={team}
        search={search}
        teamNames={teamNames}
        showDismissed={showDismissed}
        onBlockerTypeChange={(v) => updateParams("type", v)}
        onTeamChange={(v) => updateParams("team", v)}
        onSearchChange={(v) => updateParams("q", v)}
        onShowDismissedChange={(v) => updateParams("dismissed", v ? "true" : "")}
      />

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-12 text-center">
          <CheckCircle2 className="h-8 w-8 text-emerald-400" />
          <p className="text-sm text-muted-foreground">
            {tasks.length === 0
              ? "No stuck teams — everything is running smoothly"
              : "No blockers match your filters"}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((task) => (
            <StuckTaskCard
              key={`${task.teamName}-${task.id}`}
              task={task}
              showTeamName
              onRespond={setRespondTask}
              onDismiss={handleDismiss}
            />
          ))}
        </div>
      )}

      <UnblockDialog
        task={respondTask}
        open={!!respondTask}
        onOpenChange={(open) => {
          if (!open) setRespondTask(null)
        }}
      />
    </div>
  )
}
