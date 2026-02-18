import net from "net"
import { ok, serverError } from "@/lib/api-helpers"
import { readSettings } from "@/lib/claude-files"

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

    return ok({ running, port, targetUrl })
  } catch (e) {
    return serverError(e)
  }
}
