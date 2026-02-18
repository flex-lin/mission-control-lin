/**
 * Queue Worker — runs inside the Next.js process (via instrumentation.ts)
 * or standalone (via pnpm queue).
 *
 * Picks up queued tasks one at a time per repository. Spawns Claude teams,
 * monitors completion, then moves to the next task.
 */
import path from "path";
import fs from "fs";
import Database from "better-sqlite3";

// ── Types ────────────────────────────────────────────────────────────────────

interface QueuedTaskRow {
  id: number;
  goal: string;
  project_path: string;
  status: string;
  team_name: string | null;
  priority: number;
  result: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

interface TaskFileData {
  id: string;
  status: string;
  subject?: string;
}

// ── Config ───────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 10_000;       // Check queue every 10s
const MONITOR_INTERVAL_MS = 30_000;    // Check team status every 30s
const TASK_TIMEOUT_MS = 60 * 60_000;   // 60 min max per task
const CLAUDE_DIR = path.join(process.env.HOME ?? "/root", ".claude");
const HEARTBEAT_PATH = path.join(CLAUDE_DIR, "queue-worker.heartbeat");

// Singleton guard — prevent multiple instances in dev mode hot reloads
let workerRunning = false;

// ── Database ─────────────────────────────────────────────────────────────────

function getDbPath(): string {
  // Works from both Next.js (cwd = project root) and standalone
  return path.resolve(process.cwd(), "prisma/mission-control.db");
}

function openDb(): Database.Database {
  const db = new Database(getDbPath());
  db.exec(`
    CREATE TABLE IF NOT EXISTS queued_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      goal TEXT NOT NULL,
      project_path TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      team_name TEXT,
      priority INTEGER NOT NULL DEFAULT 0,
      result TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      started_at TEXT,
      completed_at TEXT
    )
  `);
  return db;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function writeHeartbeat(): void {
  try {
    fs.mkdirSync(path.dirname(HEARTBEAT_PATH), { recursive: true });
    fs.writeFileSync(HEARTBEAT_PATH, new Date().toISOString(), "utf-8");
  } catch {
    // Non-critical
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readTeamTasks(teamName: string): TaskFileData[] {
  const taskDir = path.join(CLAUDE_DIR, "tasks", teamName);
  if (!fs.existsSync(taskDir)) return [];

  const files = fs.readdirSync(taskDir).filter((f) => f.endsWith(".json"));
  const tasks: TaskFileData[] = [];

  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(taskDir, file), "utf-8");
      const task = JSON.parse(raw) as TaskFileData;
      tasks.push(task);
    } catch {
      // Skip malformed task files
    }
  }

  return tasks;
}

function allTasksCompleted(teamName: string): boolean {
  const tasks = readTeamTasks(teamName);
  if (tasks.length === 0) return false;
  return tasks.every((t) => t.status === "completed" || t.status === "deleted");
}

function cleanupTeam(teamName: string): void {
  // Dynamic imports to avoid circular deps at module load time
  const { listTeamSessions, killSession } = require("../lib/tmux-manager");

  const sessions = listTeamSessions(teamName) as Array<{ sessionName: string; alive: boolean }>;
  for (const s of sessions) {
    if (s.alive) {
      try { killSession(s.sessionName); } catch { /* ignore */ }
    }
  }

  const teamDir = path.join(CLAUDE_DIR, "teams", teamName);
  if (fs.existsSync(teamDir)) {
    fs.rmSync(teamDir, { recursive: true, force: true });
  }

  const taskDir = path.join(CLAUDE_DIR, "tasks", teamName);
  if (fs.existsSync(taskDir)) {
    fs.rmSync(taskDir, { recursive: true, force: true });
  }
}

// ── Spawn Team ───────────────────────────────────────────────────────────────

async function spawnTeamForQueue(
  teamName: string,
  _goal: string,
  projectPath: string,
  plan: {
    description: string;
    personas: Array<{ name: string; role: string; agentType: string; description: string }>;
    initialTasks: Array<{ subject: string; description: string; assignTo?: string }>;
  }
): Promise<void> {
  const { launchTeamAsLeader, personaToLaunchable, getLeaderSessionName } = await import("../lib/agent-launcher");
  const teamDir = path.join(CLAUDE_DIR, "teams", teamName);
  fs.mkdirSync(teamDir, { recursive: true });

  const members = [
    {
      name: "leader",
      agentId: `${teamName}-leader-0`,
      agentType: "general-purpose",
      status: "active",
      tmuxSession: getLeaderSessionName(teamName),
    },
    ...plan.personas.map((p, i) => ({
      name: p.name,
      agentId: `${teamName}-${p.name}-${i}`,
      agentType: p.agentType ?? "general-purpose",
      status: "idle",
    })),
  ];

  fs.writeFileSync(
    path.join(teamDir, "config.json"),
    JSON.stringify({
      name: teamName,
      description: plan.description ?? "",
      members,
      projectPath,
      createdAt: new Date().toISOString(),
    }, null, 2),
    "utf-8"
  );

  const taskDir = path.join(CLAUDE_DIR, "tasks", teamName);
  fs.mkdirSync(taskDir, { recursive: true });

  const tasks = [];
  for (let i = 0; i < plan.initialTasks.length; i++) {
    const t = plan.initialTasks[i];
    const taskId = String(i + 1);
    const task = {
      id: taskId,
      subject: t.subject,
      description: t.description,
      status: "pending" as const,
      owner: t.assignTo,
    };
    fs.writeFileSync(
      path.join(taskDir, `${taskId}.json`),
      JSON.stringify(task, null, 2),
      "utf-8"
    );
    tasks.push(task);
  }

  const launchable = plan.personas.map(personaToLaunchable);
  await launchTeamAsLeader(
    teamName,
    plan.description ?? "",
    launchable,
    projectPath,
    tasks
  );
}

// ── Core Queue Processing ────────────────────────────────────────────────────

async function processTask(db: Database.Database, task: QueuedTaskRow): Promise<void> {
  const teamName = `q-${task.id}-${Date.now().toString(36)}`;

  console.log(`[queue] Processing task #${task.id}: "${task.goal}" → team ${teamName}`);

  db.prepare(
    `UPDATE queued_tasks SET status = 'running', team_name = ?, started_at = datetime('now') WHERE id = ?`
  ).run(teamName, task.id);

  try {
    const { generateTeamPlan } = await import("../lib/team-planner");

    console.log(`[queue] Generating team plan for: ${task.goal}`);
    const plan = await generateTeamPlan(task.goal, task.project_path);
    plan.teamName = teamName;

    console.log(`[queue] Spawning team ${teamName} at ${task.project_path}`);
    await spawnTeamForQueue(teamName, task.goal, task.project_path, plan);

    const startTime = Date.now();
    const { sessionExists } = await import("../lib/tmux-manager");
    const { getLeaderSessionName } = await import("../lib/agent-launcher");

    while (true) {
      await sleep(MONITOR_INTERVAL_MS);
      writeHeartbeat();

      const elapsed = Date.now() - startTime;

      if (allTasksCompleted(teamName)) {
        console.log(`[queue] All tasks completed for team ${teamName}`);
        await sleep(30_000);

        const leaderSession = getLeaderSessionName(teamName);
        if (sessionExists(leaderSession)) {
          console.log(`[queue] Leader still running (likely verifying/committing), waiting...`);
          await sleep(60_000);
        }

        db.prepare(
          `UPDATE queued_tasks SET status = 'completed', result = ?, completed_at = datetime('now') WHERE id = ?`
        ).run("All tasks completed successfully", task.id);

        console.log(`[queue] Task #${task.id} completed successfully`);
        break;
      }

      const leaderSession = getLeaderSessionName(teamName);
      if (!sessionExists(leaderSession)) {
        const fileTasks = readTeamTasks(teamName);
        const pending = fileTasks.filter((t) => t.status === "pending" || t.status === "in_progress");

        if (pending.length > 0) {
          const msg = `Leader died with ${pending.length} unfinished tasks`;
          console.error(`[queue] ${msg} for team ${teamName}`);
          db.prepare(
            `UPDATE queued_tasks SET status = 'failed', result = ?, completed_at = datetime('now') WHERE id = ?`
          ).run(msg, task.id);
          break;
        } else {
          db.prepare(
            `UPDATE queued_tasks SET status = 'completed', result = ?, completed_at = datetime('now') WHERE id = ?`
          ).run("All tasks completed, leader exited", task.id);
          console.log(`[queue] Task #${task.id} completed (leader exited after finishing)`);
          break;
        }
      }

      if (elapsed > TASK_TIMEOUT_MS) {
        console.error(`[queue] Task #${task.id} timed out after ${Math.round(elapsed / 60000)} min`);
        db.prepare(
          `UPDATE queued_tasks SET status = 'failed', result = ?, completed_at = datetime('now') WHERE id = ?`
        ).run(`Timed out after ${Math.round(elapsed / 60000)} minutes`, task.id);
        break;
      }

      console.log(`[queue] Task #${task.id} still running (${Math.round(elapsed / 60000)}min elapsed)`);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[queue] Task #${task.id} failed: ${msg}`);
    db.prepare(
      `UPDATE queued_tasks SET status = 'failed', result = ?, completed_at = datetime('now') WHERE id = ?`
    ).run(msg, task.id);
  } finally {
    console.log(`[queue] Cleaning up team ${teamName}`);
    cleanupTeam(teamName);
  }
}

// ── Main Loop ────────────────────────────────────────────────────────────────

async function runQueueWorker(): Promise<void> {
  // Singleton guard: prevent duplicate workers on hot reload
  if (workerRunning) {
    console.log("[queue] Worker already running, skipping duplicate start");
    return;
  }
  workerRunning = true;

  console.log("[queue] Queue worker starting (embedded in Next.js)...");
  const db = openDb();

  // Crash recovery: mark stuck running tasks as failed
  const stuckTasks = db.prepare(
    `SELECT * FROM queued_tasks WHERE status = 'running'`
  ).all() as QueuedTaskRow[];

  for (const stuck of stuckTasks) {
    console.log(`[queue] Found stuck running task #${stuck.id}, marking as failed`);
    db.prepare(
      `UPDATE queued_tasks SET status = 'failed', result = ?, completed_at = datetime('now') WHERE id = ?`
    ).run("Worker restarted while task was running", stuck.id);
    if (stuck.team_name) cleanupTeam(stuck.team_name);
  }

  // Main poll loop — runs forever alongside Next.js
  while (true) {
    writeHeartbeat();

    try {
      const nextTask = db.prepare(`
        SELECT qt.* FROM queued_tasks qt
        WHERE qt.status = 'pending'
          AND NOT EXISTS (
            SELECT 1 FROM queued_tasks running
            WHERE running.status = 'running'
              AND running.project_path = qt.project_path
          )
        ORDER BY qt.priority DESC, qt.created_at ASC
        LIMIT 1
      `).get() as QueuedTaskRow | undefined;

      if (nextTask) {
        await processTask(db, nextTask);
      } else {
        await sleep(POLL_INTERVAL_MS);
      }
    } catch (e) {
      console.error("[queue] Poll loop error:", e instanceof Error ? e.message : e);
      await sleep(POLL_INTERVAL_MS);
    }
  }
}

/**
 * Start the queue worker. Safe to call multiple times — only the first
 * invocation actually starts the loop (singleton guard).
 */
export function startQueueWorker(): void {
  runQueueWorker().catch((e) => {
    console.error("[queue] Fatal error:", e);
    workerRunning = false;
  });
}

export { runQueueWorker };
