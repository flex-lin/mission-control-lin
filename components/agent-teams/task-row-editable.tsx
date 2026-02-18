"use client"

import { useState, useRef, useEffect } from "react"
import { toast } from "sonner"
import { TableCell, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  ArrowUp,
  ArrowDown,
  Pencil,
  Check,
  X,
  Flag,
} from "lucide-react"
import type { TeamTask, TaskPriority } from "@/types"

const PRIORITY_CONFIG: Record<TaskPriority, { label: string; color: string; badgeClass: string }> = {
  low: { label: "Low", color: "text-slate-400", badgeClass: "bg-slate-500/20 text-slate-400 border-slate-500/30" },
  medium: { label: "Med", color: "text-blue-400", badgeClass: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
  high: { label: "High", color: "text-orange-400", badgeClass: "bg-orange-500/20 text-orange-400 border-orange-500/30" },
  urgent: { label: "Urgent", color: "text-red-400", badgeClass: "bg-red-500/20 text-red-400 border-red-500/30" },
}

function statusBadgeVariant(status: TeamTask["status"]) {
  switch (status) {
    case "completed": return "success" as const
    case "in_progress": return "default" as const
    case "pending": return "warning" as const
    case "deleted": return "outline" as const
  }
}

interface TaskRowEditableProps {
  task: TeamTask
  teamName: string
  isFirst: boolean
  isLast: boolean
  canReorder: boolean
  pendingTaskIds: string[]
  onUpdated: () => void
}

export function TaskRowEditable({
  task,
  teamName,
  isFirst,
  isLast,
  canReorder,
  pendingTaskIds,
  onUpdated,
}: TaskRowEditableProps) {
  const [editing, setEditing] = useState(false)
  const [editSubject, setEditSubject] = useState(task.subject)
  const [editDescription, setEditDescription] = useState(task.description ?? "")
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
    }
  }, [editing])

  async function patchTask(body: Partial<TeamTask>) {
    const res = await fetch(
      `/api/teams/${encodeURIComponent(teamName)}/tasks/${encodeURIComponent(task.id)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    )
    if (!res.ok) {
      const json = await res.json()
      throw new Error(json.error ?? "Failed to update task")
    }
    return res.json()
  }

  async function handleSaveEdit() {
    if (!editSubject.trim()) return
    setSaving(true)
    try {
      await patchTask({
        subject: editSubject.trim(),
        description: editDescription.trim() || undefined,
      })
      setEditing(false)
      onUpdated()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save")
    } finally {
      setSaving(false)
    }
  }

  async function handleSetPriority(priority: TaskPriority) {
    try {
      await patchTask({ priority })
      onUpdated()
      toast.success(`Priority set to ${priority}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to set priority")
    }
  }

  async function handleMove(direction: "up" | "down") {
    try {
      const idx = pendingTaskIds.indexOf(task.id)
      if (idx === -1) return
      const swapIdx = direction === "up" ? idx - 1 : idx + 1
      if (swapIdx < 0 || swapIdx >= pendingTaskIds.length) return

      const newOrder = [...pendingTaskIds]
      ;[newOrder[idx], newOrder[swapIdx]] = [newOrder[swapIdx], newOrder[idx]]

      const res = await fetch(
        `/api/teams/${encodeURIComponent(teamName)}/tasks/reorder`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ taskIds: newOrder }),
        }
      )
      if (!res.ok) {
        const json = await res.json()
        throw new Error(json.error ?? "Failed to reorder")
      }
      onUpdated()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to reorder")
    }
  }

  function handleCancelEdit() {
    setEditSubject(task.subject)
    setEditDescription(task.description ?? "")
    setEditing(false)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault()
      handleSaveEdit()
    } else if (e.key === "Escape") {
      handleCancelEdit()
    }
  }

  const priorityConfig = task.priority ? PRIORITY_CONFIG[task.priority] : null
  const isPending = task.status === "pending"

  return (
    <TableRow>
      <TableCell className="w-10 text-muted-foreground">{task.id}</TableCell>
      <TableCell className="max-w-xs">
        {editing ? (
          <div className="space-y-1.5">
            <Input
              ref={inputRef}
              value={editSubject}
              onChange={(e) => setEditSubject(e.target.value)}
              onKeyDown={handleKeyDown}
              className="h-7 text-sm"
              placeholder="Task subject"
            />
            <Input
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              onKeyDown={handleKeyDown}
              className="h-7 text-xs"
              placeholder="Description (optional)"
            />
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 gap-1 px-1.5 text-[10px]"
                onClick={handleSaveEdit}
                disabled={saving || !editSubject.trim()}
              >
                <Check className="h-3 w-3" />
                Save
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 gap-1 px-1.5 text-[10px]"
                onClick={handleCancelEdit}
              >
                <X className="h-3 w-3" />
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="group flex items-start gap-1.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">{task.subject}</p>
              {task.description && (
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {task.description}
                </p>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-5 w-5 shrink-0 p-0 opacity-0 group-hover:opacity-100"
              onClick={() => setEditing(true)}
            >
              <Pencil className="h-3 w-3" />
            </Button>
          </div>
        )}
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-1.5">
          <Badge variant={statusBadgeVariant(task.status)} className="text-[10px]">
            {task.status.replace("_", " ")}
          </Badge>
          {priorityConfig && (
            <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium ${priorityConfig.badgeClass}`}>
              {priorityConfig.label}
            </span>
          )}
        </div>
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {task.owner ?? "\u2014"}
      </TableCell>
      <TableCell className="w-20">
        <div className="flex items-center gap-0.5">
          {/* Priority selector */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                title="Set priority"
              >
                <Flag className={`h-3 w-3 ${priorityConfig?.color ?? "text-muted-foreground"}`} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-28">
              {(Object.entries(PRIORITY_CONFIG) as [TaskPriority, typeof PRIORITY_CONFIG[TaskPriority]][]).map(
                ([key, config]) => (
                  <DropdownMenuItem
                    key={key}
                    onClick={() => handleSetPriority(key)}
                    className="text-xs"
                  >
                    <Flag className={`mr-2 h-3 w-3 ${config.color}`} />
                    {config.label}
                  </DropdownMenuItem>
                )
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Reorder buttons — only for pending tasks */}
          {canReorder && isPending && (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                disabled={isFirst}
                onClick={() => handleMove("up")}
                title="Move up"
              >
                <ArrowUp className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                disabled={isLast}
                onClick={() => handleMove("down")}
                title="Move down"
              >
                <ArrowDown className="h-3 w-3" />
              </Button>
            </>
          )}
        </div>
      </TableCell>
    </TableRow>
  )
}
