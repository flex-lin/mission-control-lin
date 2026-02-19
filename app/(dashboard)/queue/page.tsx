"use client"

import { useState, useRef, useCallback, useEffect } from "react"
import Link from "next/link"
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
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
  Flag,
  Pencil,
  Check,
  X,
  ChevronUp,
  ChevronDown,
  ChevronRight,
  Users,
  Upload,
  ImageIcon,
  FileText,
  Paperclip,
  TriangleAlert,
} from "lucide-react"
import type { QueuedTask, QueuedTaskStatus, TeamHealthStatus, TaskAttachment } from "@/types"
import { ALLOWED_UPLOAD_TYPES, MAX_FILE_SIZE, MAX_FILES_PER_TASK } from "@/types"

interface TeamHealthInfo {
  status: TeamHealthStatus
  taskStats?: { total: number; completed: number; pending: number; inProgress: number }
}

interface QueueStatus {
  workerRunning: boolean
  lastHeartbeat: string | null
  queueDepth: number
  counts: { pending: number; running: number; completed: number; failed: number }
  currentTask: { id: number; goal: string; teamName: string | null; startedAt: string | null } | null
}

interface WorkerInfo {
  sessionAlive: boolean
  heartbeatFresh: boolean
  lastHeartbeat: string | null
  sessionName: string
  attachCmd: string
}

const statusConfig: Record<QueuedTaskStatus, { icon: React.ElementType; variant: "default" | "secondary" | "destructive" | "outline" | "success" | "warning"; label: string }> = {
  pending: { icon: Clock, variant: "secondary", label: "Pending" },
  running: { icon: Play, variant: "default", label: "Running" },
  completed: { icon: CheckCircle2, variant: "success", label: "Completed" },
  failed: { icon: AlertCircle, variant: "destructive", label: "Failed" },
  cancelled: { icon: XCircle, variant: "outline", label: "Cancelled" },
}

const priorityConfig: Record<number, { label: string; color: string }> = {
  0: { label: "None", color: "" },
  1: { label: "Low", color: "text-blue-500" },
  2: { label: "Med", color: "text-yellow-500" },
  3: { label: "High", color: "text-red-500" },
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

function AttachmentIndicator({ attachments, taskId, activePopover, setActivePopover }: {
  attachments: TaskAttachment[]
  taskId: number
  activePopover: number | null
  setActivePopover: (id: number | null) => void
}) {
  if (attachments.length === 0) return null
  const isOpen = activePopover === taskId

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        className="inline-flex items-center gap-0.5 text-muted-foreground hover:text-foreground transition-colors"
        onClick={(e) => {
          e.stopPropagation()
          setActivePopover(isOpen ? null : taskId)
        }}
      >
        <Paperclip className="h-3 w-3" />
        <span className="text-[10px] font-medium">{attachments.length}</span>
      </button>
      {isOpen && (
        <>
          {/* Backdrop to close on outside click */}
          <div className="fixed inset-0 z-40" onClick={() => setActivePopover(null)} />
          <div className="absolute left-0 top-full mt-1 z-50 w-64 rounded-lg border bg-popover p-2 shadow-md">
            <div className="space-y-1.5">
              {attachments.map((att, i) => {
                const isImage = att.mimeType.startsWith("image/")
                return (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    {isImage ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={`/uploads/tasks/${taskId}/${att.filename}`}
                        alt={att.originalName}
                        className="h-8 w-8 rounded object-cover shrink-0"
                      />
                    ) : (
                      <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                    )}
                    <div className="flex flex-col min-w-0">
                      <span className="truncate font-medium">{att.originalName}</span>
                      <span className="text-muted-foreground">{formatFileSize(att.size)}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function QueuePage() {
  const [goal, setGoal] = useState("")
  const [projectPath, setProjectPath] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editGoal, setEditGoal] = useState("")
  const [completedOpen, setCompletedOpen] = useState<boolean | null>(null)
  const [files, setFiles] = useState<File[]>([])
  const [fileError, setFileError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [cancellingIds, setCancellingIds] = useState<Set<number>>(new Set())
  const [workerActionLoading, setWorkerActionLoading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const uploadAbortRef = useRef<AbortController | null>(null)
  const [attachmentPopover, setAttachmentPopover] = useState<number | null>(null)

  // Stable blob URLs for file previews — avoids creating new URLs on every render
  const blobUrlsRef = useRef<Map<File, string>>(new Map())

  const getBlobUrl = useCallback((file: File): string => {
    const existing = blobUrlsRef.current.get(file)
    if (existing) return existing
    const url = URL.createObjectURL(file)
    blobUrlsRef.current.set(file, url)
    return url
  }, [])

  // Revoke blob URLs when files are removed or component unmounts
  useEffect(() => {
    const currentFiles = new Set(files)
    const urlMap = blobUrlsRef.current
    for (const [file, url] of urlMap) {
      if (!currentFiles.has(file)) {
        URL.revokeObjectURL(url)
        urlMap.delete(file)
      }
    }
  }, [files])

  useEffect(() => {
    return () => {
      for (const url of blobUrlsRef.current.values()) {
        URL.revokeObjectURL(url)
      }
      blobUrlsRef.current.clear()
    }
  }, [])

  const { data: tasks, refetch } = useAutoRefresh<QueuedTask[]>({
    url: "/api/queue",
    intervalMs: 5000,
  })

  const { data: status } = useAutoRefresh<QueueStatus>({
    url: "/api/queue/status",
    intervalMs: 10000,
  })

  const { data: workerInfo, refetch: refetchWorker } = useAutoRefresh<WorkerInfo>({
    url: "/api/queue/worker",
    intervalMs: 10000,
  })

  // Fetch health for all teams that have associated tasks
  const { data: teamsData } = useAutoRefresh<Array<{ name: string; health?: { status: TeamHealthStatus }; taskStats?: { total: number; completed: number; pending: number; inProgress: number } }>>({
    url: "/api/teams",
    intervalMs: 15000,
  })

  const teamHealthMap = new Map<string, TeamHealthInfo>()
  if (teamsData) {
    for (const t of teamsData) {
      if (t.health) {
        teamHealthMap.set(t.name, { status: t.health.status, taskStats: t.taskStats })
      }
    }
  }

  const activeTasks = tasks?.filter((t) => t.status === "pending" || t.status === "running") ?? []
  const completedTasks = tasks?.filter((t) => ["completed", "failed", "cancelled"].includes(t.status))
    .sort((a, b) => {
      const aTime = a.completedAt ?? a.createdAt
      const bTime = b.completedAt ?? b.createdAt
      return new Date(bTime).getTime() - new Date(aTime).getTime()
    }) ?? []

  // Default: collapsed if >10 completed tasks, expanded otherwise
  const isCompletedOpen = completedOpen ?? completedTasks.length <= 10

  function parseAttachments(task: QueuedTask): TaskAttachment[] {
    if (!task.attachments) return []
    if (Array.isArray(task.attachments)) return task.attachments
    try {
      return JSON.parse(task.attachments as unknown as string)
    } catch {
      return []
    }
  }

  const validateAndAddFiles = useCallback((incoming: File[]) => {
    setFileError(null)
    for (const f of incoming) {
      if (!ALLOWED_UPLOAD_TYPES.includes(f.type as (typeof ALLOWED_UPLOAD_TYPES)[number])) {
        setFileError(`"${f.name}" has unsupported type. Accepted: images, PDF, text`)
        return
      }
      if (f.size > MAX_FILE_SIZE) {
        setFileError(`"${f.name}" exceeds 10MB limit`)
        return
      }
    }
    setFiles((prev) => {
      if (prev.length + incoming.length > MAX_FILES_PER_TASK) {
        setFileError(`Max ${MAX_FILES_PER_TASK} files allowed`)
        return prev
      }
      return [...prev, ...incoming]
    })
  }, [])

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index))
    setFileError(null)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const dropped = Array.from(e.dataTransfer.files)
    if (dropped.length > 0) validateAndAddFiles(dropped)
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(e.target.files ?? [])
    if (selected.length > 0) validateAndAddFiles(selected)
    e.target.value = ""
  }

  async function uploadFiles(taskId: number) {
    if (files.length === 0) return
    setUploading(true)
    const controller = new AbortController()
    uploadAbortRef.current = controller
    try {
      const formData = new FormData()
      for (const f of files) formData.append("files", f)
      const res = await fetch(`/api/queue/upload?taskId=${taskId}`, {
        method: "POST",
        body: formData,
        signal: controller.signal,
      })
      if (!res.ok) {
        const json = await res.json()
        throw new Error(json.error ?? `Upload failed: HTTP ${res.status}`)
      }
    } finally {
      uploadAbortRef.current = null
      setUploading(false)
    }
  }

  function cancelUpload() {
    uploadAbortRef.current?.abort()
  }

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
      const created = await res.json()
      const newTaskId = created.data?.id
      if (files.length > 0 && newTaskId) {
        await uploadFiles(newTaskId)
      }
      setGoal("")
      setProjectPath("")
      setFiles([])
      setFileError(null)
      await refetch()
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to submit")
    } finally {
      setSubmitting(false)
    }
  }

  async function handleCancel(id: number) {
    // Optimistic UI: mark as cancelling immediately
    setCancellingIds((prev) => new Set(prev).add(id))
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10_000)
    try {
      const res = await fetch(`/api/queue/${id}`, {
        method: "DELETE",
        signal: controller.signal,
      })
      if (!res.ok) {
        const json = await res.json()
        setSubmitError(json.error ?? `Cancel failed: HTTP ${res.status}`)
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setSubmitError("Cancel timed out — task may still be stopping")
      } else {
        setSubmitError("Failed to cancel task")
      }
    } finally {
      clearTimeout(timeout)
      setCancellingIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
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

  async function handlePatch(id: number, data: Record<string, unknown>) {
    try {
      const res = await fetch(`/api/queue/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      })
      if (!res.ok) {
        const json = await res.json()
        setSubmitError(json.error ?? `Update failed: HTTP ${res.status}`)
      }
    } catch {
      setSubmitError("Failed to update task")
    }
    await refetch()
  }

  function startEditing(task: QueuedTask) {
    setEditingId(task.id)
    setEditGoal(task.goal)
  }

  async function saveEditing() {
    if (editingId === null || !editGoal.trim()) return
    await handlePatch(editingId, { goal: editGoal.trim() })
    setEditingId(null)
    setEditGoal("")
  }

  function cancelEditing() {
    setEditingId(null)
    setEditGoal("")
  }

  async function handleStartWorker() {
    setWorkerActionLoading(true)
    try {
      await fetch("/api/queue/worker", { method: "POST" })
      await new Promise((r) => setTimeout(r, 1500))
      await refetchWorker()
    } catch {
      setSubmitError("Failed to start worker")
    } finally {
      setWorkerActionLoading(false)
    }
  }

  async function handleStopWorker() {
    setWorkerActionLoading(true)
    try {
      await fetch("/api/queue/worker", { method: "DELETE" })
      await new Promise((r) => setTimeout(r, 500))
      await refetchWorker()
    } catch {
      setSubmitError("Failed to stop worker")
    } finally {
      setWorkerActionLoading(false)
    }
  }

  async function handleReorder(task: QueuedTask, direction: "up" | "down") {
    if (!tasks) return
    const pendingTasks = tasks.filter((t) => t.status === "pending")
    const idx = pendingTasks.findIndex((t) => t.id === task.id)
    if (idx === -1) return
    const swapIdx = direction === "up" ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= pendingTasks.length) return

    const other = pendingTasks[swapIdx]
    const thisPrio = task.priority
    const otherPrio = other.priority
    if (thisPrio === otherPrio) {
      if (direction === "up") {
        await handlePatch(task.id, { priority: Math.min(thisPrio + 1, 3) })
      } else {
        await handlePatch(task.id, { priority: Math.max(thisPrio - 1, 0) })
      }
    } else {
      await Promise.all([
        fetch(`/api/queue/${task.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ priority: otherPrio }),
        }),
        fetch(`/api/queue/${other.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ priority: thisPrio }),
        }),
      ])
      await refetch()
    }
  }

  const pendingIds = activeTasks.filter((t) => t.status === "pending").map((t) => t.id)

  return (
    <div className="flex flex-col">
      <Topbar title="Task Queue" subtitle="Submit tasks for automated execution" />

      <div className="p-6 space-y-6">
        {/* Worker Status */}
        <div className="flex items-center gap-4 rounded-lg border p-4">
          <div className={`h-3 w-3 rounded-full shrink-0 ${status?.workerRunning ? "bg-emerald-500 animate-pulse" : workerInfo?.sessionAlive ? "bg-amber-400 animate-pulse" : "bg-red-500"}`} />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">
              Queue Worker:{" "}
              {status?.workerRunning
                ? "Running"
                : workerInfo?.sessionAlive
                  ? "Starting…"
                  : "Stopped"}
            </p>
            {status?.currentTask && (
              <p className="text-xs text-muted-foreground mt-0.5">
                Executing: &ldquo;{status.currentTask.goal}&rdquo;
                {status.currentTask.teamName && ` (${status.currentTask.teamName})`}
              </p>
            )}
            {!status?.workerRunning && !workerInfo?.sessionAlive && (
              <p className="text-xs text-muted-foreground mt-0.5">
                Runs in tmux session <code className="font-mono">mc-queue-worker</code> — persists across sleep
              </p>
            )}
          </div>
          <div className="flex items-center gap-3">
            <div className="flex gap-3 text-xs text-muted-foreground">
              <span>{status?.counts.pending ?? 0} pending</span>
              <span>{status?.counts.running ?? 0} running</span>
              <span>{status?.counts.completed ?? 0} completed</span>
            </div>
            {workerInfo?.sessionAlive ? (
              <Button
                variant="outline"
                size="sm"
                onClick={handleStopWorker}
                disabled={workerActionLoading}
                className="gap-1.5 shrink-0"
              >
                {workerActionLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />}
                Stop
              </Button>
            ) : (
              <Button
                variant="default"
                size="sm"
                onClick={handleStartWorker}
                disabled={workerActionLoading}
                className="gap-1.5 shrink-0"
              >
                {workerActionLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                Start Worker
              </Button>
            )}
          </div>
        </div>

        {/* Orphaned running tasks warning */}
        {status && !status.workerRunning && (status.counts.running ?? 0) > 0 && (
          <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
            <TriangleAlert className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-amber-500">
                {status.counts.running} task{status.counts.running !== 1 ? "s" : ""} stuck in &ldquo;running&rdquo; state
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                The queue worker stopped while processing. Use the reset button (<RotateCcw className="inline h-3 w-3" />) next to each task to re-queue it, then restart <code className="font-mono">pnpm queue</code>.
              </p>
            </div>
          </div>
        )}

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
          {/* File Upload Zone */}
          <div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={ALLOWED_UPLOAD_TYPES.join(",")}
              className="hidden"
              onChange={handleFileSelect}
            />
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-lg p-3 cursor-pointer transition-colors text-center ${
                dragOver
                  ? "border-primary bg-primary/5"
                  : "border-muted-foreground/25 hover:border-muted-foreground/50"
              } ${files.length > 0 ? "pb-2" : ""}`}
            >
              {files.length === 0 ? (
                <div className="flex items-center justify-center gap-2 py-1 text-xs text-muted-foreground">
                  <Upload className="h-4 w-4" />
                  <span>Drop files here or click to attach (images, PDF, text — max 10MB, up to 5 files)</span>
                </div>
              ) : (
                <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
                  <div className="flex flex-wrap gap-2">
                    {files.map((f, i) => {
                      const isImage = f.type.startsWith("image/")
                      return (
                        <div key={i} className="flex items-center gap-2 rounded-md border bg-muted/50 px-2 py-1.5 text-xs">
                          {isImage ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={getBlobUrl(f)}
                              alt={f.name}
                              className="h-8 w-8 rounded object-cover"
                            />
                          ) : (
                            <FileText className="h-4 w-4 text-muted-foreground" />
                          )}
                          <div className="flex flex-col">
                            <span className="max-w-[120px] truncate font-medium">{f.name}</span>
                            <span className="text-muted-foreground">{formatFileSize(f.size)}</span>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-5 w-5 shrink-0"
                            onClick={() => removeFile(i)}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      )
                    })}
                    {files.length < MAX_FILES_PER_TASK && (
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="flex items-center gap-1 rounded-md border border-dashed px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:border-muted-foreground/50 transition-colors"
                      >
                        <Plus className="h-3 w-3" />
                        Add more
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
            {fileError && (
              <p className="text-xs text-destructive mt-1">{fileError}</p>
            )}
          </div>
          {submitError && (
            <p className="text-sm text-destructive">{submitError}</p>
          )}
          <div className="flex items-center gap-3">
            <Button type="submit" size="sm" disabled={submitting || uploading || !goal.trim()}>
              {submitting || uploading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ListOrdered className="h-4 w-4 mr-2" />}
              {uploading ? "Uploading..." : "Add to Queue"}
            </Button>
            {uploading && (
              <Button type="button" variant="outline" size="sm" onClick={cancelUpload}>
                Cancel Upload
              </Button>
            )}
            {files.length > 0 && !uploading && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <Paperclip className="h-3 w-3" />
                {files.length} file{files.length !== 1 ? "s" : ""} attached
              </span>
            )}
          </div>
        </form>

        {/* Active Queue */}
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead>Goal</TableHead>
                <TableHead>Project</TableHead>
                <TableHead className="w-32">Team</TableHead>
                <TableHead className="w-20">Priority</TableHead>
                <TableHead className="w-28">Status</TableHead>
                <TableHead className="w-32">Created</TableHead>
                <TableHead className="w-32">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {activeTasks.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                    No active tasks. Submit one above.
                  </TableCell>
                </TableRow>
              ) : (
                activeTasks.map((task) => {
                  const config = statusConfig[task.status as QueuedTaskStatus] ?? statusConfig.pending
                  const Icon = config.icon
                  const isPending = task.status === "pending"
                  const isEditing = editingId === task.id
                  const prio = priorityConfig[task.priority] ?? priorityConfig[0]
                  const pendingIdx = pendingIds.indexOf(task.id)

                  return (
                    <TableRow key={task.id}>
                      <TableCell className="font-mono text-xs">{task.id}</TableCell>
                      <TableCell className="max-w-xs text-sm">
                        {isEditing ? (
                          <div className="flex items-center gap-1">
                            <Input
                              value={editGoal}
                              onChange={(e) => setEditGoal(e.target.value)}
                              className="h-7 text-sm"
                              autoFocus
                              onKeyDown={(e) => {
                                if (e.key === "Enter") saveEditing()
                                if (e.key === "Escape") cancelEditing()
                              }}
                            />
                            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={saveEditing}>
                              <Check className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={cancelEditing}>
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1 group">
                            <span className="truncate">{task.goal}</span>
                            <AttachmentIndicator attachments={parseAttachments(task)} taskId={task.id} activePopover={attachmentPopover} setActivePopover={setAttachmentPopover} />
                            {isPending && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                                onClick={() => startEditing(task)}
                                title="Edit goal"
                              >
                                <Pencil className="h-3 w-3" />
                              </Button>
                            )}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate text-xs text-muted-foreground font-mono">
                        {task.projectPath}
                      </TableCell>
                      <TableCell>
                        {task.teamName ? (
                          <div className="flex flex-col gap-0.5">
                            {task.status === "running" ? (
                              <Link
                                href={`/agent-teams/${encodeURIComponent(task.teamName)}`}
                                className="inline-flex items-center gap-1 text-xs text-blue-400 hover:underline"
                              >
                                <Users className="h-3 w-3" />
                                <span className="max-w-[100px] truncate">{task.teamName}</span>
                              </Link>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                                <Users className="h-3 w-3" />
                                <span className="max-w-[100px] truncate">{task.teamName}</span>
                              </span>
                            )}
                            {(() => {
                              const health = teamHealthMap.get(task.teamName)
                              if (!health) return null
                              const dotClass = health.status === "alive" ? "bg-emerald-400 animate-pulse"
                                : health.status === "asleep" ? "bg-amber-400"
                                : health.status === "completed" ? "bg-green-500"
                                : "bg-gray-400"
                              const label = health.status === "alive" ? "Alive"
                                : health.status === "asleep" ? "Asleep"
                                : health.status === "completed" ? "Done"
                                : "Exited"
                              return (
                                <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                                  <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} />
                                  {label}
                                  {health.taskStats && health.taskStats.total > 0 && (
                                    <span className="text-muted-foreground/60">
                                      {health.taskStats.completed}/{health.taskStats.total}
                                    </span>
                                  )}
                                </span>
                              )
                            })()}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {isPending ? (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="sm" className={`h-7 gap-1 px-2 ${prio.color}`}>
                                <Flag className="h-3 w-3" />
                                {task.priority > 0 ? prio.label : "—"}
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start">
                              {[0, 1, 2, 3].map((p) => (
                                <DropdownMenuItem
                                  key={p}
                                  onClick={() => handlePatch(task.id, { priority: p })}
                                  className={priorityConfig[p].color}
                                >
                                  <Flag className="h-3 w-3 mr-2" />
                                  {priorityConfig[p].label}
                                  {task.priority === p && <Check className="h-3 w-3 ml-auto" />}
                                </DropdownMenuItem>
                              ))}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        ) : (
                          task.priority > 0 ? (
                            <Badge variant="outline" className={`gap-1 ${prio.color}`}>
                              <Flag className="h-3 w-3" />
                              {prio.label}
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )
                        )}
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
                      <TableCell>
                        <div className="flex gap-1">
                          {isPending && (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => handleReorder(task, "up")}
                                disabled={pendingIdx <= 0}
                                title="Move up"
                              >
                                <ChevronUp className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => handleReorder(task, "down")}
                                disabled={pendingIdx >= pendingIds.length - 1}
                                title="Move down"
                              >
                                <ChevronDown className="h-3.5 w-3.5" />
                              </Button>
                            </>
                          )}
                          {task.status === "running" && status && !status.workerRunning && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-amber-500 hover:text-amber-400"
                              onClick={() => handleRetry(task.id)}
                              title="Reset to pending (worker is stopped)"
                            >
                              <RotateCcw className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => handleCancel(task.id)}
                            disabled={cancellingIds.has(task.id)}
                            title="Cancel"
                          >
                            {cancellingIds.has(task.id)
                              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              : <XCircle className="h-3.5 w-3.5" />}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </div>

        {/* Completed Tasks Section */}
        {completedTasks.length > 0 && (
          <div className="rounded-lg border">
            <button
              onClick={() => setCompletedOpen(!isCompletedOpen)}
              className="flex items-center gap-2 w-full p-4 text-left hover:bg-muted/50 transition-colors"
            >
              <ChevronRight className={`h-4 w-4 transition-transform ${isCompletedOpen ? "rotate-90" : ""}`} />
              <span className="text-sm font-medium text-muted-foreground">Completed Tasks</span>
              <Badge variant="secondary" className="ml-1">{completedTasks.length}</Badge>
            </button>
            {isCompletedOpen && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">#</TableHead>
                    <TableHead>Goal</TableHead>
                    <TableHead>Project</TableHead>
                    <TableHead className="w-32">Team</TableHead>
                    <TableHead className="w-28">Status</TableHead>
                    <TableHead className="w-32">Finished</TableHead>
                    <TableHead className="w-40">Result</TableHead>
                    <TableHead className="w-24">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {completedTasks.map((task) => {
                    const config = statusConfig[task.status as QueuedTaskStatus] ?? statusConfig.pending
                    const Icon = config.icon

                    return (
                      <TableRow key={task.id} className="text-muted-foreground">
                        <TableCell className="font-mono text-xs">{task.id}</TableCell>
                        <TableCell className="max-w-xs text-sm">
                          <div className="flex items-center gap-1">
                            <span className="truncate">{task.goal}</span>
                            <AttachmentIndicator attachments={parseAttachments(task)} taskId={task.id} activePopover={attachmentPopover} setActivePopover={setAttachmentPopover} />
                          </div>
                        </TableCell>
                        <TableCell className="max-w-[200px] truncate text-xs font-mono">
                          {task.projectPath}
                        </TableCell>
                        <TableCell>
                          {task.teamName ? (
                            <div className="flex flex-col gap-0.5">
                              {/* Completed tasks are never "running" — always show as plain text */}
                              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                                <Users className="h-3 w-3" />
                                <span className="max-w-[100px] truncate">{task.teamName}</span>
                              </span>
                              {(() => {
                                const health = teamHealthMap.get(task.teamName)
                                if (!health) return (
                                  <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                                    <span className="h-1.5 w-1.5 rounded-full bg-gray-400" />
                                    Archived
                                  </span>
                                )
                                const label = health.status === "completed" ? "Done" : health.status.charAt(0).toUpperCase() + health.status.slice(1)
                                return (
                                  <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                                    <span className={`h-1.5 w-1.5 rounded-full ${health.status === "completed" ? "bg-green-500" : "bg-gray-400"}`} />
                                    {label}
                                  </span>
                                )
                              })()}
                            </div>
                          ) : (
                            <span className="text-xs">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant={config.variant} className="gap-1">
                            <Icon className="h-3 w-3" />
                            {config.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs">
                          {task.completedAt ? formatRelativeTime(task.completedAt) : formatRelativeTime(task.createdAt)}
                        </TableCell>
                        <TableCell className="max-w-[160px] truncate text-xs">
                          {task.result ?? "—"}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            {(task.status === "failed" || task.status === "cancelled") && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => handleRetry(task.id)}
                                title="Retry"
                              >
                                <RotateCcw className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => handleRemove(task.id)}
                              title="Remove"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
