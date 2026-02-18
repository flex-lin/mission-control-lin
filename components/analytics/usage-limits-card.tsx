"use client"

import { useState, useEffect, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { toast } from "sonner"
import { useSettings } from "@/lib/settings-context"
import { Settings2 } from "lucide-react"
import type { UsageLimits, UsageSummary } from "@/types"

function getProgressColor(percent: number): string {
  if (percent >= 90) return "bg-red-500"
  if (percent >= 70) return "bg-yellow-500"
  return "bg-emerald-500"
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
}

function UsageBar({
  label,
  current,
  limit,
  format,
}: {
  label: string
  current: number
  limit: number | null
  format: "tokens" | "cost"
}) {
  if (limit === null || limit <= 0) {
    return (
      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">{label}</span>
          <span className="font-medium">
            {format === "cost" ? `$${current.toFixed(4)}` : formatTokens(current)}
            <span className="text-muted-foreground ml-1">/ no limit</span>
          </span>
        </div>
        <Progress value={0} className="h-2" indicatorClassName="bg-muted" />
      </div>
    )
  }

  const percent = Math.min((current / limit) * 100, 100)
  const colorClass = getProgressColor(percent)

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">
          {format === "cost" ? `$${current.toFixed(4)}` : formatTokens(current)}
          <span className="text-muted-foreground ml-1">
            / {format === "cost" ? `$${limit.toFixed(2)}` : formatTokens(limit)}
          </span>
          <span className={`ml-1.5 ${percent >= 90 ? "text-red-400" : percent >= 70 ? "text-yellow-400" : "text-muted-foreground"}`}>
            ({percent.toFixed(0)}%)
          </span>
        </span>
      </div>
      <Progress value={percent} className="h-2" indicatorClassName={colorClass} />
    </div>
  )
}

function EditLimitsDialog({
  limits,
  onSave,
}: {
  limits: UsageLimits
  onSave: (limits: UsageLimits) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<UsageLimits>(limits)

  useEffect(() => {
    setForm(limits)
  }, [limits])

  async function handleSave() {
    setSaving(true)
    try {
      await onSave(form)
      setOpen(false)
      toast.success("Usage limits saved")
    } catch {
      toast.error("Failed to save usage limits")
    } finally {
      setSaving(false)
    }
  }

  function parseNum(val: string): number | null {
    if (!val.trim()) return null
    const n = parseFloat(val)
    return isNaN(n) || n <= 0 ? null : n
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs text-muted-foreground hover:text-foreground">
          <Settings2 className="h-3.5 w-3.5" />
          Configure
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Configure Usage Limits</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="daily-tokens">Daily Token Limit</Label>
            <Input
              id="daily-tokens"
              type="number"
              placeholder="e.g. 5000000"
              value={form.dailyTokens ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, dailyTokens: parseNum(e.target.value) }))}
            />
            <p className="text-[10px] text-muted-foreground">Leave empty for no limit</p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="monthly-tokens">Monthly Token Limit</Label>
            <Input
              id="monthly-tokens"
              type="number"
              placeholder="e.g. 100000000"
              value={form.monthlyTokens ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, monthlyTokens: parseNum(e.target.value) }))}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="daily-cost">Daily Cost Limit ($)</Label>
            <Input
              id="daily-cost"
              type="number"
              step="0.01"
              placeholder="e.g. 10.00"
              value={form.dailyCost ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, dailyCost: parseNum(e.target.value) }))}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="monthly-cost">Monthly Cost Limit ($)</Label>
            <Input
              id="monthly-cost"
              type="number"
              step="0.01"
              placeholder="e.g. 200.00"
              value={form.monthlyCost ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, monthlyCost: parseNum(e.target.value) }))}
            />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save Limits"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function UsageLimitsCard() {
  const [summary, setSummary] = useState<UsageSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const { settings } = useSettings()

  const fetchSummary = useCallback(async () => {
    try {
      const res = await fetch("/api/analytics/usage-summary", { cache: "no-store" })
      if (!res.ok) throw new Error("Failed to fetch usage summary")
      const json = await res.json()
      setSummary(json.data ?? null)
    } catch {
      // silently fail — card shows skeleton/empty
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchSummary()
  }, [fetchSummary])

  // Auto-refresh with same interval as analytics dashboard
  useEffect(() => {
    const intervalMs = (settings.refreshInterval ?? 30) * 1000
    const timer = setInterval(fetchSummary, intervalMs)
    return () => clearInterval(timer)
  }, [fetchSummary, settings.refreshInterval])

  async function handleSaveLimits(limits: UsageLimits) {
    const res = await fetch("/api/settings/usage-limits", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(limits),
    })
    if (!res.ok) throw new Error("Failed to save limits")
    await fetchSummary()
  }

  if (loading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <Skeleton className="h-4 w-40" />
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-3 w-32" />
                <Skeleton className="h-2 w-full" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    )
  }

  if (!summary) return null

  const hasAnyLimit =
    summary.daily.tokenLimit !== null ||
    summary.monthly.tokenLimit !== null ||
    summary.daily.costLimit !== null ||
    summary.monthly.costLimit !== null

  // Extract limits in UsageLimits shape for the edit dialog
  const currentLimits: UsageLimits = {
    dailyTokens: summary.daily.tokenLimit,
    dailyCost: summary.daily.costLimit,
    monthlyTokens: summary.monthly.tokenLimit,
    monthlyCost: summary.monthly.costLimit,
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold">Usage Limits</CardTitle>
          <EditLimitsDialog limits={currentLimits} onSave={handleSaveLimits} />
        </div>
      </CardHeader>
      <CardContent>
        {!hasAnyLimit ? (
          <p className="text-xs text-muted-foreground">
            No usage limits configured. Click Configure to set daily/monthly limits for tokens and costs.
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <UsageBar
              label="Daily Tokens"
              current={summary.daily.tokens}
              limit={summary.daily.tokenLimit}
              format="tokens"
            />
            <UsageBar
              label="Monthly Tokens"
              current={summary.monthly.tokens}
              limit={summary.monthly.tokenLimit}
              format="tokens"
            />
            <UsageBar
              label="Daily Cost"
              current={summary.daily.cost}
              limit={summary.daily.costLimit}
              format="cost"
            />
            <UsageBar
              label="Monthly Cost"
              current={summary.monthly.cost}
              limit={summary.monthly.costLimit}
              format="cost"
            />
          </div>
        )}
      </CardContent>
    </Card>
  )
}
