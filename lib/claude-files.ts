import fs from "fs";
import path from "path";
import type { Team, Teammate, TeamTask, Settings, Project, ProjectContext, Skill } from "@/types";

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

/**
 * Get the leadSessionId from a team config (if present).
 * External teams (spawned outside MC) store the Claude Code session UUID here.
 */
function getLeadSessionId(teamName: string): string | null {
  try {
    const configPath = path.join(teamsDir(), teamName, "config.json");
    if (!fs.existsSync(configPath)) return null;
    const raw = fs.readFileSync(configPath, "utf-8");
    const config = JSON.parse(raw);
    return config.leadSessionId ?? null;
  } catch {
    return null;
  }
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

/**
 * Find an existing (non-archived) team that was spawned for the given QueuedTask ID.
 * Returns the team name if found, null otherwise.
 * This is the file-based counterpart to the DB check in the spawn route —
 * it catches duplicates even if the DB row was lost or inconsistent.
 */
export function findTeamBySourceTaskId(sourceTaskId: number): string | null {
  const dir = teamsDir();
  if (!fs.existsSync(dir)) return null;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const configPath = path.join(dir, entry.name, "config.json");
      const raw = fs.readFileSync(configPath, "utf-8");
      const config = JSON.parse(raw);
      if (config.sourceTaskId === sourceTaskId) {
        return entry.name;
      }
    } catch {
      // skip malformed
    }
  }
  return null;
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
 * Parse createdAt from a team config. Claude Code uses numeric timestamps
 * (e.g. 1771441724059) while MC uses ISO strings. Handle both.
 */
function parseCreatedAt(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return new Date(value).getTime();
  return 0;
}

/**
 * Find the Claude Code internal team name that corresponds to an MC team.
 *
 * When a team is spawned via Mission Control, the leader calls Claude Code's
 * TeamCreate which generates a different internal name (e.g. "woolly-forging-eich"
 * instead of the MC name "my-team"). The leader's TaskUpdate writes to the
 * internal team's task directory, causing MC's task files to stay stale.
 *
 * Matching strategy (in priority order):
 * 1. projectPath match + creation time within 10 minutes
 * 2. Task subject overlap (compares task files in both directories)
 * 3. Creation time proximity (within 2 minutes, as last resort)
 */
export function findInternalTeamName(mcTeamName: string): string | null {
  const mcConfigPath = path.join(teamsDir(), mcTeamName, "config.json");
  if (!fs.existsSync(mcConfigPath)) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let mcConfig: any;
  try {
    mcConfig = JSON.parse(fs.readFileSync(mcConfigPath, "utf-8"));
  } catch { return null; }
  if (!mcConfig?.createdAt) return null;

  const mcCreatedAt = parseCreatedAt(mcConfig.createdAt);
  const mcTaskDir = tasksDir(mcTeamName);

  // Read MC task subjects for content-based matching
  const mcTaskSubjects = new Set<string>();
  if (fs.existsSync(mcTaskDir)) {
    for (const f of fs.readdirSync(mcTaskDir).filter((f) => f.endsWith(".json"))) {
      try {
        const t = JSON.parse(fs.readFileSync(path.join(mcTaskDir, f), "utf-8"));
        if (t.subject) mcTaskSubjects.add(t.subject.toLowerCase().slice(0, 30));
      } catch { /* skip */ }
    }
  }

  const dir = teamsDir();
  if (!fs.existsSync(dir)) return null;

  let bestMatch: string | null = null;
  let bestScore = 0;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === mcTeamName) continue;
    // Skip other MC teams (queue-spawned teams start with "q-")
    if (entry.name.startsWith("q-")) continue;
    // Skip "default" team
    if (entry.name === "default") continue;

    try {
      const configPath = path.join(dir, entry.name, "config.json");
      if (!fs.existsSync(configPath)) continue;
      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      if (!config.createdAt) continue;

      // Guard: skip candidates that are the MC team itself (already handled above)
      // or the queried MC team name.
      // Note: we no longer skip teams just because config.name === entry.name,
      // since Claude-generated teams also set config.name to the directory name.

      const createdAt = parseCreatedAt(config.createdAt);
      const timeDiff = Math.abs(createdAt - mcCreatedAt);

      // Must be created within 10 minutes
      if (timeDiff >= 10 * 60 * 1000) continue;

      let score = 0;

      // Strong signal: projectPath match
      if (mcConfig.projectPath && config.projectPath &&
          config.projectPath === mcConfig.projectPath) {
        score += 100;
      }

      // Strong signal: task subject overlap
      if (mcTaskSubjects.size > 0) {
        const internalTaskDir = tasksDir(entry.name);
        if (fs.existsSync(internalTaskDir)) {
          let subjectMatches = 0;
          const files = fs.readdirSync(internalTaskDir).filter((f) => f.endsWith(".json"));
          for (const f of files) {
            try {
              const t = JSON.parse(fs.readFileSync(path.join(internalTaskDir, f), "utf-8"));
              if (t.subject && mcTaskSubjects.has(t.subject.toLowerCase().slice(0, 30))) {
                subjectMatches++;
              }
            } catch { /* skip */ }
          }
          // Each matching task subject is a strong signal
          score += subjectMatches * 50;
        }
      }

      // Weak signal: time proximity (closer = better)
      if (timeDiff < 2 * 60 * 1000) {
        score += 10;
      }

      if (score > bestScore) {
        bestScore = score;
        bestMatch = entry.name;
      }
    } catch {
      // skip malformed
    }
  }

  // Require at least some confidence (subject match or projectPath)
  return bestScore >= 10 ? bestMatch : null;
}

/** Status priority for reconciliation: higher = more advanced */
const STATUS_PRIORITY: Record<string, number> = {
  pending: 0,
  in_progress: 1,
  completed: 2,
  deleted: 3,
};

/**
 * Replace the internal team's task directory with a symlink to the MC directory.
 * This is the definitive fix for the split-brain problem: after symlinking,
 * all agent TaskUpdate/TaskCreate writes go directly to the MC files.
 *
 * Steps:
 * 1. Merge any status updates from internal → MC (one-time reconciliation)
 * 2. Remove the internal task directory
 * 3. Create symlink: internal → MC
 *
 * After this runs once, no further reconciliation is needed for this team.
 */
function symlinkInternalTaskDir(mcDir: string, internalDir: string): void {
  // Don't symlink if already a symlink
  try {
    const stat = fs.lstatSync(internalDir);
    if (stat.isSymbolicLink()) return;
  } catch {
    return; // doesn't exist
  }

  // Step 1: Merge status from internal → MC before replacing
  const internalFiles = fs.readdirSync(internalDir).filter((f) => f.endsWith(".json"));
  for (const file of internalFiles) {
    try {
      const internalTask = JSON.parse(fs.readFileSync(path.join(internalDir, file), "utf-8"));
      const mcFilePath = path.join(mcDir, file);
      if (fs.existsSync(mcFilePath)) {
        const mcTask = JSON.parse(fs.readFileSync(mcFilePath, "utf-8"));
        const mcPriority = STATUS_PRIORITY[mcTask.status] ?? 0;
        const internalPriority = STATUS_PRIORITY[internalTask.status] ?? 0;
        if (internalPriority > mcPriority) {
          mcTask.status = internalTask.status;
          fs.writeFileSync(mcFilePath, JSON.stringify(mcTask, null, 2), "utf-8");
        }
      }
    } catch {
      // skip malformed
    }
  }

  // Step 2+3: Replace internal dir with symlink to MC dir (atomic via rename)
  const tmpLink = internalDir + ".symlink-tmp";
  try {
    // Remove any stale tmp link
    try { fs.unlinkSync(tmpLink); } catch { /* ok */ }
    // Create symlink at tmp path, then atomically move into place
    fs.symlinkSync(mcDir, tmpLink);
    fs.rmSync(internalDir, { recursive: true, force: true });
    fs.renameSync(tmpLink, internalDir);
  } catch {
    // Clean up on failure
    try { fs.unlinkSync(tmpLink); } catch { /* ok */ }
  }
}

export function readTaskList(teamName: string): TeamTask[] {
  const safe = safeName(teamName);
  const dir = tasksDir(safe);

  // Priority 1: Resolve tasks via leadSessionId (external/cross-repo teams)
  // The team config may have a leadSessionId UUID pointing to the real task dir
  const leadSessionId = getLeadSessionId(safe);
  if (leadSessionId) {
    const sessionTaskDir = path.join(CLAUDE_DIR, "tasks", leadSessionId);
    if (fs.existsSync(sessionTaskDir)) {
      const sessionFiles = fs.readdirSync(sessionTaskDir).filter((f) => f.endsWith(".json"));
      if (sessionFiles.length > 0) {
        // Ensure symlink: ~/.claude/tasks/{teamName} → ~/.claude/tasks/{leadSessionId}/
        ensureTaskSymlink(dir, sessionTaskDir);
        return readTasksFromDir(dir);
      }
    }
  }

  if (!fs.existsSync(dir)) return [];

  // Priority 2: Auto-symlink via internal team name heuristic (MC-spawned teams only)
  const isMcTeam = safe.startsWith("q-");
  const internalTeamName = isMcTeam ? findInternalTeamName(safe) : null;
  if (internalTeamName) {
    const internalDir = tasksDir(internalTeamName);
    symlinkInternalTaskDir(dir, internalDir);
  }

  return readTasksFromDir(dir);
}

/** Read all task JSON files from a directory */
function readTasksFromDir(dir: string): TeamTask[] {
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

  return tasks;
}

/**
 * Ensure a symlink exists from linkPath → targetDir.
 * If linkPath is already a symlink pointing to targetDir, no-op.
 * If linkPath is a broken symlink or doesn't exist, create the symlink.
 * If linkPath is a real directory, skip (don't destroy data).
 */
function ensureTaskSymlink(linkPath: string, targetDir: string): void {
  try {
    const stat = fs.lstatSync(linkPath);
    if (stat.isSymbolicLink()) {
      // Already a symlink — check if it points to the right place
      const existing = fs.readlinkSync(linkPath);
      if (path.resolve(existing) === path.resolve(targetDir)) return;
      // Wrong target — replace it
      fs.unlinkSync(linkPath);
    } else if (stat.isDirectory()) {
      // Real directory with potential data — don't destroy it
      // Instead, try symlinkInternalTaskDir which merges first
      return;
    }
  } catch {
    // Doesn't exist — good, we'll create it
  }

  try {
    fs.symlinkSync(targetDir, linkPath);
  } catch {
    // ignore symlink creation failure
  }
}

export function readTask(teamName: string, taskId: string): TeamTask | null {
  const safe = safeName(teamName);
  const safeId = safeName(String(taskId));
  const filePath = path.join(tasksDir(safe), `${safeId}.json`);
  return readJson<TeamTask>(filePath);
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

// ── Delete functions ──────────────────────────────────────────────────────────

export function deleteTeam(teamName: string): void {
  const safe = safeName(teamName);
  const teamDir = path.join(teamsDir(), safe);
  const taskDir = tasksDir(safe);

  if (!fs.existsSync(path.join(teamDir, "config.json"))) {
    throw new Error(`Team "${teamName}" not found`);
  }

  if (fs.existsSync(teamDir)) {
    fs.rmSync(teamDir, { recursive: true });
  }
  if (fs.existsSync(taskDir)) {
    fs.rmSync(taskDir, { recursive: true });
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

// ── Project-level Claude settings (.claude/settings.json in project dir) ────

interface ProjectClaudeSettings {
  permissions?: Record<string, unknown>;
  teammateMode?: string;
  mcpServers?: Record<string, unknown>;
  env?: Record<string, string>;
  [key: string]: unknown;
}

/**
 * Read the project-level .claude/settings.json for a given project directory.
 * Falls back to the current working directory if no projectPath is given.
 */
export function readProjectClaudeSettings(projectPath?: string): ProjectClaudeSettings {
  const dir = projectPath ?? process.cwd();
  const filePath = path.join(dir, ".claude", "settings.json");
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as ProjectClaudeSettings;
  } catch {
    return {};
  }
}

/**
 * Write the project-level .claude/settings.json for a given project directory.
 * Merges env vars without clobbering other settings (permissions, mcpServers, etc).
 */
export function writeProjectClaudeSettings(
  settings: ProjectClaudeSettings,
  projectPath?: string
): void {
  const dir = projectPath ?? process.cwd();
  const filePath = path.join(dir, ".claude", "settings.json");
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(settings, null, 2) + "\n", "utf-8");
}

/**
 * Set ANTHROPIC_BASE_URL in the project-level .claude/settings.json env block.
 * When proxyUrl is null, removes the env var so Claude goes direct to Anthropic.
 */
export function setProjectProxyEnv(proxyUrl: string | null, projectPath?: string): void {
  const settings = readProjectClaudeSettings(projectPath);

  if (proxyUrl) {
    // Set ANTHROPIC_BASE_URL to route through proxy
    settings.env = { ...settings.env, ANTHROPIC_BASE_URL: proxyUrl };
  } else {
    // Remove ANTHROPIC_BASE_URL so Claude goes directly to Anthropic
    if (settings.env) {
      delete settings.env.ANTHROPIC_BASE_URL;
      // Clean up empty env object
      if (Object.keys(settings.env).length === 0) {
        delete settings.env;
      }
    }
  }

  writeProjectClaudeSettings(settings, projectPath);
}

// ── Project functions ─────────────────────────────────────────────────────────

/**
 * Decode a Claude projects directory name back to a real filesystem path.
 *
 * The encoding is lossy: `/` → `-`, so `-home-lin-mission-control-lin` could be
 * `/home/lin/mission/control/lin` or `/home/lin/mission-control-lin`.
 * We resolve ambiguity by greedily matching the longest existing path segment
 * at each level, falling back to single-segment decode when nothing matches.
 */
function decodeProjectDirName(encoded: string): string {
  // Strip leading dash to get segments: "-home-lin-foo" → ["home","lin","foo"]
  const segments = encoded.replace(/^-/, "").split("-");
  let current = "/";

  let i = 0;
  while (i < segments.length) {
    // Read directory entries once per depth level instead of stat-ing every candidate
    let children: Set<string>;
    try {
      children = new Set(fs.readdirSync(current));
    } catch {
      // Can't read directory — just concatenate remaining segments as singles
      current = path.join(current, ...segments.slice(i));
      break;
    }

    // Try longest possible segment first (greedy): join multiple parts with hyphens
    let matched = false;
    for (let j = segments.length; j > i; j--) {
      const candidate = segments.slice(i, j).join("-");
      if (children.has(candidate)) {
        current = path.join(current, candidate);
        i = j;
        matched = true;
        break;
      }
    }
    if (!matched) {
      // Nothing matched on disk — just use the single segment
      current = path.join(current, segments[i]);
      i++;
    }
  }

  return current;
}

export function listProjects(): Project[] {
  const dir = projectsDir();
  if (!fs.existsSync(dir)) return [];

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const projects: Project[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const decodedPath = decodeProjectDirName(entry.name);
    const name = path.basename(decodedPath);
    projects.push({
      id: entry.name,
      path: decodedPath,
      name,
    });
  }

  return projects;
}

// ── Skill functions ───────────────────────────────────────────────────────────

function skillsDir(): string {
  return path.join(CLAUDE_DIR, "skills");
}

/**
 * Parse YAML front matter from a markdown string.
 * Expects content starting with `---\n...\n---\n` delimiters.
 * Returns extracted key-value pairs and the remaining body.
 */
function parseFrontMatter(raw: string): { attrs: Record<string, string>; body: string } {
  const attrs: Record<string, string> = {};
  const trimmed = raw.trimStart();
  if (!trimmed.startsWith("---")) {
    return { attrs, body: raw };
  }

  const endIdx = trimmed.indexOf("---", 3);
  if (endIdx === -1) {
    return { attrs, body: raw };
  }

  const frontMatter = trimmed.slice(3, endIdx).trim();
  const body = trimmed.slice(endIdx + 3).replace(/^\r?\n/, "");

  for (const line of frontMatter.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, "");
    if (key) attrs[key] = value;
  }

  return { attrs, body };
}

export function listSkills(): Skill[] {
  const dir = skillsDir();
  if (!fs.existsSync(dir)) return [];

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const skills: Skill[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const skillDir = path.join(dir, entry.name);
    // Find SKILL.md case-insensitively
    let skillFile: string | null = null;
    try {
      const files = fs.readdirSync(skillDir);
      skillFile = files.find((f) => f.toLowerCase() === "skill.md") ?? null;
    } catch {
      continue;
    }

    if (!skillFile) continue;

    try {
      const raw = fs.readFileSync(path.join(skillDir, skillFile), "utf-8");
      const { attrs, body } = parseFrontMatter(raw);

      skills.push({
        folderName: entry.name,
        name: attrs.name || entry.name,
        description: attrs.description || "",
        content: body,
      });
    } catch {
      // skip unreadable
    }
  }

  return skills;
}

export function readSkill(folderName: string): Skill | null {
  const dir = skillsDir();
  const skillDir = path.join(dir, folderName);
  if (!fs.existsSync(skillDir)) return null;

  let skillFile: string | null = null;
  try {
    const files = fs.readdirSync(skillDir);
    skillFile = files.find((f) => f.toLowerCase() === "skill.md") ?? null;
  } catch {
    return null;
  }

  if (!skillFile) return null;

  try {
    const raw = fs.readFileSync(path.join(skillDir, skillFile), "utf-8");
    const { attrs, body } = parseFrontMatter(raw);
    return {
      folderName,
      name: attrs.name || folderName,
      description: attrs.description || "",
      content: body,
    };
  } catch {
    return null;
  }
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
