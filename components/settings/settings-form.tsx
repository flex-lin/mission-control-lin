"use client"

import { useState } from "react"
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
import type { Settings } from "@/types"
import { Save } from "lucide-react"

interface SettingsFormProps {
  initialSettings: Settings
}

export function SettingsForm({ initialSettings }: SettingsFormProps) {
  const [settings, setSettings] = useState<Settings>(initialSettings)
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)

  // Proxy fields
  const [proxyPort, setProxyPort] = useState(
    String(settings.proxyConfig?.port ?? 3001)
  )
  const [proxyTarget, setProxyTarget] = useState(
    settings.proxyConfig?.targetUrl ?? "https://api.anthropic.com"
  )

  // Indexed project dir input
  const [newProjectDir, setNewProjectDir] = useState("")

  async function handleSave() {
    setSaving(true)
    setResult(null)
    try {
      const body: Settings = {
        ...settings,
        proxyConfig: {
          enabled: settings.proxyConfig?.enabled ?? false,
          port: parseInt(proxyPort, 10),
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
        setResult({ ok: true, message: "Settings saved" })
      } else {
        setResult({ ok: false, message: json.error ?? "Failed to save" })
      }
    } catch {
      setResult({ ok: false, message: "Network error" })
    } finally {
      setSaving(false)
    }
  }

  function addProjectDir() {
    if (!newProjectDir.trim()) return
    setSettings((s) => ({
      ...s,
      indexedProjects: [...(s.indexedProjects ?? []), newProjectDir.trim()],
    }))
    setNewProjectDir("")
  }

  function removeProjectDir(dir: string) {
    setSettings((s) => ({
      ...s,
      indexedProjects: (s.indexedProjects ?? []).filter((d) => d !== dir),
    }))
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
              onValueChange={(v) =>
                setSettings((s) => ({ ...s, theme: v as Settings["theme"] }))
              }
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
              <p className="text-xs text-muted-foreground">Auto-refresh data every N seconds</p>
            </div>
            <Input
              type="number"
              min={5}
              max={300}
              value={settings.refreshInterval ?? 30}
              onChange={(e) =>
                setSettings((s) => ({
                  ...s,
                  refreshInterval: parseInt(e.target.value, 10),
                }))
              }
              className="w-24"
            />
          </div>
        </CardContent>
      </Card>

      {/* Proxy Config */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Proxy Configuration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label>Enable Proxy</Label>
              <p className="text-xs text-muted-foreground">
                Intercept Anthropic API calls for logging
              </p>
            </div>
            <Switch
              checked={settings.proxyConfig?.enabled ?? false}
              onCheckedChange={(v) =>
                setSettings((s) => ({
                  ...s,
                  proxyConfig: { ...(s.proxyConfig ?? { port: 3001, targetUrl: "https://api.anthropic.com" }), enabled: v },
                }))
              }
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
                placeholder="3001"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="proxy-target">Target URL</Label>
              <Input
                id="proxy-target"
                value={proxyTarget}
                onChange={(e) => setProxyTarget(e.target.value)}
                placeholder="https://api.anthropic.com"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Indexed Projects */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Indexed Project Directories</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Directories scanned by the Knowledge Base. Add absolute paths.
          </p>

          <div className="flex gap-2">
            <Input
              placeholder="/home/user/projects/my-app"
              value={newProjectDir}
              onChange={(e) => setNewProjectDir(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addProjectDir()}
              className="flex-1"
            />
            <Button
              type="button"
              variant="outline"
              onClick={addProjectDir}
              disabled={!newProjectDir.trim()}
            >
              Add
            </Button>
          </div>

          {(settings.indexedProjects ?? []).length === 0 ? (
            <p className="text-xs text-muted-foreground">No directories indexed yet</p>
          ) : (
            <ul className="space-y-1.5">
              {(settings.indexedProjects ?? []).map((dir) => (
                <li
                  key={dir}
                  className="flex items-center justify-between rounded-md bg-muted/30 px-3 py-2"
                >
                  <span className="font-mono text-xs">{dir}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs text-red-400 hover:text-red-300"
                    onClick={() => removeProjectDir(dir)}
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Save */}
      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={saving} className="gap-1.5">
          <Save className="h-3.5 w-3.5" />
          {saving ? "Saving…" : "Save Settings"}
        </Button>
        {result && (
          <p className={`text-xs ${result.ok ? "text-emerald-400" : "text-red-400"}`}>
            {result.message}
          </p>
        )}
      </div>
    </div>
  )
}
