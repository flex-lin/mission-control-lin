import net from "net"
import { ok, serverError } from "@/lib/api-helpers"
import { readSettings, readProjectClaudeSettings } from "@/lib/claude-files"

export const dynamic = "force-dynamic"

function checkPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    socket.setTimeout(1000)
    socket.once("connect", () => {
      socket.destroy()
      resolve(true)
    })
    socket.once("timeout", () => {
      socket.destroy()
      resolve(false)
    })
    socket.once("error", () => {
      socket.destroy()
      resolve(false)
    })
    socket.connect(port, "127.0.0.1")
  })
}

export async function GET() {
  try {
    const settings = readSettings()
    const port = settings.proxyConfig?.port ?? 8787
    const targetUrl = settings.proxyConfig?.targetUrl ?? "https://api.anthropic.com"
    const running = await checkPort(port)

    // Check if project-level env is configured to route through proxy
    const projectSettings = readProjectClaudeSettings()
    const envConfigured = !!projectSettings.env?.ANTHROPIC_BASE_URL
    const configuredBaseUrl = projectSettings.env?.ANTHROPIC_BASE_URL ?? null

    return ok({ running, port, targetUrl, envConfigured, configuredBaseUrl })
  } catch (e) {
    return serverError(e)
  }
}
