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

    // Start queue worker in the background — picks up queued tasks automatically
    const { startQueueWorker } = await import("@/server/queue-worker")
    startQueueWorker()
  }
}
