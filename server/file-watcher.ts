import path from "path"
import os from "os"
import chokidar, { FSWatcher } from "chokidar"
import { EventEmitter } from "events"

export type WatchEvent = {
  type: "add" | "change" | "unlink" | "addDir" | "unlinkDir"
  filePath: string
  relativePath: string
  timestamp: string
}

export type WatchEventHandler = (event: WatchEvent) => void

const CLAUDE_DIR = path.join(os.homedir(), ".claude")

class FileWatcherService extends EventEmitter {
  private watcher: FSWatcher | null = null
  private watchedPaths: Set<string> = new Set()
  private isRunning = false

  start(additionalPaths: string[] = []): void {
    if (this.isRunning) return

    const pathsToWatch = [
      path.join(CLAUDE_DIR, "teams"),
      path.join(CLAUDE_DIR, "tasks"),
      path.join(CLAUDE_DIR, "settings.json"),
      path.join(CLAUDE_DIR, "settings.local.json"),
      ...additionalPaths,
    ].filter((p) => {
      try {
        require("fs").accessSync(p)
        return true
      } catch {
        return false
      }
    })

    this.watcher = chokidar.watch(pathsToWatch, {
      persistent: true,
      ignoreInitial: true,
      depth: 4,
      awaitWriteFinish: {
        stabilityThreshold: 200,
        pollInterval: 100,
      },
    })

    const makeEvent = (type: WatchEvent["type"], filePath: string): WatchEvent => ({
      type,
      filePath,
      relativePath: filePath.startsWith(CLAUDE_DIR)
        ? filePath.slice(CLAUDE_DIR.length + 1)
        : filePath,
      timestamp: new Date().toISOString(),
    })

    this.watcher
      .on("add", (p) => this.emit("change", makeEvent("add", p)))
      .on("change", (p) => this.emit("change", makeEvent("change", p)))
      .on("unlink", (p) => this.emit("change", makeEvent("unlink", p)))
      .on("addDir", (p) => this.emit("change", makeEvent("addDir", p)))
      .on("unlinkDir", (p) => this.emit("change", makeEvent("unlinkDir", p)))
      .on("error", (err) => this.emit("error", err))

    pathsToWatch.forEach((p) => this.watchedPaths.add(p))
    this.isRunning = true
  }

  stop(): Promise<void> {
    if (!this.watcher) return Promise.resolve()
    this.isRunning = false
    this.watchedPaths.clear()
    return this.watcher.close()
  }

  addPath(watchPath: string): void {
    if (!this.watcher || this.watchedPaths.has(watchPath)) return
    this.watcher.add(watchPath)
    this.watchedPaths.add(watchPath)
  }

  removePath(watchPath: string): void {
    if (!this.watcher || !this.watchedPaths.has(watchPath)) return
    this.watcher.unwatch(watchPath)
    this.watchedPaths.delete(watchPath)
  }

  getWatchedPaths(): string[] {
    return Array.from(this.watchedPaths)
  }

  get running(): boolean {
    return this.isRunning
  }
}

// Singleton for use across the app
declare global {
  // eslint-disable-next-line no-var
  var __fileWatcher: FileWatcherService | undefined
}

export const fileWatcher: FileWatcherService =
  globalThis.__fileWatcher ?? new FileWatcherService()

if (process.env.NODE_ENV !== "production") {
  globalThis.__fileWatcher = fileWatcher
}
