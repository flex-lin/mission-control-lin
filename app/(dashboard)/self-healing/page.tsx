"use client"

import { useState, useCallback } from "react"
import Link from "next/link"
import { Topbar } from "@/components/layout/topbar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useAutoRefresh } from "@/lib/hooks/use-auto-refresh"
import {
  Wrench,
  AlertCircle,
  CheckCircle2,
  Clock,
  Loader2,
  Play,
  SkipForward,
  Trash2,
  Plus,
  RotateCcw,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  Code2,
  ListOrdered,
} from "lucide-react"
import type {
  CompilationError,
  CompilationErrorStatus,
  CompilationErrorType,
  SelfHealingStats,
} from "@/types"

// ── Status config ─────────────────────────────────────────────────────────────

const statusConfig: Record<
  CompilationErrorStatus,
  {
    icon: React.ElementType
    variant: "default" | "secondary" | "destructive" | "outline" | "success" | "warning"
    label: string
    dotClass: string
  }
> = {
  pending: {
    icon: Clock,
    variant: "secondary",
    label: "Pending",
    dotClass: "bg-muted-foreground",
  },
  healing: {
    icon: Loader2,
    variant: "default",
    label: "Healing",
    dotClass: "bg-blue-400 animate-pulse",
  },
  healed: {
    icon: CheckCircle2,
    variant: "success",
    label: "Healed",
    dotClass: "bg-emerald-500",
  },
  failed: {
    icon: AlertCircle,
    variant: "destructive",
    label: "Failed",
    dotClass: "bg-red-500",
  },
  skipped: {
    icon: SkipForward,
    variant: "outline",
    label: "Skipped",
    dotClass: "bg-muted-foreground/50",
  },
}

const errorTypeLabels: Record<CompilationErrorType, string> = {
  typescript: "TypeScript",
  build: "Build",
  lint: "Lint",
  runtime: "Runtime",
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function shortPath(fullPath: string): string {
  const parts = fullPath.split("/")
  return parts.length > 3 ? `…/${parts.slice(-2).join("/")}` : fullPath
}

// ── Stat Card ─────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  className,
}: {
  label: string
  value: number | string
  className?: string
}) {
  return (
    <div className={`rounded-lg border p-4 ${className ?? ""}`}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  )
}

// ── Error Detail Row ──────────────────────────────────────────────────────────

function ErrorRow({
  error,
  onHeal,
  onSkip,
  onDelete,
  onRetry,
  isActioning,
}: {
  error: CompilationError
  onHeal: (id: number) => void
  onSkip: (id: number) => void
  onDelete: (id: number) => void
  onRetry: (id: number) => void
  isActioning: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const cfg = statusConfig[error.status] ?? statusConfig.pending
  const Icon = cfg.icon
  const isHealing = error.status === "healing"
  const isTerminal = error.status === "healed" || error.status === "skipped"
  const canHeal =
    !isHealing &&
    error.status !== "healed" &&
    error.retryCount < error.maxRetries

  return (
    <>
      <TableRow
        className="cursor-pointer hover:bg-muted/30 transition-colors"
        onClick={() => setExpanded((v) => !v)}
      >
        <TableCell className="w-8 pl-3">
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </TableCell>
        <TableCell className="font-mono text-xs">{error.id}</TableCell>
        <TableCell>
          <Badge variant="outline" className="text-[10px]">
            {errorTypeLabels[error.errorType as CompilationErrorType] ?? error.errorType}
          </Badge>
        </TableCell>
        <TableCell className="max-w-xs">
          <div className="flex flex-col gap-0.5">
            <span className="truncate text-sm font-medium">
              {error.errorMessage.split("\n")[0].slice(0, 80)}
            </span>
            {error.filePath && (
              <span className="text-[10px] text-muted-foreground font-mono truncate">
                {error.filePath}
                {error.lineNumber ? `:${error.lineNumber}` : ""}
              </span>
            )}
          </div>
        </TableCell>
        <TableCell className="max-w-[140px] truncate text-xs text-muted-foreground font-mono">
          {shortPath(error.projectPath)}
        </TableCell>
        <TableCell>
          <div className="flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${cfg.dotClass}`} />
            <Badge variant={cfg.variant} className="gap-1 text-[10px]">
              <Icon className={`h-3 w-3 ${isHealing ? "animate-spin" : ""}`} />
              {cfg.label}
            </Badge>
          </div>
        </TableCell>
        <TableCell className="text-xs text-muted-foreground">
          {error.retryCount}/{error.maxRetries}
        </TableCell>
        <TableCell className="text-xs text-muted-foreground">
          {formatRelativeTime(error.createdAt)}
        </TableCell>
        <TableCell onClick={(e) => e.stopPropagation()}>
          <div className="flex gap-1">
            {canHeal && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-blue-400 hover:text-blue-300"
                title="Trigger self-healing"
                disabled={isActioning}
                onClick={() => onHeal(error.id)}
              >
                {isActioning ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Wrench className="h-3.5 w-3.5" />
                )}
              </Button>
            )}
            {error.status === "failed" && error.retryCount < error.maxRetries && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                title="Retry healing"
                disabled={isActioning}
                onClick={() => onRetry(error.id)}
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </Button>
            )}
            {!isTerminal && !isHealing && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                title="Skip"
                disabled={isActioning}
                onClick={() => onSkip(error.id)}
              >
                <SkipForward className="h-3.5 w-3.5" />
              </Button>
            )}
            {isTerminal && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                title="Delete"
                disabled={isActioning}
                onClick={() => onDelete(error.id)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </TableCell>
      </TableRow>

      {/* Expanded detail row */}
      {expanded && (
        <TableRow className="bg-muted/10">
          <TableCell colSpan={9} className="py-3 px-6">
            <div className="space-y-3">
              {/* Full error message */}
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">
                  Full Error Message
                </p>
                <pre className="text-xs font-mono bg-muted/40 rounded-md p-3 overflow-x-auto whitespace-pre-wrap max-h-40 overflow-y-auto">
                  {error.errorMessage}
                </pre>
              </div>

              {/* Resolution (if healed) */}
              {error.resolution && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">
                    Resolution
                  </p>
                  <p className="text-xs text-emerald-400">{error.resolution}</p>
                </div>
              )}

              {/* Healing attempts */}
              {error.healingAttempts && error.healingAttempts.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">
                    Healing Attempts ({error.healingAttempts.length})
                  </p>
                  <div className="space-y-1.5">
                    {error.healingAttempts.map((attempt) => (
                      <div
                        key={attempt.id}
                        className="flex items-start gap-3 rounded border bg-muted/20 px-3 py-2 text-xs"
                      >
                        <span
                          className={`mt-0.5 h-2 w-2 rounded-full shrink-0 ${
                            attempt.success ? "bg-emerald-500" : "bg-red-500"
                          }`}
                        />
                        <div className="flex-1 min-w-0">
                          <span className="font-medium">
                            Attempt #{attempt.attemptNumber}
                          </span>
                          <span className="text-muted-foreground ml-2">
                            {attempt.strategy}
                          </span>
                          {attempt.durationMs && (
                            <span className="text-muted-foreground ml-2">
                              {(attempt.durationMs / 1000).toFixed(1)}s
                            </span>
                          )}
                          {attempt.errorAfter && (
                            <p className="mt-1 text-muted-foreground truncate">
                              Remaining: {attempt.errorAfter.slice(0, 100)}
                            </p>
                          )}
                        </div>
                        <span className="text-muted-foreground shrink-0">
                          {formatRelativeTime(attempt.createdAt)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  )
}

// ── Report Error Dialog ───────────────────────────────────────────────────────

function ReportErrorDialog({
  open,
  onClose,
  onSubmit,
}: {
  open: boolean
  onClose: () => void
  onSubmit: (data: {
    projectPath: string
    errorMessage: string
    errorType: CompilationErrorType
    filePath?: string
    lineNumber?: number
  }) => Promise<void>
}) {
  const [projectPath, setProjectPath] = useState("")
  const [errorMessage, setErrorMessage] = useState("")
  const [errorType, setErrorType] = useState<CompilationErrorType>("build")
  const [filePath, setFilePath] = useState("")
  const [lineNumber, setLineNumber] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!projectPath.trim() || !errorMessage.trim()) return
    setSubmitting(true)
    setError(null)
    try {
      await onSubmit({
        projectPath: projectPath.trim(),
        errorMessage: errorMessage.trim(),
        errorType,
        filePath: filePath.trim() || undefined,
        lineNumber: lineNumber ? parseInt(lineNumber, 10) : undefined,
      })
      // Reset form
      setProjectPath("")
      setErrorMessage("")
      setErrorType("build")
      setFilePath("")
      setLineNumber("")
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to report error")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Report Compilation Error</DialogTitle>
            <DialogDescription>
              Manually report a compilation error to queue it for self-healing.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-1.5">
              <Label htmlFor="re-projectPath">Project Path</Label>
              <Input
                id="re-projectPath"
                placeholder="/path/to/project"
                value={projectPath}
                onChange={(e) => setProjectPath(e.target.value)}
                disabled={submitting}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="re-errorType">Error Type</Label>
              <Select
                value={errorType}
                onValueChange={(v) => setErrorType(v as CompilationErrorType)}
                disabled={submitting}
              >
                <SelectTrigger id="re-errorType">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="typescript">TypeScript</SelectItem>
                  <SelectItem value="build">Build</SelectItem>
                  <SelectItem value="lint">Lint</SelectItem>
                  <SelectItem value="runtime">Runtime</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="re-filePath">
                  File Path{" "}
                  <span className="text-muted-foreground font-normal">(optional)</span>
                </Label>
                <Input
                  id="re-filePath"
                  placeholder="src/utils.ts"
                  value={filePath}
                  onChange={(e) => setFilePath(e.target.value)}
                  disabled={submitting}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="re-lineNumber">
                  Line{" "}
                  <span className="text-muted-foreground font-normal">(opt.)</span>
                </Label>
                <Input
                  id="re-lineNumber"
                  type="number"
                  placeholder="42"
                  value={lineNumber}
                  onChange={(e) => setLineNumber(e.target.value)}
                  disabled={submitting}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="re-errorMessage">Error Message</Label>
              <Textarea
                id="re-errorMessage"
                placeholder="Paste the full compiler error output here…"
                value={errorMessage}
                onChange={(e) => setErrorMessage(e.target.value)}
                rows={6}
                disabled={submitting}
                className="font-mono text-xs"
              />
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={submitting || !projectPath.trim() || !errorMessage.trim()}
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Plus className="h-4 w-4 mr-2" />
              )}
              Report Error
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SelfHealingPage() {
  const [reportDialogOpen, setReportDialogOpen] = useState(false)
  const [actioningIds, setActioningIds] = useState<Set<number>>(new Set())
  const [actionError, setActionError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [resolvedOpen, setResolvedOpen] = useState(false)
  const [detectProjectPath, setDetectProjectPath] = useState("")
  const [detecting, setDetecting] = useState(false)

  const { data: stats, refetch: refetchStats } = useAutoRefresh<SelfHealingStats>({
    url: "/api/compilation-errors?stats=true",
    intervalMs: 10000,
  })

  const filterParam = statusFilter !== "all" ? `?status=${statusFilter}` : ""
  const { data: errors, refetch: refetchErrors } = useAutoRefresh<CompilationError[]>({
    url: `/api/compilation-errors${filterParam}`,
    intervalMs: 8000,
  })

  const refetchAll = useCallback(async () => {
    await Promise.all([refetchErrors(), refetchStats()])
  }, [refetchErrors, refetchStats])

  function startActioning(id: number) {
    setActioningIds((prev) => new Set(prev).add(id))
  }
  function stopActioning(id: number) {
    setActioningIds((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })
  }

  async function handleHeal(id: number) {
    startActioning(id)
    setActionError(null)
    try {
      const res = await fetch(`/api/compilation-errors/${id}/heal`, { method: "POST" })
      if (!res.ok) {
        const json = await res.json() as { error?: string }
        setActionError(json.error ?? `Failed to trigger healing (HTTP ${res.status})`)
      }
    } catch {
      setActionError("Network error while triggering healing")
    } finally {
      stopActioning(id)
      await refetchAll()
    }
  }

  async function handleSkip(id: number) {
    startActioning(id)
    setActionError(null)
    try {
      await fetch(`/api/compilation-errors/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "skipped" }),
      })
    } catch {
      setActionError("Failed to skip error")
    } finally {
      stopActioning(id)
      await refetchAll()
    }
  }

  async function handleDelete(id: number) {
    startActioning(id)
    setActionError(null)
    try {
      await fetch(`/api/compilation-errors/${id}`, { method: "DELETE" })
    } catch {
      setActionError("Failed to delete error")
    } finally {
      stopActioning(id)
      await refetchAll()
    }
  }

  async function handleRetry(id: number) {
    // Reset status to pending first, then trigger healing
    startActioning(id)
    setActionError(null)
    try {
      await fetch(`/api/compilation-errors/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "pending" }),
      })
      await handleHeal(id)
      return
    } catch {
      setActionError("Failed to retry healing")
    } finally {
      stopActioning(id)
      await refetchAll()
    }
  }

  async function handleReport(data: {
    projectPath: string
    errorMessage: string
    errorType: CompilationErrorType
    filePath?: string
    lineNumber?: number
  }) {
    const res = await fetch("/api/compilation-errors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    })
    if (!res.ok) {
      const json = await res.json() as { error?: string }
      throw new Error(json.error ?? `HTTP ${res.status}`)
    }
    await refetchAll()
  }

  const activeErrors = errors?.filter(
    (e) => e.status !== "healed" && e.status !== "skipped"
  ) ?? []

  const resolvedErrors = errors?.filter(
    (e) => e.status === "healed" || e.status === "skipped"
  ).sort((a, b) => {
    const aTime = a.healedAt ?? a.updatedAt
    const bTime = b.healedAt ?? b.updatedAt
    return new Date(bTime).getTime() - new Date(aTime).getTime()
  }) ?? []

  return (
    <div className="flex flex-col">
      <Topbar
        title="Self-Healing"
        subtitle="Automatically detect and fix compilation errors"
        live={stats ? (stats.healing > 0) : false}
      >
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => setReportDialogOpen(true)}
        >
          <Plus className="h-3.5 w-3.5" />
          Report Error
        </Button>
        <Link href="/queue">
          <Button variant="ghost" size="sm" className="gap-1.5">
            <ListOrdered className="h-3.5 w-3.5" />
            Task Queue
            <ExternalLink className="h-3 w-3 opacity-50" />
          </Button>
        </Link>
      </Topbar>

      <div className="p-6 space-y-6">

        {/* Stats Row */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatCard label="Total Errors" value={stats?.total ?? 0} />
          <StatCard label="Pending" value={stats?.pending ?? 0} />
          <StatCard
            label="Healing"
            value={stats?.healing ?? 0}
            className={stats && stats.healing > 0 ? "border-blue-500/40" : ""}
          />
          <StatCard
            label="Healed"
            value={stats?.healed ?? 0}
            className={stats && stats.healed > 0 ? "border-emerald-500/30" : ""}
          />
          <StatCard
            label="Failed"
            value={stats?.failed ?? 0}
            className={stats && stats.failed > 0 ? "border-red-500/30" : ""}
          />
          <StatCard
            label="Success Rate"
            value={stats ? `${stats.successRate}%` : "—"}
            className={
              stats && stats.successRate >= 80
                ? "border-emerald-500/30"
                : stats && stats.successRate > 0
                ? "border-amber-500/30"
                : ""
            }
          />
        </div>

        {/* How It Works Banner */}
        <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-4">
          <div className="flex items-start gap-3">
            <Code2 className="h-4 w-4 text-blue-400 mt-0.5 shrink-0" />
            <div className="space-y-1">
              <p className="text-sm font-medium">How Self-Healing Works</p>
              <p className="text-xs text-muted-foreground">
                When a compilation error is reported (automatically or manually), Mission Control
                queues a task for an AI agent to analyze and fix it.{" "}
                The agent runs{" "}
                <code className="rounded bg-muted px-1 py-0.5 font-mono">pnpm build</code>{" "}
                iteratively until the project compiles cleanly, then marks the error as healed.
                Monitor healing progress in the{" "}
                <Link href="/queue" className="text-blue-400 hover:underline">
                  Task Queue
                </Link>
                .
              </p>
            </div>
          </div>
        </div>

        {actionError && (
          <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3">
            <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
            <p className="text-sm text-destructive">{actionError}</p>
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto h-6 px-2 text-xs"
              onClick={() => setActionError(null)}
            >
              Dismiss
            </Button>
          </div>
        )}

        {/* Filters */}
        <div className="flex items-center gap-3">
          <Label className="text-xs text-muted-foreground shrink-0">Filter by status:</Label>
          {(["all", "pending", "healing", "healed", "failed", "skipped"] as const).map((s) => (
            <Button
              key={s}
              variant={statusFilter === s ? "default" : "outline"}
              size="sm"
              className="h-7 text-xs px-3"
              onClick={() => setStatusFilter(s)}
            >
              {s === "all" ? "All" : statusConfig[s as CompilationErrorStatus]?.label ?? s}
              {s !== "all" && stats && (
                <span className="ml-1 opacity-60">
                  {stats[s as keyof SelfHealingStats] as number}
                </span>
              )}
            </Button>
          ))}
        </div>

        {/* Active Errors Table */}
        <div className="rounded-lg border">
          <div className="flex items-center gap-2 px-4 py-3 border-b">
            <Wrench className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">
              Active Errors
            </h2>
            <Badge variant="secondary" className="ml-1">
              {activeErrors.length}
            </Badge>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead className="w-12">#</TableHead>
                <TableHead className="w-24">Type</TableHead>
                <TableHead>Error</TableHead>
                <TableHead className="w-36">Project</TableHead>
                <TableHead className="w-32">Status</TableHead>
                <TableHead className="w-20">Retries</TableHead>
                <TableHead className="w-28">Reported</TableHead>
                <TableHead className="w-28">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {activeErrors.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={9}
                    className="py-10 text-center text-muted-foreground"
                  >
                    <div className="flex flex-col items-center gap-2">
                      <CheckCircle2 className="h-8 w-8 text-muted-foreground/30" />
                      <p className="text-sm">No active compilation errors.</p>
                      <p className="text-xs">
                        Click <strong>Report Error</strong> to manually log one, or errors
                        will appear automatically when the build fails.
                      </p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                activeErrors.map((error) => (
                  <ErrorRow
                    key={error.id}
                    error={error}
                    onHeal={handleHeal}
                    onSkip={handleSkip}
                    onDelete={handleDelete}
                    onRetry={handleRetry}
                    isActioning={actioningIds.has(error.id)}
                  />
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Resolved Errors (collapsible) */}
        {(statusFilter === "all" || statusFilter === "healed" || statusFilter === "skipped") &&
          resolvedErrors.length > 0 && (
            <div className="rounded-lg border">
              <button
                onClick={() => setResolvedOpen((v) => !v)}
                className="flex items-center gap-2 w-full p-4 text-left hover:bg-muted/50 transition-colors"
              >
                <ChevronRight
                  className={`h-4 w-4 transition-transform ${resolvedOpen ? "rotate-90" : ""}`}
                />
                <span className="text-sm font-medium text-muted-foreground">
                  Resolved Errors
                </span>
                <Badge variant="secondary" className="ml-1">
                  {resolvedErrors.length}
                </Badge>
              </button>
              {resolvedOpen && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8" />
                      <TableHead className="w-12">#</TableHead>
                      <TableHead className="w-24">Type</TableHead>
                      <TableHead>Error</TableHead>
                      <TableHead className="w-36">Project</TableHead>
                      <TableHead className="w-32">Status</TableHead>
                      <TableHead className="w-20">Retries</TableHead>
                      <TableHead className="w-28">Reported</TableHead>
                      <TableHead className="w-28">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {resolvedErrors.map((error) => (
                      <ErrorRow
                        key={error.id}
                        error={error}
                        onHeal={handleHeal}
                        onSkip={handleSkip}
                        onDelete={handleDelete}
                        onRetry={handleRetry}
                        isActioning={actioningIds.has(error.id)}
                      />
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          )}

        {/* Detect & Heal */}
        <div className="rounded-lg border p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Play className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Detect &amp; Heal</h2>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="detect-path" className="text-xs">
                Project Path
              </Label>
              <Input
                id="detect-path"
                placeholder="/absolute/path/to/project"
                value={detectProjectPath}
                onChange={(e) => setDetectProjectPath(e.target.value)}
                disabled={detecting}
                className="font-mono text-xs h-8"
              />
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 shrink-0"
                disabled={detecting || !detectProjectPath.trim()}
                onClick={async () => {
                  setDetecting(true)
                  setActionError(null)
                  try {
                    const res = await fetch("/api/compilation-errors/detect", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        projectPath: detectProjectPath.trim(),
                        autoHeal: false,
                      }),
                    })
                    if (!res.ok) {
                      const json = await res.json() as { error?: string }
                      setActionError(json.error ?? "Build detection failed")
                    } else {
                      await refetchAll()
                    }
                  } catch {
                    setActionError("Failed to run build detection")
                  } finally {
                    setDetecting(false)
                  }
                }}
              >
                {detecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Code2 className="h-3.5 w-3.5" />}
                Detect Errors
              </Button>
              <Button
                variant="default"
                size="sm"
                className="gap-1.5 shrink-0"
                disabled={detecting || !detectProjectPath.trim()}
                onClick={async () => {
                  setDetecting(true)
                  setActionError(null)
                  try {
                    const res = await fetch("/api/compilation-errors/detect", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        projectPath: detectProjectPath.trim(),
                        autoHeal: true,
                      }),
                    })
                    if (!res.ok) {
                      const json = await res.json() as { error?: string }
                      setActionError(json.error ?? "Auto-heal failed")
                    } else {
                      await refetchAll()
                    }
                  } catch {
                    setActionError("Failed to run auto-heal")
                  } finally {
                    setDetecting(false)
                  }
                }}
              >
                {detecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wrench className="h-3.5 w-3.5" />}
                Detect + Auto-Heal
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            "Detect Errors" runs <code className="font-mono text-xs">pnpm build</code> and reports
            any compilation errors without fixing them.{" "}
            "Detect + Auto-Heal" also immediately invokes Claude AI to fix each detected error.
          </p>
          <div className="flex gap-2">
            <Link href="/queue">
              <Button variant="ghost" size="sm" className="gap-1.5 text-xs h-7">
                <ListOrdered className="h-3 w-3" />
                View Task Queue
              </Button>
            </Link>
          </div>
        </div>
      </div>

      <ReportErrorDialog
        open={reportDialogOpen}
        onClose={() => setReportDialogOpen(false)}
        onSubmit={handleReport}
      />
    </div>
  )
}
