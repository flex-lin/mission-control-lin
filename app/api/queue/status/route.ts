import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { ok, serverError } from "@/lib/api-helpers";
import { db } from "@/lib/db";

const CLAUDE_DIR = path.join(process.env.HOME ?? "/root", ".claude");
const HEARTBEAT_PATH = path.join(CLAUDE_DIR, "queue-worker.heartbeat");
const STALE_THRESHOLD_MS = 30_000; // Worker heartbeat is stale after 30s

export async function GET(): Promise<NextResponse> {
  try {
    // Check worker heartbeat
    let workerRunning = false;
    let lastHeartbeat: string | null = null;

    try {
      const heartbeat = fs.readFileSync(HEARTBEAT_PATH, "utf-8").trim();
      lastHeartbeat = heartbeat;
      const heartbeatTime = new Date(heartbeat).getTime();
      workerRunning = Date.now() - heartbeatTime < STALE_THRESHOLD_MS;
    } catch {
      // No heartbeat file — worker not running
    }

    // Queue stats
    const [pending, running, completed, failed] = await Promise.all([
      db.queuedTask.count({ where: { status: "pending" } }),
      db.queuedTask.count({ where: { status: "running" } }),
      db.queuedTask.count({ where: { status: "completed" } }),
      db.queuedTask.count({ where: { status: "failed" } }),
    ]);

    // Current running task
    const currentTask = await db.queuedTask.findFirst({
      where: { status: "running" },
      orderBy: { startedAt: "desc" },
    });

    return ok({
      workerRunning,
      lastHeartbeat,
      queueDepth: pending,
      counts: { pending, running, completed, failed },
      currentTask: currentTask
        ? { id: currentTask.id, goal: currentTask.goal, teamName: currentTask.teamName, startedAt: currentTask.startedAt }
        : null,
    });
  } catch (e) {
    return serverError(e);
  }
}
