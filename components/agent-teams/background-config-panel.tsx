"use client"

import { useState } from "react"
import { useAutoRefresh } from "@/lib/hooks/use-auto-refresh"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Moon, RefreshCw } from "lucide-react"
import { toast } from "sonner"
import type { BackgroundConfig } from "@/types"

interface BackgroundConfigPanelProps {
  teamName: string
}

export function BackgroundConfigPanel({ teamName }: BackgroundConfigPanelProps) {
  const [saving, setSaving] = useState(false)
  const { data, loading, refetch } = useAutoRefresh<BackgroundConfig>({
    url: `/api/teams/${encodeURIComponent(teamName)}/background`,
    intervalMs: 10000,
  })

  async function updateConfig(updates: Partial<BackgroundConfig>) {
    setSaving(true)
    try {
      const res = await fetch(
        `/api/teams/${encodeURIComponent(teamName)}/background`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updates),
        }
      )
      if (res.ok) {
        toast.success("Background config updated")
        await refetch()
      } else {
        const json = await res.json()
        toast.error(json.error ?? "Failed to update config")
      }
    } catch {
      toast.error("Network error")
    } finally {
      setSaving(false)
    }
  }

  if (loading && !data) {
    return (
      <Card>
        <CardContent className="py-6 text-center">
          <p className="text-xs text-muted-foreground">Loading background config...</p>
        </CardContent>
      </Card>
    )
  }

  if (!data) return null

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-1.5 text-sm font-semibold">
            <Moon className="h-3.5 w-3.5 text-indigo-400" />
            Background Execution
          </CardTitle>
          <Badge
            variant={data.persistent ? "default" : "secondary"}
            className={`text-[10px] ${
              data.persistent
                ? "bg-indigo-500/20 text-indigo-400 hover:bg-indigo-500/30"
                : ""
            }`}
          >
            {data.persistent ? "Persistent" : "Standard"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <Label>Auto-wake after sleep</Label>
            <p className="text-xs text-muted-foreground">
              Automatically resume this team when the system wakes
            </p>
          </div>
          <Switch
            checked={data.persistent}
            disabled={saving}
            onCheckedChange={(checked) => updateConfig({ persistent: checked })}
          />
        </div>

        {data.persistent && (
          <>
            <Separator />
            <div className="flex items-center justify-between">
              <div>
                <Label>Wake Strategy</Label>
                <p className="text-xs text-muted-foreground">
                  When to resume after sleep detection
                </p>
              </div>
              <Select
                value={data.wakeStrategy}
                onValueChange={(v) =>
                  updateConfig({ wakeStrategy: v as "immediate" | "scheduled" })
                }
              >
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="immediate">Immediate</SelectItem>
                  <SelectItem value="scheduled">Scheduled</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {data.wakeStrategy === "scheduled" && (
              <div className="flex items-center justify-between">
                <div>
                  <Label>Wake Delay (seconds)</Label>
                  <p className="text-xs text-muted-foreground">
                    Wait before auto-waking
                  </p>
                </div>
                <Input
                  type="number"
                  min={0}
                  max={3600}
                  value={data.wakeDelaySeconds}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10)
                    if (!isNaN(val) && val >= 0) {
                      updateConfig({ wakeDelaySeconds: val })
                    }
                  }}
                  className="w-24"
                />
              </div>
            )}

            <div className="flex items-center justify-between">
              <div>
                <Label>Max Retries</Label>
                <p className="text-xs text-muted-foreground">
                  Give up after this many failed wakes
                </p>
              </div>
              <Input
                type="number"
                min={0}
                max={20}
                value={data.maxWakeRetries}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10)
                  if (!isNaN(val) && val >= 0) {
                    updateConfig({ maxWakeRetries: val })
                  }
                }}
                className="w-24"
              />
            </div>

            <Separator />

            {/* Status info */}
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Status</p>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-md bg-muted/30 px-2.5 py-1.5">
                  <span className="text-muted-foreground">Wake attempts: </span>
                  <span className={data.wakeRetryCount >= data.maxWakeRetries ? "text-red-400" : "text-foreground"}>
                    {data.wakeRetryCount}/{data.maxWakeRetries}
                  </span>
                </div>
                <div className="rounded-md bg-muted/30 px-2.5 py-1.5">
                  <span className="text-muted-foreground">Last sleep: </span>
                  <span className="text-foreground">
                    {data.lastSleepDetected
                      ? new Date(data.lastSleepDetected).toLocaleTimeString()
                      : "None"}
                  </span>
                </div>
              </div>
              {data.lastAutoWake && (
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <RefreshCw className="h-3 w-3" />
                  Last auto-wake: {new Date(data.lastAutoWake).toLocaleTimeString()}
                </div>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
