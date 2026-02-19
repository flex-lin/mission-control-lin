/**
 * Queue Worker — standalone process (via pnpm queue).
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
  team_members: string; // JSON array of role objects
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

interface SelectedRole {
  name: string;
  role: string;
  agentType: string;
  description: string;
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
      team_members TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      started_at TEXT,
      completed_at TEXT
    )
  `);
  // Ensure team_members column exists in older DBs (migration safety)
  try {
    db.exec(`ALTER TABLE queued_tasks ADD COLUMN team_members TEXT NOT NULL DEFAULT '[]'`);
  } catch {
    // Column already exists — ignore
  }
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
  // Use the shared readTaskList which reconciles task status from
  // Claude Code's internal team directory (which may have a different name)
  try {
    const { readTaskList } = require("../lib/claude-files");
    const tasks = readTaskList(teamName) as TaskFileData[];
    return tasks;
  } catch {
    // Fallback to direct file reading if import fails
  }

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

/**
 * Determine the completion state of a team's tasks.
 * - "completed": all task files have status completed/deleted
 * - "cleaned_up": task directory was removed (e.g. TeamDelete was called)
 * - "has_pending": some tasks are still pending/in_progress
 * - "no_tasks": task dir exists but has no task files (shouldn't normally happen)
 */
function getTaskCompletionState(teamName: string): "completed" | "cleaned_up" | "has_pending" | "no_tasks" {
  const taskDir = path.join(CLAUDE_DIR, "tasks", teamName);
  if (!fs.existsSync(taskDir)) return "cleaned_up";

  const tasks = readTeamTasks(teamName);
  if (tasks.length === 0) return "no_tasks";

  if (tasks.every((t) => t.status === "completed" || t.status === "deleted")) {
    return "completed";
  }

  return "has_pending";
}

function allTasksCompleted(teamName: string): boolean {
  const state = getTaskCompletionState(teamName);
  return state === "completed";
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

  // Also clean up Claude Code's internal team (different auto-generated name)
  try {
    const { findInternalTeamName } = require("../lib/claude-files");
    const internalName = findInternalTeamName(teamName);
    if (internalName) {
      const internalTeamDir = path.join(CLAUDE_DIR, "teams", internalName);
      if (fs.existsSync(internalTeamDir)) {
        fs.rmSync(internalTeamDir, { recursive: true, force: true });
      }
      const internalTaskDir = path.join(CLAUDE_DIR, "tasks", internalName);
      if (fs.existsSync(internalTaskDir)) {
        // If it's a symlink (from our auto-symlink fix), just unlink it
        // — don't follow into the MC directory and delete those files
        try {
          const stat = fs.lstatSync(internalTaskDir);
          if (stat.isSymbolicLink()) {
            fs.unlinkSync(internalTaskDir);
          } else {
            fs.rmSync(internalTaskDir, { recursive: true, force: true });
          }
        } catch {
          fs.rmSync(internalTaskDir, { recursive: true, force: true });
        }
      }
    }
  } catch {
    // Non-critical — internal team cleanup is best-effort
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
  },
  sourceTaskId?: number
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
      ...(sourceTaskId != null ? { sourceTaskId } : {}),
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

// ── Team Monitoring ──────────────────────────────────────────────────────────

/**
 * Monitor an already-running team until completion, failure, or timeout.
 * Used by both processTask() (after spawning) and crash recovery (for
 * teams whose tmux leader is still alive after a worker restart).
 *
 * Returns the final status: "completed" or "failed".
 */
async function monitorTeam(
  db: Database.Database,
  taskId: number,
  teamName: string,
  startTime: number
): Promise<"completed" | "failed"> {
  const { sessionExists, sessionProcessAlive } = await import("../lib/tmux-manager");
  const { getLeaderSessionName } = await import("../lib/agent-launcher");

  while (true) {
    await sleep(MONITOR_INTERVAL_MS);
    writeHeartbeat();

    const elapsed = Date.now() - startTime;
    const taskState = getTaskCompletionState(teamName);
    const leaderSession = getLeaderSessionName(teamName);

    // Check if tasks are done (either all completed or team called TeamDelete)
    if (taskState === "completed" || taskState === "cleaned_up" || taskState === "no_tasks") {
      const reason = taskState === "cleaned_up"
        ? "Team cleaned up (TeamDelete called)"
        : "All tasks completed successfully";

      if (taskState === "completed") {
        // Tasks still on disk and all completed — give leader time to build/commit
        console.log(`[queue] All tasks completed for team ${teamName}`);
        await sleep(30_000);

        if (sessionExists(leaderSession) && sessionProcessAlive(leaderSession)) {
          console.log(`[queue] Leader still running (likely verifying/committing), waiting...`);
          await sleep(60_000);
        }
      } else {
        // Task dir gone or empty — team already cleaned up, brief grace period
        console.log(`[queue] ${reason} for team ${teamName}`);
        await sleep(5_000);
      }

      db.prepare(
        `UPDATE queued_tasks SET status = 'completed', result = ?, completed_at = datetime('now') WHERE id = ?`
      ).run(reason, taskId);

      console.log(`[queue] Task #${taskId} completed: ${reason}`);
      return "completed";
    }

    // Leader liveness: check both tmux session AND whether claude process is alive
    // (tmux session can linger as a shell prompt after claude exits)
    const leaderAlive = sessionExists(leaderSession) && sessionProcessAlive(leaderSession);

    if (!leaderAlive) {
      const fileTasks = readTeamTasks(teamName);
      const pending = fileTasks.filter((t) => t.status === "pending" || t.status === "in_progress");

      if (pending.length > 0) {
        const msg = `Leader exited with ${pending.length} unfinished tasks`;
        console.error(`[queue] ${msg} for team ${teamName}`);
        db.prepare(
          `UPDATE queued_tasks SET status = 'failed', result = ?, completed_at = datetime('now') WHERE id = ?`
        ).run(msg, taskId);
        return "failed";
      } else {
        db.prepare(
          `UPDATE queued_tasks SET status = 'completed', result = ?, completed_at = datetime('now') WHERE id = ?`
        ).run("All tasks completed, leader exited", taskId);
        console.log(`[queue] Task #${taskId} completed (leader exited after finishing)`);
        return "completed";
      }
    }

    if (elapsed > TASK_TIMEOUT_MS) {
      console.error(`[queue] Task #${taskId} timed out after ${Math.round(elapsed / 60000)} min`);
      db.prepare(
        `UPDATE queued_tasks SET status = 'failed', result = ?, completed_at = datetime('now') WHERE id = ?`
      ).run(`Timed out after ${Math.round(elapsed / 60000)} minutes`, taskId);
      return "failed";
    }

    console.log(`[queue] Task #${taskId} still running (${Math.round(elapsed / 60000)}min elapsed)`);
  }
}

// ── Core Queue Processing ────────────────────────────────────────────────────

async function processTask(db: Database.Database, task: QueuedTaskRow): Promise<void> {
  console.log(`[queue] Processing task #${task.id}: "${task.goal}"`);

  // One-team-per-task: atomically claim the task with a CAS (compare-and-swap).
  // Only transitions pending→running; if another worker already claimed it, bail out.
  const claimed = db.prepare(
    `UPDATE queued_tasks SET status = 'running', started_at = datetime('now') WHERE id = ? AND status = 'pending'`
  ).run(task.id);
  if (claimed.changes === 0) {
    console.log(`[queue] Task #${task.id} already claimed by another worker, skipping`);
    return;
  }

  // File-based duplicate check: if a team config already references this task ID, skip
  try {
    const { findTeamBySourceTaskId } = require("../lib/claude-files");
    const existingTeam = findTeamBySourceTaskId(task.id);
    if (existingTeam) {
      console.log(`[queue] Task #${task.id} already has team "${existingTeam}" on disk, skipping`);
      db.prepare(
        `UPDATE queued_tasks SET status = 'failed', result = ?, completed_at = datetime('now') WHERE id = ?`
      ).run(`Duplicate: team "${existingTeam}" already exists for this task`, task.id);
      return;
    }
  } catch {
    // Non-critical — file check is a safety net, DB CAS is the primary guard
  }

  // Declared outside try so it's accessible in finally for cleanup
  let teamName: string | null = null;

  try {
    const { generateTeamPlan, ensureUniqueName } = await import("../lib/team-planner");

    console.log(`[queue] Generating team plan for: ${task.goal}`);
    const plan = await generateTeamPlan(task.goal, task.project_path);

    // If the queued task has explicitly configured team members, override the AI-generated personas
    let configuredMembers: SelectedRole[] = [];
    try {
      const parsed = JSON.parse(task.team_members || "[]");
      if (Array.isArray(parsed) && parsed.length > 0) {
        configuredMembers = parsed as SelectedRole[];
      }
    } catch {
      // Ignore parse errors — fall back to AI-generated plan
    }

    if (configuredMembers.length > 0) {
      console.log(`[queue] Using ${configuredMembers.length} configured team members for task #${task.id}`);
      plan.personas = configuredMembers.map((m) => ({
        name: m.name,
        role: m.role,
        agentType: m.agentType ?? "general-purpose",
        description: m.description ?? "",
      }));
    }

    // Use plan's AI-generated name with queue prefix, ensure uniqueness
    teamName = ensureUniqueName(`q-${task.id}-${plan.teamName}`);
    plan.teamName = teamName;

    console.log(`[queue] Generated team name: ${teamName}`);

    db.prepare(
      `UPDATE queued_tasks SET team_name = ? WHERE id = ?`
    ).run(teamName, task.id);

    console.log(`[queue] Spawning team ${teamName} at ${task.project_path}`);
    await spawnTeamForQueue(teamName, task.goal, task.project_path, plan, task.id);

    await monitorTeam(db, task.id, teamName, Date.now());
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[queue] Task #${task.id} failed: ${msg}`);
    db.prepare(
      `UPDATE queued_tasks SET status = 'failed', result = ?, completed_at = datetime('now') WHERE id = ?`
    ).run(msg, task.id);
  } finally {
    if (teamName) {
      console.log(`[queue] Cleaning up team ${teamName}`);
      cleanupTeam(teamName);
    }
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

  console.log("[queue] Queue worker starting (standalone)...");
  const db = openDb();

  // Crash recovery: check stuck 'running' tasks from before the restart.
  // If their tmux leader is still alive, resume monitoring instead of killing them.
  const stuckTasks = db.prepare(
    `SELECT * FROM queued_tasks WHERE status = 'running'`
  ).all() as QueuedTaskRow[];

  const recoveryPromises: Promise<void>[] = [];

  for (const stuck of stuckTasks) {
    if (stuck.team_name) {
      const { sessionExists, sessionProcessAlive } = await import("../lib/tmux-manager");
      const { getLeaderSessionName } = await import("../lib/agent-launcher");
      const leaderSession = getLeaderSessionName(stuck.team_name);
      const leaderAlive = sessionExists(leaderSession) && sessionProcessAlive(leaderSession);

      if (leaderAlive) {
        // Leader is still running — resume monitoring it
        console.log(`[queue] Task #${stuck.id} team "${stuck.team_name}" leader still alive, resuming monitoring`);
        recoveryPromises.push(
          monitorTeam(db, stuck.id, stuck.team_name, Date.now()).then((status) => {
            console.log(`[queue] Recovered task #${stuck.id} finished with status: ${status}`);
            console.log(`[queue] Cleaning up team ${stuck.team_name}`);
            cleanupTeam(stuck.team_name!);
          }).catch((e) => {
            const msg = e instanceof Error ? e.message : String(e);
            console.error(`[queue] Recovered task #${stuck.id} monitor failed: ${msg}`);
            db.prepare(
              `UPDATE queued_tasks SET status = 'failed', result = ?, completed_at = datetime('now') WHERE id = ?`
            ).run(`Monitor failed after recovery: ${msg}`, stuck.id);
            cleanupTeam(stuck.team_name!);
          })
        );
        continue;
      }

      // Leader is dead — check task completion state
      const taskState = getTaskCompletionState(stuck.team_name);
      if (taskState === "completed") {
        console.log(`[queue] Task #${stuck.id} team "${stuck.team_name}" leader dead but tasks done, marking completed`);
        db.prepare(
          `UPDATE queued_tasks SET status = 'completed', result = ?, completed_at = datetime('now') WHERE id = ?`
        ).run("All tasks completed (leader exited before worker restart)", stuck.id);
        cleanupTeam(stuck.team_name);
        continue;
      }
      // "cleaned_up" (task dir missing) means team was never fully spawned or
      // worker crashed before completing — treat as failed, not completed.
    }

    // No team, or leader dead with pending tasks — mark as failed (original behavior)
    console.log(`[queue] Found stuck running task #${stuck.id}, marking as failed`);
    db.prepare(
      `UPDATE queued_tasks SET status = 'failed', result = ?, completed_at = datetime('now') WHERE id = ?`
    ).run("Worker restarted while task was running", stuck.id);
    if (stuck.team_name) cleanupTeam(stuck.team_name);
  }

  // Main poll loop
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
