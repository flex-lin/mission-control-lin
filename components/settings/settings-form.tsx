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
import { Save, RotateCcw, Moon, MessageSquare, Copy, CheckCheck, ExternalLink, ChevronDown, ChevronRight, Plug, Unplug, Loader2, Bot } from "lucide-react"
import type { SlackConfig, SlackConfigInput } from "@/types"

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

  // Env config for ANTHROPIC_BASE_URL (read from proxy status)
  const [envConfigured, setEnvConfigured] = useState(false)
  const [copied, setCopied] = useState(false)

  // Slack config fields
  const [slackConfig, setSlackConfig] = useState<SlackConfig | null>(null)
  const [slackLoading, setSlackLoading] = useState(false)
  const [slackSaving, setSlackSaving] = useState(false)
  const [slackTesting, setSlackTesting] = useState(false)
  const [slackCreatingApp, setSlackCreatingApp] = useState(false)
  const [slackShowAdvanced, setSlackShowAdvanced] = useState(false)
  const [slackInput, setSlackInput] = useState<SlackConfigInput>({
    workspaceId: "",
    workspaceName: "",
    botToken: "",
    signingSecret: "",
    appToken: "",
    channelId: "",
  })

  // OAuth status
  interface OAuthStatus {
    configured: boolean
    subscriptionType: string | null
    rateLimitTier: string | null
    expiresAt: string | null
    valid: boolean
  }
  const [oauthStatus, setOauthStatus] = useState<OAuthStatus | null>(null)

  const fetchOAuthStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/oauth")
      const json = (await res.json()) as { data?: OAuthStatus }
      if (json.data) setOauthStatus(json.data)
    } catch {
      // ignore
    }
  }, [])

  const fetchProxyStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/proxy/status")
      const json = (await res.json()) as { data?: ProxyStatus & { envConfigured?: boolean } }
      if (json.data) {
        setProxyStatus(json.data)
        setEnvConfigured(json.data.envConfigured ?? false)
      }
    } catch {
      // ignore fetch errors
    }
  }, [])

  const fetchSlackConfig = useCallback(async () => {
    setSlackLoading(true)
    try {
      const res = await fetch("/api/slack/config")
      const json = (await res.json()) as { data?: SlackConfig }
      if (res.ok && json.data) {
        setSlackConfig(json.data)
        setSlackInput((prev) => ({
          ...prev,
          workspaceId: json.data?.workspaceId ?? "",
          workspaceName: json.data?.workspaceName ?? "",
          channelId: json.data?.channelId ?? "",
        }))
      }
    } catch {
      // Not configured yet — ignore
    } finally {
      setSlackLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchProxyStatus()
    void fetchSlackConfig()
    void fetchOAuthStatus()
  }, [fetchProxyStatus, fetchSlackConfig, fetchOAuthStatus])

  async function handleProxyToggle(enable: boolean) {
    setProxyLoading(true)
    const action = enable ? "start" : "stop"
    const port = parseInt(proxyPort, 10) || DEFAULT_PROXY_PORT
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

      // Persist the enabled state to settings
      // (proxy/control route already sets ANTHROPIC_BASE_URL in .claude/settings.json)
      const settingsBody: Settings = {
        ...settings,
        proxyConfig: {
          enabled: enable,
          port,
          targetUrl: proxyTarget,
        },
      }
      await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settingsBody),
      })
      await refetchContext()

      setSettings((s) => ({
        ...s,
        proxyConfig: {
          ...(s.proxyConfig ?? { port: DEFAULT_PROXY_PORT, targetUrl: DEFAULT_PROXY_TARGET }),
          enabled: enable,
        },
      }))
      toast.success(
        enable
          ? "Proxy started — tracking active for this directory"
          : "Proxy stopped — Claude Code connects directly to Anthropic"
      )
    } catch {
      toast.error(`Failed to ${action} proxy`)
    } finally {
      setProxyLoading(false)
    }
  }

  async function handleCopy(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      toast.success("Copied to clipboard")
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error("Failed to copy")
    }
  }

  async function handleSlackCreateApp() {
    setSlackCreatingApp(true)
    try {
      const res = await fetch("/api/slack/manifest")
      const json = (await res.json()) as { data?: { manifest_json: unknown; create_url: string } }
      if (res.ok && json.data?.create_url) {
        window.open(json.data.create_url, "_blank", "noopener")
        toast.success("Slack App creation page opened in a new tab")
      } else {
        toast.error("Failed to generate Slack App manifest")
      }
    } catch {
      toast.error("Network error — could not fetch manifest")
    } finally {
      setSlackCreatingApp(false)
    }
  }

  async function handleSlackSave() {
    if (!slackInput.appToken) {
      toast.error("App-Level Token is required for Socket Mode")
      return
    }
    if (!slackInput.appToken.startsWith("xapp-")) {
      toast.error("App-Level Token must start with xapp-")
      return
    }
    if (!slackInput.botToken) {
      toast.error("Bot Token is required")
      return
    }
    if (slackInput.botToken && !slackInput.botToken.startsWith("xoxb-")) {
      toast.error("Bot Token must start with xoxb-")
      return
    }
    setSlackSaving(true)
    try {
      const body: SlackConfigInput = {
        appToken: slackInput.appToken,
        botToken: slackInput.botToken,
        workspaceId: slackInput.workspaceId || "auto",
        ...(slackInput.signingSecret ? { signingSecret: slackInput.signingSecret } : {}),
        ...(slackInput.workspaceName ? { workspaceName: slackInput.workspaceName } : {}),
        ...(slackInput.channelId ? { channelId: slackInput.channelId } : {}),
      }
      const res = await fetch("/api/slack/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const json = (await res.json()) as { data?: SlackConfig; error?: string }
      if (res.ok && json.data) {
        setSlackConfig(json.data)
        setSlackInput((prev) => ({ ...prev, appToken: "", botToken: "", signingSecret: "" }))
        toast.success("Slack connected via Socket Mode")
      } else {
        toast.error(json.error ?? "Failed to save Slack configuration")
      }
    } catch {
      toast.error("Network error — could not save Slack configuration")
    } finally {
      setSlackSaving(false)
    }
  }

  async function handleSlackDelete() {
    if (!slackConfig) return
    setSlackSaving(true)
    try {
      const res = await fetch("/api/slack/config", { method: "DELETE" })
      if (res.ok) {
        setSlackConfig(null)
        setSlackInput({ workspaceId: "", workspaceName: "", botToken: "", signingSecret: "", appToken: "", channelId: "" })
        setSlackShowAdvanced(false)
        toast.success("Slack configuration removed")
      } else {
        const json = (await res.json()) as { error?: string }
        toast.error(json.error ?? "Failed to remove Slack configuration")
      }
    } catch {
      toast.error("Network error — could not remove Slack configuration")
    } finally {
      setSlackSaving(false)
    }
  }

  async function handleSlackTest() {
    setSlackTesting(true)
    try {
      const res = await fetch("/api/slack/config")
      const json = (await res.json()) as { data?: SlackConfig; error?: string }
      if (!res.ok || !json.data) {
        toast.error("No Slack configuration found — save config first")
        return
      }
      setSlackConfig(json.data)
      if (json.data.socketConnected) {
        toast.success(`Socket Mode connected to workspace: ${json.data.workspaceName || json.data.workspaceId}`)
      } else {
        toast.error("Socket Mode is not connected — check your App-Level Token")
      }
    } catch {
      toast.error("Failed to test Slack connection")
    } finally {
      setSlackTesting(false)
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

      {/* Chat Assistant */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Bot className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-sm font-semibold">Chat Assistant</CardTitle>
            </div>
            {oauthStatus?.configured && oauthStatus.valid && (
              <div className="flex items-center gap-2">
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-xs text-muted-foreground">
                  OAuth connected — {oauthStatus.rateLimitTier?.replace(/_/g, " ") ?? oauthStatus.subscriptionType}
                </span>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Choose how the chat assistant authenticates with Claude. OAuth uses your Claude subscription at no extra API cost.
          </p>

          <div className="flex items-center justify-between">
            <div>
              <Label>Provider</Label>
              <p className="text-xs text-muted-foreground">
                {(settings.chatProvider ?? "claude-oauth") === "claude-oauth"
                  ? "Using your Claude subscription via OAuth"
                  : "Using ANTHROPIC_API_KEY environment variable"}
              </p>
            </div>
            <Select
              value={settings.chatProvider ?? "claude-oauth"}
              onValueChange={(v) =>
                setSettings((s) => ({ ...s, chatProvider: v as Settings["chatProvider"] }))
              }
            >
              <SelectTrigger className="w-52">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="claude-oauth">Claude Subscription (OAuth)</SelectItem>
                <SelectItem value="api">API Key</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {(settings.chatProvider ?? "claude-oauth") === "claude-oauth" && oauthStatus && (
            <>
              <Separator />
              <div className={`rounded-md border p-3 text-xs space-y-1 ${
                oauthStatus.configured && oauthStatus.valid
                  ? "border-emerald-500/30 bg-emerald-500/5"
                  : "border-yellow-500/30 bg-yellow-500/5"
              }`}>
                {oauthStatus.configured && oauthStatus.valid ? (
                  <>
                    <p className="font-medium text-emerald-400">OAuth Active</p>
                    <p className="text-muted-foreground">
                      Subscription: {oauthStatus.subscriptionType} &middot; Tier: {oauthStatus.rateLimitTier?.replace(/_/g, " ")}
                    </p>
                    <p className="text-muted-foreground/70 text-[11px]">
                      Token expires {new Date(oauthStatus.expiresAt!).toLocaleDateString()}
                    </p>
                  </>
                ) : oauthStatus.configured ? (
                  <>
                    <p className="font-medium text-yellow-400">OAuth Token Expired</p>
                    <p className="text-muted-foreground">
                      Re-authenticate with <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">claude</code> CLI to refresh the token.
                      The assistant will fall back to API key if available.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="font-medium text-yellow-400">OAuth Not Configured</p>
                    <p className="text-muted-foreground">
                      No credentials found at <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">~/.claude/.credentials.json</code>.
                      Log in with <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">claude</code> CLI first.
                    </p>
                  </>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Proxy Config */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold">Proxy &amp; Usage Tracking</CardTitle>
            <div className="flex items-center gap-2">
              <span
                className={`inline-block h-2.5 w-2.5 rounded-full ${
                  proxyStatus?.running ? "bg-emerald-500 animate-pulse" : "bg-red-500"
                }`}
              />
              <span className="text-xs text-muted-foreground">
                {proxyStatus?.running
                  ? `Tracking on port ${proxyStatus.port}`
                  : "Not tracking"}
              </span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            When enabled, all Anthropic API calls from Claude Code in this directory
            are routed through the proxy for token usage tracking. When disabled, Claude
            Code connects directly to Anthropic without interference.
          </p>

          <div className="flex items-center justify-between">
            <div>
              <Label>Enable Usage Tracking</Label>
              <p className="text-xs text-muted-foreground">
                {proxyLoading
                  ? (proxyStatus?.running ? "Stopping proxy..." : "Starting proxy...")
                  : proxyStatus?.running
                    ? "Proxy running — API calls are being tracked"
                    : "Proxy stopped — Claude Code connects directly to Anthropic"}
              </p>
            </div>
            <Switch
              checked={proxyStatus?.running ?? false}
              disabled={proxyLoading}
              onCheckedChange={handleProxyToggle}
            />
          </div>

          {/* Tracking status info box */}
          {proxyStatus?.running && (
            <>
              <Separator />
              <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs space-y-2">
                <p className="font-medium text-emerald-400">Tracking Active</p>
                <p className="text-muted-foreground">
                  ANTHROPIC_BASE_URL is {envConfigured ? "configured" : "not yet configured"} in{" "}
                  <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">.claude/settings.json</code>.
                  {envConfigured
                    ? " New Claude Code sessions in this directory will route through the proxy automatically."
                    : " Set the env variable below for Claude Code to use the proxy."}
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 rounded bg-muted px-2 py-1.5 font-mono text-[11px] text-foreground">
                    ANTHROPIC_BASE_URL=http://localhost:{proxyStatus.port}
                  </code>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 shrink-0"
                    onClick={() => handleCopy(`export ANTHROPIC_BASE_URL=http://localhost:${proxyStatus.port}`)}
                  >
                    {copied ? (
                      <CheckCheck className="h-3.5 w-3.5 text-emerald-500" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </div>
                <p className="text-muted-foreground/70 text-[11px]">
                  Already-running sessions need to be restarted to pick up this change.
                </p>
              </div>
            </>
          )}

          {!proxyStatus?.running && envConfigured && (
            <>
              <Separator />
              <div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 text-xs space-y-1">
                <p className="font-medium text-yellow-400">Env Still Configured</p>
                <p className="text-muted-foreground">
                  ANTHROPIC_BASE_URL is still set in{" "}
                  <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">.claude/settings.json</code>{" "}
                  but the proxy is not running. Claude Code may fail to connect. The env variable
                  will be removed automatically when the proxy is stopped via the toggle above.
                </p>
              </div>
            </>
          )}

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

      {/* Slack Integration */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-sm font-semibold">Slack Integration</CardTitle>
            </div>
            <div className="flex items-center gap-2">
              <span
                className={`inline-block h-2.5 w-2.5 rounded-full ${
                  slackConfig?.socketConnected
                    ? "bg-emerald-500 animate-pulse"
                    : slackConfig
                      ? "bg-yellow-500"
                      : "bg-slate-400"
                }`}
              />
              <span className="text-xs text-muted-foreground">
                {slackLoading
                  ? "Loading..."
                  : slackConfig?.socketConnected
                    ? `Socket Mode connected${slackConfig.workspaceName ? ` — ${slackConfig.workspaceName}` : ""}`
                    : slackConfig
                      ? "Configured but not connected"
                      : "Not configured"}
              </span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Connected state */}
          {slackConfig && (
            <div className={`rounded-md border p-3 text-xs space-y-2 ${
              slackConfig.socketConnected
                ? "border-emerald-500/30 bg-emerald-500/5"
                : "border-yellow-500/30 bg-yellow-500/5"
            }`}>
              <div className="flex items-center justify-between">
                <p className={`font-medium ${slackConfig.socketConnected ? "text-emerald-400" : "text-yellow-400"}`}>
                  {slackConfig.socketConnected ? "Socket Mode Connected" : "Socket Mode Disconnected"}
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 gap-1 text-xs"
                    onClick={handleSlackTest}
                    disabled={slackTesting}
                  >
                    {slackTesting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plug className="h-3 w-3" />}
                    Test
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 gap-1 text-xs text-destructive hover:text-destructive"
                    onClick={handleSlackDelete}
                    disabled={slackSaving}
                  >
                    <Unplug className="h-3 w-3" />
                    Disconnect
                  </Button>
                </div>
              </div>
              <div className="text-muted-foreground space-y-0.5">
                {slackConfig.workspaceName && <p>Workspace: {slackConfig.workspaceName}</p>}
                <p>Workspace ID: {slackConfig.workspaceId}</p>
                {slackConfig.botToken && <p>Bot Token: {slackConfig.botToken}</p>}
                {slackConfig.appToken && <p>App Token: {slackConfig.appToken}</p>}
              </div>
            </div>
          )}

          {/* Setup wizard (shown when not connected) */}
          {!slackConfig && (
            <>
              <p className="text-xs text-muted-foreground">
                Connect a Slack workspace via Socket Mode — no public URL required. Follow the steps below.
              </p>

              {/* Step 1: Create Slack App */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">1</span>
                  <Label className="text-sm font-medium">Create Slack App</Label>
                </div>
                <p className="text-xs text-muted-foreground ml-7">
                  Click to create a pre-configured Slack App with the right permissions. Pick your workspace and click &quot;Create&quot;.
                </p>
                <div className="ml-7">
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={handleSlackCreateApp}
                    disabled={slackCreatingApp}
                  >
                    {slackCreatingApp ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ExternalLink className="h-3.5 w-3.5" />}
                    Create Slack App
                  </Button>
                </div>
              </div>

              <Separator />

              {/* Step 2: Enter Credentials */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">2</span>
                  <Label className="text-sm font-medium">Enter Credentials</Label>
                </div>

                <div className="ml-7 space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="slack-app-token">App-Level Token</Label>
                    <Input
                      id="slack-app-token"
                      type="password"
                      value={slackInput.appToken ?? ""}
                      onChange={(e) => setSlackInput((prev) => ({ ...prev, appToken: e.target.value }))}
                      placeholder="xapp-..."
                      autoComplete="off"
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Basic Information &rarr; App-Level Tokens &rarr; Generate with <code className="rounded bg-muted px-1 py-0.5">connections:write</code> scope
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="slack-bot-token">Bot Token</Label>
                    <Input
                      id="slack-bot-token"
                      type="password"
                      value={slackInput.botToken}
                      onChange={(e) => setSlackInput((prev) => ({ ...prev, botToken: e.target.value }))}
                      placeholder="xoxb-..."
                      autoComplete="off"
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Install App &rarr; Install to Workspace &rarr; copy Bot User OAuth Token
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <button
                      type="button"
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                      onClick={() => setSlackShowAdvanced((v) => !v)}
                    >
                      {slackShowAdvanced ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                      Optional: Signing Secret, Workspace ID, Channel ID
                    </button>
                    {slackShowAdvanced && (
                      <div className="space-y-3 pt-1">
                        <div className="space-y-1.5">
                          <Label htmlFor="slack-signing-secret">Signing Secret</Label>
                          <Input
                            id="slack-signing-secret"
                            type="password"
                            value={slackInput.signingSecret ?? ""}
                            onChange={(e) => setSlackInput((prev) => ({ ...prev, signingSecret: e.target.value }))}
                            placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                            autoComplete="off"
                          />
                          <p className="text-[11px] text-muted-foreground">
                            Basic Information &rarr; App Credentials (optional for Socket Mode)
                          </p>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="space-y-1.5">
                            <Label htmlFor="slack-workspace-id">Workspace ID</Label>
                            <Input
                              id="slack-workspace-id"
                              value={slackInput.workspaceId}
                              onChange={(e) => setSlackInput((prev) => ({ ...prev, workspaceId: e.target.value }))}
                              placeholder="Auto-detected from token"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label htmlFor="slack-channel-id">Default Channel ID</Label>
                            <Input
                              id="slack-channel-id"
                              value={slackInput.channelId ?? ""}
                              onChange={(e) => setSlackInput((prev) => ({ ...prev, channelId: e.target.value }))}
                              placeholder="C0XXXXXXX"
                            />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <Separator />

              {/* Step 3: Connect */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">3</span>
                  <Label className="text-sm font-medium">Connect</Label>
                </div>
                <div className="ml-7">
                  <Button
                    onClick={handleSlackSave}
                    disabled={slackSaving || !slackInput.appToken || !slackInput.botToken}
                    className="gap-1.5"
                  >
                    {slackSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plug className="h-3.5 w-3.5" />}
                    {slackSaving ? "Connecting..." : "Save & Connect"}
                  </Button>
                </div>
              </div>
            </>
          )}

          {/* Update credentials (when already connected) */}
          {slackConfig && (
            <>
              <Separator />
              <button
                type="button"
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => setSlackShowAdvanced((v) => !v)}
              >
                {slackShowAdvanced ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                Update credentials
              </button>
              {slackShowAdvanced && (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="slack-app-token-update">App-Level Token</Label>
                    <Input
                      id="slack-app-token-update"
                      type="password"
                      value={slackInput.appToken ?? ""}
                      onChange={(e) => setSlackInput((prev) => ({ ...prev, appToken: e.target.value }))}
                      placeholder="xapp-... (enter new value to replace)"
                      autoComplete="off"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="slack-bot-token-update">Bot Token</Label>
                    <Input
                      id="slack-bot-token-update"
                      type="password"
                      value={slackInput.botToken}
                      onChange={(e) => setSlackInput((prev) => ({ ...prev, botToken: e.target.value }))}
                      placeholder="xoxb-... (enter new value to replace)"
                      autoComplete="off"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="slack-signing-secret-update">Signing Secret (optional)</Label>
                    <Input
                      id="slack-signing-secret-update"
                      type="password"
                      value={slackInput.signingSecret ?? ""}
                      onChange={(e) => setSlackInput((prev) => ({ ...prev, signingSecret: e.target.value }))}
                      placeholder="Enter new value to replace"
                      autoComplete="off"
                    />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="slack-workspace-id-update">Workspace ID</Label>
                      <Input
                        id="slack-workspace-id-update"
                        value={slackInput.workspaceId}
                        onChange={(e) => setSlackInput((prev) => ({ ...prev, workspaceId: e.target.value }))}
                        placeholder="T0XXXXXXX"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="slack-channel-id-update">Default Channel ID</Label>
                      <Input
                        id="slack-channel-id-update"
                        value={slackInput.channelId ?? ""}
                        onChange={(e) => setSlackInput((prev) => ({ ...prev, channelId: e.target.value }))}
                        placeholder="C0XXXXXXX"
                      />
                    </div>
                  </div>
                  <Button
                    onClick={handleSlackSave}
                    disabled={slackSaving || !slackInput.appToken || !slackInput.botToken}
                    size="sm"
                    className="gap-1.5"
                  >
                    {slackSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                    {slackSaving ? "Saving..." : "Update & Reconnect"}
                  </Button>
                </div>
              )}
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
