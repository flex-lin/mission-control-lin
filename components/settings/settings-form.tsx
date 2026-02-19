"use client"

import { useState, useEffect, useCallback } from "react"
import { useTheme } from "next-themes"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { useSettings } from "@/lib/settings-context"
import type { Settings } from "@/types"
import { Save, RotateCcw, Moon } from "lucide-react"

const DEFAULT_PROXY_PORT = 8787
const DEFAULT_PROXY_TARGET = "https://api.anthropic.com"

const defaultSettings: Settings = {
  theme: "dark",
  refreshInterval: 30,
  proxyConfig: {
    enabled: false,
    port: DEFAULT_PROXY_PORT,
    targetUrl: DEFAULT_PROXY_TARGET,
  },
  backgroundExecution: {
    enabled: false,
    sleepPreventionMethod: "auto",
  },
}

interface ProxyStatus {
  running: boolean
  port: number
  targetUrl: string
}

interface SettingsFormProps {
  initialSettings: Settings
}

export function SettingsForm({ initialSettings }: SettingsFormProps) {
  const [settings, setSettings] = useState<Settings>(initialSettings)
  const [saving, setSaving] = useState(false)
  const { setTheme } = useTheme()
  const { refetch: refetchContext } = useSettings()

  // Proxy fields
  const [proxyPort, setProxyPort] = useState(
    String(settings.proxyConfig?.port ?? DEFAULT_PROXY_PORT)
  )
  const [proxyTarget, setProxyTarget] = useState(
    settings.proxyConfig?.targetUrl ?? DEFAULT_PROXY_TARGET
  )

  // Proxy status
  const [proxyStatus, setProxyStatus] = useState<ProxyStatus | null>(null)
  const [proxyLoading, setProxyLoading] = useState(false)

  const fetchProxyStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/proxy/status")
      const json = (await res.json()) as { data?: ProxyStatus }
      if (json.data) setProxyStatus(json.data)
    } catch {
      // ignore fetch errors
    }
  }, [])

  useEffect(() => {
    void fetchProxyStatus()
  }, [fetchProxyStatus])

  async function handleProxyToggle(enable: boolean) {
    setProxyLoading(true)
    const action = enable ? "start" : "stop"
    try {
      const res = await fetch("/api/proxy/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      })
      const json = await res.json()
      if (!res.ok) {
        toast.error(json.error ?? `Failed to ${action} proxy`)
        return
      }
      // Wait briefly for the process to start/stop before checking status
      await new Promise((r) => setTimeout(r, 1000))
      await fetchProxyStatus()
      setSettings((s) => ({
        ...s,
        proxyConfig: {
          ...(s.proxyConfig ?? { port: DEFAULT_PROXY_PORT, targetUrl: DEFAULT_PROXY_TARGET }),
          enabled: enable,
        },
      }))
      toast.success(`Proxy ${enable ? "started" : "stopped"}`)
    } catch {
      toast.error(`Failed to ${action} proxy`)
    } finally {
      setProxyLoading(false)
    }
  }

  async function handleSave() {
    // Validate refresh interval
    const interval = settings.refreshInterval ?? 30
    if (interval < 5 || interval > 300) {
      toast.error("Refresh interval must be between 5 and 300 seconds")
      return
    }

    // Validate proxy port
    const port = parseInt(proxyPort, 10)
    if (isNaN(port) || port < 1 || port > 65535) {
      toast.error("Proxy port must be between 1 and 65535")
      return
    }

    setSaving(true)
    try {
      const body: Settings = {
        ...settings,
        proxyConfig: {
          enabled: settings.proxyConfig?.enabled ?? false,
          port,
          targetUrl: proxyTarget,
        },
      }
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (res.ok) {
        toast.success("Settings saved")
        // Refresh the global settings context so other components pick up changes
        await refetchContext()
      } else {
        toast.error(json.error ?? "Failed to save settings")
      }
    } catch {
      toast.error("Network error — could not save settings")
    } finally {
      setSaving(false)
    }
  }

  function handleReset() {
    setSettings(defaultSettings)
    setProxyPort(String(DEFAULT_PROXY_PORT))
    setProxyTarget(DEFAULT_PROXY_TARGET)
    setTheme("dark")
    toast.info("Settings reset to defaults — click Save to apply")
  }

  return (
    <div className="space-y-6">
      {/* Theme & UI */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Appearance</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label>Theme</Label>
              <p className="text-xs text-muted-foreground">Interface color scheme</p>
            </div>
            <Select
              value={settings.theme ?? "dark"}
              onValueChange={(v) => {
                const theme = v as Settings["theme"]
                setSettings((s) => ({ ...s, theme }))
                setTheme(v)
              }}
            >
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="dark">Dark</SelectItem>
                <SelectItem value="light">Light</SelectItem>
                <SelectItem value="system">System</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div>
              <Label>Refresh Interval</Label>
              <p className="text-xs text-muted-foreground">Auto-refresh data every N seconds (5–300)</p>
            </div>
            <Input
              type="number"
              min={5}
              max={300}
              value={settings.refreshInterval ?? 30}
              onChange={(e) => {
                const val = parseInt(e.target.value, 10)
                if (!isNaN(val)) {
                  setSettings((s) => ({ ...s, refreshInterval: val }))
                }
              }}
              className="w-24"
            />
          </div>
        </CardContent>
      </Card>

      {/* Proxy Config */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold">Proxy Configuration</CardTitle>
            <div className="flex items-center gap-2">
              <span
                className={`inline-block h-2.5 w-2.5 rounded-full ${
                  proxyStatus?.running ? "bg-emerald-500" : "bg-red-500"
                }`}
              />
              <span className="text-xs text-muted-foreground">
                {proxyStatus?.running
                  ? `Running on port ${proxyStatus.port}`
                  : "Stopped"}
              </span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label>Enable Proxy</Label>
              <p className="text-xs text-muted-foreground">
                {proxyLoading
                  ? (proxyStatus?.running ? "Stopping proxy..." : "Starting proxy...")
                  : "Intercept Anthropic API calls for logging"}
              </p>
            </div>
            <Switch
              checked={proxyStatus?.running ?? false}
              disabled={proxyLoading}
              onCheckedChange={handleProxyToggle}
            />
          </div>

          <Separator />

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="proxy-port">Proxy Port</Label>
              <Input
                id="proxy-port"
                type="number"
                value={proxyPort}
                onChange={(e) => setProxyPort(e.target.value)}
                placeholder={String(DEFAULT_PROXY_PORT)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="proxy-target">Target URL</Label>
              <Input
                id="proxy-target"
                value={proxyTarget}
                onChange={(e) => setProxyTarget(e.target.value)}
                placeholder={DEFAULT_PROXY_TARGET}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Background Execution */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Moon className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-sm font-semibold">Background Execution</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Keep agent teams running when your computer goes to sleep. Uses system-level sleep
            prevention to ensure long-running tasks complete uninterrupted.
          </p>

          <div className="flex items-center justify-between">
            <div>
              <Label>Enable Sleep Prevention</Label>
              <p className="text-xs text-muted-foreground">
                Prevent system sleep while agent teams are active
              </p>
            </div>
            <Switch
              checked={settings.backgroundExecution?.enabled ?? false}
              onCheckedChange={(checked) =>
                setSettings((s) => ({
                  ...s,
                  backgroundExecution: {
                    enabled: checked,
                    sleepPreventionMethod: s.backgroundExecution?.sleepPreventionMethod ?? "auto",
                  },
                }))
              }
            />
          </div>

          {settings.backgroundExecution?.enabled && (
            <>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <Label>Prevention Method</Label>
                  <p className="text-xs text-muted-foreground">
                    How to prevent the system from sleeping
                  </p>
                </div>
                <Select
                  value={settings.backgroundExecution?.sleepPreventionMethod ?? "auto"}
                  onValueChange={(v) =>
                    setSettings((s) => ({
                      ...s,
                      backgroundExecution: {
                        enabled: s.backgroundExecution?.enabled ?? false,
                        sleepPreventionMethod: v as "caffeinate" | "systemd-inhibit" | "auto",
                      },
                    }))
                  }
                >
                  <SelectTrigger className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Auto-detect</SelectItem>
                    <SelectItem value="caffeinate">caffeinate (macOS)</SelectItem>
                    <SelectItem value="systemd-inhibit">systemd-inhibit (Linux)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Save & Reset */}
      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={saving} className="gap-1.5">
          <Save className="h-3.5 w-3.5" />
          {saving ? "Saving..." : "Save Settings"}
        </Button>
        <Button variant="outline" onClick={handleReset} className="gap-1.5">
          <RotateCcw className="h-3.5 w-3.5" />
          Reset to Defaults
        </Button>
      </div>
    </div>
  )
}
