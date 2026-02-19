import { ok, err, serverError, validateUrl } from "@/lib/api-helpers"
import { readSettings, setProjectProxyEnv } from "@/lib/claude-files"
import { spawnProxyProcess, killProxyProcess, isProxyRunning } from "@/lib/proxy-manager"
import { NextRequest } from "next/server"

export const dynamic = "force-dynamic"

interface ControlBody {
  action: "start" | "stop"
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as ControlBody

    if (body.action !== "start" && body.action !== "stop") {
      return err("Invalid action. Must be 'start' or 'stop'.", "INVALID_ACTION")
    }

    if (body.action === "start") {
      if (isProxyRunning()) {
        return err("Proxy is already running.", "ALREADY_RUNNING")
      }

      const settings = readSettings()
      const port = settings.proxyConfig?.port ?? 8787
      const targetUrl = settings.proxyConfig?.targetUrl ?? "https://api.anthropic.com"

      // Validate targetUrl to prevent SSRF
      const urlCheck = validateUrl(targetUrl, "targetUrl")
      if (!urlCheck.valid) return urlCheck.error

      spawnProxyProcess(port, targetUrl)

      // Set ANTHROPIC_BASE_URL in project settings so Claude Code routes through proxy
      setProjectProxyEnv(`http://localhost:${port}`)

      return ok({ success: true, action: "start", port })
    }

    // action === "stop"
    if (!isProxyRunning()) {
      return err("Proxy is not running.", "NOT_RUNNING")
    }

    killProxyProcess()

    // Remove ANTHROPIC_BASE_URL so Claude Code goes directly to Anthropic
    setProjectProxyEnv(null)

    return ok({ success: true, action: "stop" })
  } catch (e) {
    return serverError(e)
  }
}
