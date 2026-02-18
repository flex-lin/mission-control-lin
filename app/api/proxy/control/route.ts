import { spawn, type ChildProcess } from "child_process"
import path from "path"
import { ok, err, serverError } from "@/lib/api-helpers"
import { readSettings } from "@/lib/claude-files"
import { NextRequest } from "next/server"

export const dynamic = "force-dynamic"

let proxyProcess: ChildProcess | null = null

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
      if (proxyProcess && !proxyProcess.killed) {
        return err("Proxy is already running.", "ALREADY_RUNNING")
      }

      const settings = readSettings()
      const port = String(settings.proxyConfig?.port ?? 8787)
      const targetUrl = settings.proxyConfig?.targetUrl ?? "https://api.anthropic.com"

      const proxyScript = path.resolve(process.cwd(), "server/proxy.ts")
      proxyProcess = spawn("npx", ["tsx", proxyScript], {
        env: {
          ...process.env,
          PROXY_PORT: port,
          PROXY_TARGET_URL: targetUrl,
        },
        stdio: "ignore",
        detached: true,
      })

      proxyProcess.unref()

      proxyProcess.once("exit", () => {
        proxyProcess = null
      })

      return ok({ success: true, action: "start", port: parseInt(port, 10) })
    }

    // action === "stop"
    if (!proxyProcess || proxyProcess.killed) {
      return err("Proxy is not running.", "NOT_RUNNING")
    }

    proxyProcess.kill("SIGTERM")
    proxyProcess = null

    return ok({ success: true, action: "stop" })
  } catch (e) {
    return serverError(e)
  }
}
