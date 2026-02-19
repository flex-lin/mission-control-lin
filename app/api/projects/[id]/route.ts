import { NextRequest, NextResponse } from "next/server";
import { readProjectContext, listProjects } from "@/lib/claude-files";
import { db } from "@/lib/db";
import { ok, notFound, serverError } from "@/lib/api-helpers";
import type { ProjectContext } from "@/types";
import fs from "fs";
import path from "path";

const CLAUDE_DIR = path.join(process.env.HOME ?? "/root", ".claude");

function buildFileTree(dirPath: string, depth = 0): string[] {
  if (depth > 3) return [];
  const items: string[] = [];
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const rel = entry.isDirectory() ? `${entry.name}/` : entry.name;
      items.push(rel);
      if (entry.isDirectory() && depth < 2) {
        const sub = buildFileTree(path.join(dirPath, entry.name), depth + 1);
        items.push(...sub.map((s) => `  ${s}`));
      }
    }
  } catch { /* skip unreadable dirs */ }
  return items;
}

/** Decode a project folder ID back to a filesystem path: "-home-user-project" → "/home/user/project" */
function idToPath(id: string): string {
  return id.replace(/^-/, "/").replace(/-/g, "/");
}

/** Build a project detail response from a DB IndexedProject record */
function buildDbProjectResponse(dbRecord: { id: number; path: string; name: string; tags: string }) {
  const projectPath = dbRecord.path;
  const context: ProjectContext = { memoryFiles: {} };

  // Read CLAUDE.md from the project directory
  const claudeMdPath = path.join(projectPath, "CLAUDE.md");
  if (fs.existsSync(claudeMdPath)) {
    context.claudeMd = fs.readFileSync(claudeMdPath, "utf-8");
  }

  // Check ~/.claude/projects/ for memory files
  const dirName = projectPath.replace(/\//g, "-");
  const memoryDir = path.join(CLAUDE_DIR, "projects", dirName, "memory");
  if (fs.existsSync(memoryDir)) {
    const memFiles = fs.readdirSync(memoryDir).filter((f) => f.endsWith(".md"));
    for (const f of memFiles) {
      context.memoryFiles[f] = fs.readFileSync(path.join(memoryDir, f), "utf-8");
    }
  }

  const fileTree = fs.existsSync(projectPath) ? buildFileTree(projectPath) : [];

  return ok({
    id: dbRecord.id.toString(),
    path: dbRecord.path,
    name: dbRecord.name,
    tags: JSON.parse(dbRecord.tags) as string[],
    ...context,
    fileTree,
  });
}

// GET /api/projects/[id] — project detail with CLAUDE.md, file tree, memory files
// Supports lookup strategies:
// 1. Numeric DB ID (e.g. "42") — direct IndexedProject lookup (avoids lossy path decoding)
// 2. ~/.claude/projects/ folder name (filesystem projects)
// 3. DB IndexedProject by decoded path
// 4. Unindexed directory on disk
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    const { id } = await params;

    // Strategy 1: Numeric ID — direct DB lookup (no lossy path decoding)
    const numericId = parseInt(id, 10);
    if (!isNaN(numericId) && String(numericId) === id && numericId > 0) {
      const dbRecord = await db.indexedProject.findUnique({ where: { id: numericId } });
      if (dbRecord) return buildDbProjectResponse(dbRecord);
      return notFound(`Project with id ${id} not found`);
    }

    // Validate id for path-based strategies (no path traversal)
    const resolvedProjectDir = path.resolve(path.join(CLAUDE_DIR, "projects", id));
    const safeClaudeDir = path.resolve(CLAUDE_DIR);
    if (!resolvedProjectDir.startsWith(safeClaudeDir + path.sep)) {
      return notFound("Project not found");
    }

    // Strategy 2: Look in ~/.claude/projects/ (filesystem project)
    const projects = listProjects();
    const project = projects.find((p) => p.id === id);

    if (project) {
      const context = readProjectContext(id);
      const projectPath = project.path;
      const fileTree = fs.existsSync(projectPath) ? buildFileTree(projectPath) : [];

      if (!context.claudeMd) {
        const claudeMdPath = path.join(projectPath, "CLAUDE.md");
        if (fs.existsSync(claudeMdPath)) {
          context.claudeMd = fs.readFileSync(claudeMdPath, "utf-8");
        }
      }

      return ok({ ...project, ...context, fileTree });
    }

    // Strategy 3: Look in DB by decoded path
    const decodedPath = idToPath(id);
    const dbRecord = await db.indexedProject.findFirst({
      where: { path: decodedPath },
    });

    if (dbRecord) return buildDbProjectResponse(dbRecord);

    // Strategy 4 removed: previously allowed reading arbitrary filesystem directories
    // via the lossy idToPath() decoder. This was an information disclosure vulnerability.
    // Only DB-indexed and ~/.claude/projects/ entries are supported.

    return notFound(`Project "${id}" not found`);
  } catch (e) {
    return serverError(e);
  }
}
