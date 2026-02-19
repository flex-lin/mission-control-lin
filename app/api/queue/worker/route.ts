/**
 * Queue Worker control API.
 * GET  — check if the mc-queue-worker tmux session is running
 * POST — start (or restart) the worker in a persistent tmux daemon session
 * DELETE — stop the worker tmux session
 */
import { NextResponse } from "next/server";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { ok, serverError } from "@/lib/api-helpers";

const SESSION = "mc-queue-worker";
const HEARTBEAT_PATH = path.join(process.env.HOME ?? "/root", ".claude", "queue-worker.heartbeat");
const STALE_THRESHOLD_MS = 30_000;
const START_SCRIPT = path.join(process.cwd(), "scripts", "start-queue-daemon.sh");

function tmuxSessionAlive(): boolean {
  try {
    execSync(`tmux has-session -t '${SESSION}' 2>/dev/null`, { timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

function heartbeatFresh(): { fresh: boolean; lastHeartbeat: string | null } {
  try {
    const hb = fs.readFileSync(HEARTBEAT_PATH, "utf-8").trim();
    return {
      fresh: Date.now() - new Date(hb).getTime() < STALE_THRESHOLD_MS,
      lastHeartbeat: hb,
    };
  } catch {
    return { fresh: false, lastHeartbeat: null };
  }
}

export async function GET(): Promise<NextResponse> {
  try {
    const sessionAlive = tmuxSessionAlive();
    const { fresh, lastHeartbeat } = heartbeatFresh();
    return ok({
      sessionAlive,
      heartbeatFresh: fresh,
      lastHeartbeat,
      sessionName: SESSION,
      attachCmd: `tmux attach-session -t ${SESSION}`,
    });
  } catch (e) {
    return serverError(e);
  }
}

export async function POST(): Promise<NextResponse> {
  try {
    execSync(`bash '${START_SCRIPT}'`, { timeout: 10_000, stdio: "pipe" });
    return ok({ started: true, sessionName: SESSION, attachCmd: `tmux attach-session -t ${SESSION}` });
  } catch (e) {
    return serverError(e);
  }
}

export async function DELETE(): Promise<NextResponse> {
  try {
    execSync(`tmux kill-session -t '${SESSION}' 2>/dev/null || true`, {
      timeout: 5_000,
      shell: "/bin/bash",
    });
    return ok({ stopped: true });
  } catch (e) {
    return serverError(e);
  }
}
