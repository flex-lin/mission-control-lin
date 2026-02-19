"use client"

import { useState, useEffect, useCallback } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { toast } from "sonner"
import { Radio, Settings, Copy, CheckCheck } from "lucide-react"

interface ProxyStatusInfo {
  running: boolean
  port: number
  targetUrl: string
  envConfigured?: boolean
}

interface ProxyStatusBannerProps {
  /** If true, always renders compact inline status rather than full banner */
  compact?: boolean
}

export function ProxyStatusBanner({ compact = false }: ProxyStatusBannerProps) {
  const [status, setStatus] = useState<ProxyStatusInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)
  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/proxy/status", { cache: "no-store" })
      const json = (await res.json()) as { data?: ProxyStatusInfo }
      if (json.data) setStatus(json.data)
    } catch {
      // ignore — status stays null
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchStatus()
  }, [fetchStatus])

  const envConfigured = status?.envConfigured ?? false

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

  if (loading) return null

  // ── Compact inline status indicator ──────────────────────────────────────────
  if (compact) {
    return (
      <div className="flex items-center gap-2">
        <span
          className={`inline-block h-2 w-2 rounded-full ${
            status?.running ? "bg-emerald-500 animate-pulse" : "bg-red-500"
          }`}
        />
        <span className="text-xs text-muted-foreground">
          {status?.running
            ? `Tracking on :${status.port}${envConfigured ? " (auto-configured)" : ""}`
            : "Not tracking — direct to Anthropic"}
        </span>
      </div>
    )
  }

  // ── Full banner when proxy is not running ─────────────────────────────────────
  if (status?.running) {
    return (
      <Alert className="border-emerald-500/30 bg-emerald-500/5">
        <Radio className="h-4 w-4 text-emerald-500" />
        <AlertTitle className="flex items-center gap-2 text-sm font-semibold">
          Proxy Active
          <Badge variant="outline" className="border-emerald-500/40 text-emerald-400 text-[10px]">
            Port {status.port}
          </Badge>
        </AlertTitle>
        <AlertDescription className="mt-1 text-xs text-muted-foreground">
          {envConfigured ? (
            <>
              The proxy is capturing all Anthropic API traffic and counting tokens in real time.
              ANTHROPIC_BASE_URL is configured in{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">.claude/settings.json</code>
              {" "}&mdash; new Claude Code sessions in this directory will route through the proxy automatically.
            </>
          ) : (
            <>
              The proxy is capturing all Anthropic API traffic and counting tokens in real time.
              Point Claude Code to{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
                http://localhost:{status.port}
              </code>{" "}
              via the{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
                ANTHROPIC_BASE_URL
              </code>{" "}
              environment variable to enable tracking.
            </>
          )}
        </AlertDescription>
      </Alert>
    )
  }

  // Proxy is not running
  const envVar = `ANTHROPIC_BASE_URL=http://localhost:8787`
  return (
    <Alert className="border-yellow-500/30 bg-yellow-500/5">
      <Radio className="h-4 w-4 text-yellow-500" />
      <AlertTitle className="text-sm font-semibold">Proxy Not Running — Token Capture Disabled</AlertTitle>
      <AlertDescription className="mt-2 space-y-3 text-xs text-muted-foreground">
        <p>
          Token tracking via the proxy is currently <strong className="text-foreground">off</strong>.
          Analytics data will only show historical records already in the database. Enable the proxy
          in Settings to start capturing live Anthropic API traffic.
        </p>
        <p className="text-foreground font-medium">To capture tokens from Claude Code:</p>
        <ol className="space-y-1.5 list-decimal list-inside">
          <li>
            Enable the proxy on the{" "}
            <Link href="/settings" className="underline underline-offset-2 text-foreground hover:text-primary">
              Settings page
            </Link>
          </li>
          <li>
            Set the environment variable in your shell or{" "}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">.env</code>:
            <div className="mt-1.5 flex items-center gap-2">
              <code className="flex-1 rounded bg-muted px-2 py-1.5 font-mono text-[11px] text-foreground">
                {envVar}
              </code>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 shrink-0"
                onClick={() => handleCopy(envVar)}
              >
                {copied ? (
                  <CheckCheck className="h-3.5 w-3.5 text-emerald-500" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </Button>
            </div>
          </li>
          <li>Run Claude Code — all API calls will be intercepted and counted</li>
        </ol>
        <div className="pt-1">
          <Link href="/settings">
            <Button size="sm" variant="outline" className="gap-1.5 h-7 text-xs">
              <Settings className="h-3.5 w-3.5" />
              Go to Settings
            </Button>
          </Link>
        </div>
      </AlertDescription>
    </Alert>
  )
}
