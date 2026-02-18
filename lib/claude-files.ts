import fs from "fs";
import path from "path";
import type { Team, Teammate, TeamTask, Settings, Project, ProjectContext } from "@/types";

const CLAUDE_DIR = path.join(process.env.HOME ?? "/root", ".claude");

// ── Path helpers ──────────────────────────────────────────────────────────────

function teamsDir(): string {
  return path.join(CLAUDE_DIR, "teams");
}

function tasksDir(teamName: string): string {
  return path.join(CLAUDE_DIR, "tasks", teamName);
}

function settingsPath(): string {
  return path.join(CLAUDE_DIR, "settings.json");
}

function projectsDir(): string {
  return path.join(CLAUDE_DIR, "projects");
}

// ── Security: prevent path traversal ──────────────────────────────────────────

function assertSafePath(resolvedPath: string): void {
  const resolved = path.resolve(resolvedPath);
  if (!resolved.startsWith(path.resolve(CLAUDE_DIR) + path.sep) && resolved !== path.resolve(CLAUDE_DIR)) {
    throw new Error(`Path traversal attempt blocked: ${resolvedPath}`);
  }
}

function safeName(name: string): string {
  // Only allow alphanumeric, dash, underscore — no dots, slashes, or traversal sequences
  if (!/^[\w-]+$/.test(name)) {
    throw new Error(`Invalid name: ${name}`);
  }
  return name;
}

// ── JSON helpers ──────────────────────────────────────────────────────────────

function readJson<T>(filePath: string): T | null {
  try {
    const resolved = path.resolve(filePath);
    assertSafePath(resolved);
    const raw = fs.readFileSync(resolved, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeJson(filePath: string, data: unknown): void {
  const resolved = path.resolve(filePath);
  assertSafePath(resolved);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, JSON.stringify(data, null, 2), "utf-8");
}

// ── Member reconciliation ────────────────────────────────────────────────────
// When a team is spawned via the dashboard, placeholder members are pre-populated
// in the config (e.g. "analyst" with status "idle"). When the leader actually
// spawns them via Claude Code's Task tool, they get added as new entries with a
// "-N" suffix (e.g. "analyst-2") because the name is already taken. This results
// in duplicates where placeholders show stale status and real members appear as
// extras. reconcileMembers merges them: if a spawned member's base name matches
// a placeholder, the placeholder is replaced by the spawned member using the
// original name.

function isSpawnedMember(m: Teammate): boolean {
  // Spawned members have joinedAt set by Claude Code's team system
  return "joinedAt" in m;
}

function getBaseName(name: string): string {
  // Strip trailing "-N" suffix: "analyst-2" → "analyst", "frontend-dev-2" → "frontend-dev"
  return name.replace(/-\d+$/, "");
}

function reconcileMembers(members: Teammate[]): Teammate[] {
  const placeholders = new Map<string, number>(); // name → index
  const spawned: { member: Teammate; index: number }[] = [];

  // Classify each member
  for (let i = 0; i < members.length; i++) {
    const m = members[i];
    if (isSpawnedMember(m)) {
      spawned.push({ member: m, index: i });
    } else {
      placeholders.set(m.name, i);
    }
  }

  // No spawned members → nothing to reconcile
  if (spawned.length === 0) return members;

  const removedIndices = new Set<number>();
  const renamedSpawned = new Map<number, string>(); // spawned index → original name

  for (const { member, index } of spawned) {
    const baseName = getBaseName(member.name);
    if (baseName !== member.name && placeholders.has(baseName)) {
      // This spawned member corresponds to a placeholder
      removedIndices.add(placeholders.get(baseName)!);
      renamedSpawned.set(index, baseName);
      placeholders.delete(baseName); // consume the placeholder
    }
  }

  // Nothing to reconcile
  if (removedIndices.size === 0) return members;

  // Build reconciled list: keep order, remove placeholders, rename spawned
  const result: Teammate[] = [];
  for (let i = 0; i < members.length; i++) {
    if (removedIndices.has(i)) continue; // skip consumed placeholder
    const m = { ...members[i] };
    const newName = renamedSpawned.get(i);
    if (newName) {
      m.name = newName;
    }
    // Derive status from spawned member's isActive field
    if (isSpawnedMember(m) && "isActive" in m) {
      m.status = (m as Teammate & { isActive?: boolean }).isActive ? "active" : "offline";
    }
    result.push(m);
  }

  return result;
}

// ── Team functions ────────────────────────────────────────────────────────────

export function readTeamConfig(teamName: string): Team | null {
  const safe = safeName(teamName);
  const configPath = path.join(teamsDir(), safe, "config.json");
  const team = readJson<Team>(configPath);
  if (team && team.members) {
    team.members = reconcileMembers(team.members);
  }
  return team;
}

export function listTeams(): Team[] {
  const dir = teamsDir();
  if (!fs.existsSync(dir)) return [];

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const teams: Team[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const team = readTeamConfig(entry.name);
      if (team) teams.push({ ...team, name: team.name ?? entry.name });
    } catch {
      // skip malformed entries
    }
  }

  return teams;
}

// ── Task functions ────────────────────────────────────────────────────────────

/**
 * Find the Claude Code internal team name that corresponds to an MC team.
 *
 * When a team is spawned via Mission Control, the leader calls Claude Code's
 * TeamCreate which generates a different internal name (e.g. "woolly-forging-eich"
 * instead of the MC name "my-team"). The leader's TaskUpdate writes to the
 * internal team's task directory, causing MC's task files to stay stale.
 *
 * This function finds the internal team by scanning team configs for one that
 * shares the same projectPath AND was created within 10 minutes of the MC team.
 */
export function findInternalTeamName(mcTeamName: string): string | null {
  const mcConfig = readJson<Team & { projectPath?: string }>(
    path.join(teamsDir(), mcTeamName, "config.json")
  );
  if (!mcConfig?.createdAt) return null;

  const mcCreatedAt = new Date(mcConfig.createdAt).getTime();
  // Collect MC team member base names (without "-N" suffix) for matching
  const mcMemberNames = new Set(
    (mcConfig.members ?? []).map((m: Teammate) => m.name).filter((n: string) => n !== "leader")
  );
  const dir = teamsDir();
  if (!fs.existsSync(dir)) return null;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === mcTeamName) continue;
    try {
      const configPath = path.join(dir, entry.name, "config.json");
      if (!fs.existsSync(configPath)) continue;
      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      if (!config.createdAt) continue;

      // Must be created within 10 minutes of the MC team
      const createdAt = new Date(config.createdAt).getTime();
      const timeDiff = Math.abs(createdAt - mcCreatedAt);
      if (timeDiff >= 10 * 60 * 1000) continue;

      // Match by projectPath if both have it
      if (mcConfig.projectPath && config.projectPath) {
        if (config.projectPath === mcConfig.projectPath) {
          return entry.name;
        }
        continue; // Both have projectPath but they don't match
      }

      // Fallback: match by member name overlap (internal team has "-2" suffixed members)
      if (config.members && mcMemberNames.size > 0) {
        const internalBaseNames = (config.members as Teammate[])
          .map((m) => m.name.replace(/-\d+$/, ""))
          .filter((n) => n !== "leader" && n !== "team-lead");
        const overlap = internalBaseNames.filter((n: string) => mcMemberNames.has(n));
        if (overlap.length >= 2 || (overlap.length >= 1 && mcMemberNames.size <= 2)) {
          return entry.name;
        }
      }
    } catch {
      // skip malformed
    }
  }
  return null;
}

/** Status priority for reconciliation: higher = more advanced */
const STATUS_PRIORITY: Record<string, number> = {
  pending: 0,
  in_progress: 1,
  completed: 2,
  deleted: 3,
};

export function readTaskList(teamName: string): TeamTask[] {
  const safe = safeName(teamName);
  const dir = tasksDir(safe);
  if (!fs.existsSync(dir)) return [];

  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  const tasks: TeamTask[] = [];

  for (const file of files) {
    const filePath = path.join(dir, file);
    try {
      const task = readJson<TeamTask>(filePath);
      if (task) tasks.push(task);
    } catch {
      // skip malformed
    }
  }

  // Reconcile with Claude Code internal team's task directory
  const internalTeamName = findInternalTeamName(safe);
  if (internalTeamName) {
    const internalDir = tasksDir(internalTeamName);
    if (fs.existsSync(internalDir)) {
      const internalFiles = fs.readdirSync(internalDir).filter((f) => f.endsWith(".json"));
      const internalTasksById = new Map<string, TeamTask>();
      for (const file of internalFiles) {
        try {
          const task = readJson<TeamTask>(path.join(internalDir, file));
          if (task) internalTasksById.set(task.id, task);
        } catch {
          // skip malformed
        }
      }

      // Merge: use the more advanced status for matching task IDs
      for (const task of tasks) {
        const internalTask = internalTasksById.get(task.id);
        if (internalTask) {
          const mcPriority = STATUS_PRIORITY[task.status] ?? 0;
          const internalPriority = STATUS_PRIORITY[internalTask.status] ?? 0;
          if (internalPriority > mcPriority) {
            task.status = internalTask.status;
            // Persist the reconciled status back to the MC task file
            writeJson(path.join(dir, `${safeName(String(task.id))}.json`), task);
          }
        }
      }
    }
  }

  return tasks;
}

export function writeTask(teamName: string, task: TeamTask): void {
  const safe = safeName(teamName);
  const dir = tasksDir(safe);
  const filePath = path.join(dir, `${safeName(String(task.id))}.json`);
  writeJson(filePath, task);
}

// ── Team health helpers ──────────────────────────────────────────────────────

export function getTeamLastActivity(teamName: string): string | null {
  const safe = safeName(teamName);
  const dir = tasksDir(safe);
  if (!fs.existsSync(dir)) return null;

  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  if (files.length === 0) return null;

  let latest = 0;
  for (const file of files) {
    const filePath = path.join(dir, file);
    try {
      const stat = fs.statSync(filePath);
      if (stat.mtimeMs > latest) {
        latest = stat.mtimeMs;
      }
    } catch {
      // skip inaccessible files
    }
  }

  return latest > 0 ? new Date(latest).toISOString() : null;
}

// ── Archive functions ─────────────────────────────────────────────────────────

export function archiveTeam(teamName: string): void {
  const safe = safeName(teamName);
  const teamDir = path.join(teamsDir(), safe);
  const taskDir = tasksDir(safe);
  const archiveTeamDir = path.join(CLAUDE_DIR, "teams-archive", safe);
  const archiveTaskDir = path.join(CLAUDE_DIR, "tasks-archive", safe);

  if (!fs.existsSync(path.join(teamDir, "config.json"))) {
    throw new Error(`Team "${teamName}" not found`);
  }

  // Add archivedAt timestamp to config
  const configPath = path.join(teamDir, "config.json");
  const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  config.archivedAt = new Date().toISOString();

  fs.mkdirSync(path.dirname(archiveTeamDir), { recursive: true });
  if (fs.existsSync(archiveTeamDir)) {
    fs.rmSync(archiveTeamDir, { recursive: true });
  }
  fs.renameSync(teamDir, archiveTeamDir);
  fs.writeFileSync(
    path.join(archiveTeamDir, "config.json"),
    JSON.stringify(config, null, 2),
    "utf-8"
  );

  // Archive tasks too
  if (fs.existsSync(taskDir)) {
    fs.mkdirSync(path.dirname(archiveTaskDir), { recursive: true });
    if (fs.existsSync(archiveTaskDir)) {
      fs.rmSync(archiveTaskDir, { recursive: true });
    }
    fs.renameSync(taskDir, archiveTaskDir);
  }
}

// ── Settings functions ────────────────────────────────────────────────────────

export function readSettings(): Settings {
  return readJson<Settings>(settingsPath()) ?? {};
}

export function writeSettings(settings: Settings): void {
  const resolved = path.resolve(settingsPath());
  assertSafePath(resolved);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, JSON.stringify(settings, null, 2), "utf-8");
}

// ── Project functions ─────────────────────────────────────────────────────────

export function listProjects(): Project[] {
  const dir = projectsDir();
  if (!fs.existsSync(dir)) return [];

  // Project dirs are encoded as path with hyphens replacing slashes
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const projects: Project[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    // Decode dir name: "-home-user-project" → "/home/user/project"
    const decodedPath = entry.name.replace(/^-/, "/").replace(/-/g, "/");
    const name = entry.name.split("-").pop() ?? entry.name;
    projects.push({
      id: entry.name,
      path: decodedPath,
      name,
    });
  }

  return projects;
}

export function readProjectContext(projectDirName: string): ProjectContext {
  const safe = safeName(projectDirName);
  const projectDir = path.join(projectsDir(), safe);
  const resolved = path.resolve(projectDir);
  assertSafePath(resolved);

  const context: ProjectContext = { memoryFiles: {} };

  // Read CLAUDE.md — may be in the actual project path, not .claude/projects
  const claudeMdPath = path.join(resolved, "CLAUDE.md");
  if (fs.existsSync(claudeMdPath)) {
    context.claudeMd = fs.readFileSync(claudeMdPath, "utf-8");
  }

  // Read memory files from ~/.claude/projects/{dir}/memory/
  const memoryDir = path.join(resolved, "memory");
  if (fs.existsSync(memoryDir)) {
    const memFiles = fs.readdirSync(memoryDir).filter((f) => f.endsWith(".md"));
    for (const f of memFiles) {
      const filePath = path.join(memoryDir, f);
      context.memoryFiles[f] = fs.readFileSync(filePath, "utf-8");
    }
  }

  return context;
}
