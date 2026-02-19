/**
 * Next.js instrumentation — runs once when the server starts.
 * https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { fileWatcher } = await import("@/server/file-watcher")
    if (!fileWatcher.running) {
      fileWatcher.start()
    }

    // Auto-start Slack Socket Mode if configured
    void autoStartSocketMode()
  }
}

async function autoStartSocketMode(): Promise<void> {
  try {
    const { db } = await import("@/lib/db")
    const configs = await db.slackConfig.findMany({ take: 1 })
    const config = configs[0]

    if (config?.appToken && config.botToken) {
      const { startSocketMode } = await import("@/lib/slack-socket")
      await startSocketMode(config.appToken, config.botToken)
      console.log("[instrumentation] Slack Socket Mode auto-started")
    }
  } catch (e) {
    // Don't crash the server if Slack connection fails
    const message = e instanceof Error ? e.message : String(e)
    console.warn("[instrumentation] Failed to auto-start Slack Socket Mode:", message)
  }
}
