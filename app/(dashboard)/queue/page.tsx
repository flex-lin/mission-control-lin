"use client"

import { useState } from "react"
import { Topbar } from "@/components/layout/topbar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useAutoRefresh } from "@/lib/hooks/use-auto-refresh"
import {
  ListOrdered,
  Plus,
  RotateCcw,
  Trash2,
  XCircle,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Clock,
  Play,
} from "lucide-react"
import type { QueuedTask, QueuedTaskStatus } from "@/types"

interface QueueStatus {
  workerRunning: boolean
  lastHeartbeat: string | null
  queueDepth: number
  counts: { pending: number; running: number; completed: number; failed: number }
  currentTask: { id: number; goal: string; teamName: string | null; startedAt: string | null } | null
}

const statusConfig: Record<QueuedTaskStatus, { icon: React.ElementType; variant: "default" | "secondary" | "destructive" | "outline" | "success" | "warning"; label: string }> = {
  pending: { icon: Clock, variant: "secondary", label: "Pending" },
  running: { icon: Play, variant: "default", label: "Running" },
  completed: { icon: CheckCircle2, variant: "success", label: "Completed" },
  failed: { icon: AlertCircle, variant: "destructive", label: "Failed" },
  cancelled: { icon: XCircle, variant: "outline", label: "Cancelled" },
}

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export default function QueuePage() {
  const [goal, setGoal] = useState("")
  const [projectPath, setProjectPath] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const { data: tasks, refetch } = useAutoRefresh<QueuedTask[]>({
    url: "/api/queue",
    intervalMs: 5000,
  })

  const { data: status } = useAutoRefresh<QueueStatus>({
    url: "/api/queue/status",
    intervalMs: 10000,
  })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!goal.trim()) return

    setSubmitting(true)
    setSubmitError(null)

    try {
      const res = await fetch("/api/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal: goal.trim(), ...(projectPath.trim() && { projectPath: projectPath.trim() }) }),
      })
      if (!res.ok) {
        const json = await res.json()
        throw new Error(json.error ?? `HTTP ${res.status}`)
      }
      setGoal("")
      setProjectPath("")
      await refetch()
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to submit")
    } finally {
      setSubmitting(false)
    }
  }

  async function handleCancel(id: number) {
    try {
      const res = await fetch(`/api/queue/${id}`, { method: "DELETE" })
      if (!res.ok) {
        const json = await res.json()
        setSubmitError(json.error ?? `Cancel failed: HTTP ${res.status}`)
      }
    } catch {
      setSubmitError("Failed to cancel task")
    }
    await refetch()
  }

  async function handleRetry(id: number) {
    try {
      const res = await fetch(`/api/queue/${id}`, { method: "POST" })
      if (!res.ok) {
        const json = await res.json()
        setSubmitError(json.error ?? `Retry failed: HTTP ${res.status}`)
      }
    } catch {
      setSubmitError("Failed to retry task")
    }
    await refetch()
  }

  async function handleRemove(id: number) {
    try {
      const res = await fetch(`/api/queue/${id}`, { method: "DELETE" })
      if (!res.ok) {
        const json = await res.json()
        setSubmitError(json.error ?? `Remove failed: HTTP ${res.status}`)
      }
    } catch {
      setSubmitError("Failed to remove task")
    }
    await refetch()
  }

  return (
    <div className="flex flex-col">
      <Topbar title="Task Queue" subtitle="Submit tasks for automated execution" />

      <div className="p-6 space-y-6">
        {/* Worker Status */}
        <div className="flex items-center gap-4 rounded-lg border p-4">
          <div className={`h-3 w-3 rounded-full ${status?.workerRunning ? "bg-emerald-500 animate-pulse" : "bg-red-500"}`} />
          <div className="flex-1">
            <p className="text-sm font-medium">
              Queue Worker: {status?.workerRunning ? "Running" : "Stopped"}
            </p>
            {status?.currentTask && (
              <p className="text-xs text-muted-foreground mt-0.5">
                Currently executing: &ldquo;{status.currentTask.goal}&rdquo;
                {status.currentTask.teamName && ` (team: ${status.currentTask.teamName})`}
              </p>
            )}
          </div>
          <div className="flex gap-3 text-xs text-muted-foreground">
            <span>{status?.counts.pending ?? 0} pending</span>
            <span>{status?.counts.running ?? 0} running</span>
            <span>{status?.counts.completed ?? 0} completed</span>
          </div>
        </div>

        {/* Submit Form */}
        <form onSubmit={handleSubmit} className="rounded-lg border p-4 space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <Plus className="h-4 w-4" />
            <h2 className="text-sm font-semibold">Submit New Task</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="goal">Goal</Label>
              <Input
                id="goal"
                placeholder="e.g. Add dark mode toggle to settings page"
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                disabled={submitting}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="projectPath">Project Path <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Input
                id="projectPath"
                placeholder="defaults to current project"
                value={projectPath}
                onChange={(e) => setProjectPath(e.target.value)}
                disabled={submitting}
              />
            </div>
          </div>
          {submitError && (
            <p className="text-sm text-destructive">{submitError}</p>
          )}
          <Button type="submit" size="sm" disabled={submitting || !goal.trim()}>
            {submitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ListOrdered className="h-4 w-4 mr-2" />}
            Add to Queue
          </Button>
        </form>

        {/* Task List */}
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead>Goal</TableHead>
                <TableHead>Project</TableHead>
                <TableHead className="w-28">Status</TableHead>
                <TableHead className="w-32">Created</TableHead>
                <TableHead className="w-40">Result</TableHead>
                <TableHead className="w-24">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(!tasks || tasks.length === 0) ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    No tasks in queue. Submit one above.
                  </TableCell>
                </TableRow>
              ) : (
                tasks.map((task) => {
                  const config = statusConfig[task.status as QueuedTaskStatus] ?? statusConfig.pending
                  const Icon = config.icon
                  return (
                    <TableRow key={task.id}>
                      <TableCell className="font-mono text-xs">{task.id}</TableCell>
                      <TableCell className="max-w-xs truncate text-sm">{task.goal}</TableCell>
                      <TableCell className="max-w-[200px] truncate text-xs text-muted-foreground font-mono">
                        {task.projectPath}
                      </TableCell>
                      <TableCell>
                        <Badge variant={config.variant} className="gap-1">
                          <Icon className="h-3 w-3" />
                          {config.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatRelativeTime(task.createdAt)}
                      </TableCell>
                      <TableCell className="max-w-[160px] truncate text-xs text-muted-foreground">
                        {task.result ?? "—"}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {(task.status === "pending" || task.status === "running") && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => handleCancel(task.id)}
                              title="Cancel"
                            >
                              <XCircle className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          {(task.status === "failed" || task.status === "cancelled") && (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => handleRetry(task.id)}
                                title="Retry"
                              >
                                <RotateCcw className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => handleRemove(task.id)}
                                title="Remove"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </>
                          )}
                          {task.status === "completed" && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => handleRemove(task.id)}
                              title="Remove"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  )
}
