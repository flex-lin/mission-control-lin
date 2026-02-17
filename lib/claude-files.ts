import fs from "fs";
import path from "path";
import type { Team, TeamTask, Settings, Project, ProjectContext } from "@/types";

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

// ── Team functions ────────────────────────────────────────────────────────────

export function readTeamConfig(teamName: string): Team | null {
  const safe = safeName(teamName);
  const configPath = path.join(teamsDir(), safe, "config.json");
  return readJson<Team>(configPath);
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

  return tasks;
}

export function writeTask(teamName: string, task: TeamTask): void {
  const safe = safeName(teamName);
  const dir = tasksDir(safe);
  const filePath = path.join(dir, `${safeName(String(task.id))}.json`);
  writeJson(filePath, task);
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
