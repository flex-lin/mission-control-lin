/**
 * Shared proxy process manager.
 *
 * Keeps a single module-level reference to the spawned proxy child process so
 * that both /api/settings (auto-start on save) and /api/proxy/control (manual
 * toggle) operate on the same handle, preventing duplicate processes.
 *
 * Note: In Next.js the module is loaded once per server process, so this
 * singleton is valid for the lifetime of the dev/prod server.
 */

import { spawn, type ChildProcess } from "child_process";
import path from "path";

let proxyProcess: ChildProcess | null = null;

/**
 * Spawn the proxy server as a detached child process.
 * No-ops if a process is already running (not killed).
 */
export function spawnProxyProcess(port: number, targetUrl: string): void {
  if (proxyProcess && !proxyProcess.killed) {
    // Already running — nothing to do
    return;
  }

  const proxyScript = path.resolve(process.cwd(), "server/proxy.ts");
  proxyProcess = spawn("npx", ["tsx", proxyScript], {
    env: {
      ...process.env,
      PROXY_PORT: String(port),
      PROXY_TARGET_URL: targetUrl,
    },
    stdio: "ignore",
    detached: true,
  });

  proxyProcess.unref();

  proxyProcess.once("exit", () => {
    proxyProcess = null;
  });
}

/**
 * Kill the running proxy process, if any.
 */
export function killProxyProcess(): void {
  if (proxyProcess && !proxyProcess.killed) {
    proxyProcess.kill("SIGTERM");
    proxyProcess = null;
  }
}

/**
 * Return the current proxy child process (or null if not running via this manager).
 */
export function getProxyProcess(): ChildProcess | null {
  return proxyProcess;
}

/**
 * Check whether this manager believes the proxy is currently running.
 */
export function isProxyRunning(): boolean {
  return proxyProcess !== null && !proxyProcess.killed;
}
